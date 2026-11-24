-- Run in the Supabase SQL editor after server-side-records.sql.
-- This migration is additive. It does not backfill or overwrite existing transfer data.

alter table public.transfers add column if not exists production_date date;
create index if not exists transfers_production_date_idx on public.transfers (production_date);

create table if not exists public.loading_rejections (
  id uuid primary key default gen_random_uuid(),
  rejection_reference text not null,
  rejection_date date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint loading_rejections_reference_unique unique (rejection_reference)
);

create table if not exists public.loading_rejection_items (
  id uuid primary key default gen_random_uuid(),
  rejection_id uuid not null references public.loading_rejections(id) on delete restrict,
  batch_code text not null,
  item_code text not null,
  warehouse_code text not null,
  rejected_quantity numeric(18,4) not null,
  original_available_quantity numeric(18,4) not null,
  remaining_quantity numeric(18,4) not null,
  remarks text not null,
  created_at timestamptz not null default now(),
  constraint loading_rejection_items_quantity_positive check (rejected_quantity > 0),
  constraint loading_rejection_items_remaining_nonnegative check (remaining_quantity >= 0),
  constraint loading_rejection_items_original_nonnegative check (original_available_quantity >= 0),
  constraint loading_rejection_items_remarks_required check (btrim(remarks) <> '')
);

create index if not exists loading_rejections_date_idx on public.loading_rejections (rejection_date desc, created_at desc);
create index if not exists loading_rejection_items_rejection_idx on public.loading_rejection_items (rejection_id);
create index if not exists loading_rejection_items_balance_idx
  on public.loading_rejection_items (lower(batch_code), lower(item_code), lower(warehouse_code));

alter table public.loading_rejections enable row level security;
alter table public.loading_rejection_items enable row level security;

drop policy if exists "authenticated can read rejection headers" on public.loading_rejections;
create policy "authenticated can read rejection headers"
  on public.loading_rejections for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "authenticated can read rejection items" on public.loading_rejection_items;
create policy "authenticated can read rejection items"
  on public.loading_rejection_items for select to authenticated
  using (auth.uid() is not null);

create or replace function public.loading_rejection_options(p_query text default '')
returns table (
  batch_code text,
  item_code text,
  warehouse_code text,
  description text,
  original_quantity numeric,
  available_quantity numeric
)
language sql stable security invoker
set search_path = public
as $$
  with candidates as (
    select distinct
      btrim(t.batch_code) as batch_code,
      btrim(t.item_code) as item_code,
      btrim(t.transferred_to) as warehouse_code,
      max(t.description) as description
    from public.transfers t
    where btrim(coalesce(t.batch_code, '')) <> ''
      and btrim(coalesce(t.item_code, '')) <> ''
      and btrim(coalesce(t.transferred_to, '')) <> ''
      and (btrim(coalesce(p_query, '')) = '' or
           strpos(lower(coalesce(t.batch_code, '')), lower(btrim(p_query))) > 0 or
           strpos(lower(coalesce(t.item_code, '')), lower(btrim(p_query))) > 0)
    group by 1, 2, 3
  ),
  balances as (
    select c.*,
      coalesce((
        select sum(t.quantity)
        from public.transfers t
        where lower(btrim(t.batch_code)) = lower(c.batch_code)
          and lower(btrim(t.item_code)) = lower(c.item_code)
          and lower(btrim(t.transferred_to)) = lower(c.warehouse_code)
      ), 0) -
      coalesce((
        select sum(t.quantity)
        from public.transfers t
        where lower(btrim(t.batch_code)) = lower(c.batch_code)
          and lower(btrim(t.item_code)) = lower(c.item_code)
          and lower(btrim(t.transferred_from)) = lower(c.warehouse_code)
      ), 0) -
      coalesce((
        select sum(i.rejected_quantity)
        from public.loading_rejection_items i
        where lower(btrim(i.batch_code)) = lower(c.batch_code)
          and lower(btrim(i.item_code)) = lower(c.item_code)
          and lower(btrim(i.warehouse_code)) = lower(c.warehouse_code)
      ), 0) as available_quantity,
      coalesce((
        select sum(t.quantity)
        from public.transfers t
        where lower(btrim(t.batch_code)) = lower(c.batch_code)
          and lower(btrim(t.item_code)) = lower(c.item_code)
          and lower(btrim(t.transferred_to)) = lower(c.warehouse_code)
      ), 0) as original_quantity
    from candidates c
  )
  select batch_code, item_code, warehouse_code, description,
         greatest(available_quantity, 0),
         greatest(available_quantity, 0)
  from balances
  order by batch_code, warehouse_code
$$;

create or replace function public.submit_loading_rejection(
  p_rejection_reference text,
  p_rejection_date date,
  p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_reference text;
  v_header_id uuid;
  v_line jsonb;
  v_batch text;
  v_item text;
  v_warehouse text;
  v_quantity numeric;
  v_available numeric;
  v_key text;
  v_candidate_count integer;
begin
  if v_user is null then
    raise exception 'Authentication is required';
  end if;
  if p_rejection_date is null then
    raise exception 'Rejection date is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Rejection lines must be a JSON array';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one rejection line is required';
  end if;

  v_reference := btrim(coalesce(p_rejection_reference, ''));
  if v_reference = '' then
    v_reference := 'LR-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 8));
  end if;

  if exists (select 1 from public.loading_rejections h where h.rejection_reference = v_reference) then
    raise exception 'Rejection reference already exists';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_batch := btrim(coalesce(v_line ->> 'batch_code', ''));
    v_quantity := nullif(btrim(coalesce(v_line ->> 'rejected_quantity', '')), '')::numeric;

    if v_batch = '' then
      raise exception 'Batch code is required';
    end if;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Rejected quantity must be greater than zero for batch %', v_batch;
    end if;
  end loop;

  for v_key in
    select distinct lower(btrim(l ->> 'batch_code'))
    from jsonb_array_elements(p_lines) l
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(v_key));
  end loop;

  if (
    select count(*)
    from (
      select lower(btrim(l ->> 'batch_code')) as key
      from jsonb_array_elements(p_lines) l
      group by 1
      having count(*) > 1
    ) duplicates
  ) > 0 then
    raise exception 'Duplicate batch lines must be consolidated';
  end if;

  insert into public.loading_rejections(rejection_reference, rejection_date, created_by)
  values (v_reference, p_rejection_date, v_user)
  returning id into v_header_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_batch := btrim(v_line ->> 'batch_code');
    v_quantity := (v_line ->> 'rejected_quantity')::numeric;

    select count(*), max(o.item_code), max(o.warehouse_code), max(o.available_quantity)
    into v_candidate_count, v_item, v_warehouse, v_available
    from public.loading_rejection_options(v_batch) o
    where lower(btrim(o.batch_code)) = lower(v_batch)
      and o.available_quantity > 0;

    if v_candidate_count = 0 then
      raise exception 'Batch % has no positive current available quantity', v_batch;
    end if;
    if v_candidate_count > 1 then
      raise exception 'Batch % has multiple current stock balances; submission is blocked until inventory is clarified', v_batch;
    end if;

    if v_quantity > v_available then
      raise exception 'Rejected quantity for batch % exceeds available quantity (%)',
        v_batch, v_available;
    end if;

    insert into public.loading_rejection_items(
      rejection_id, batch_code, item_code, warehouse_code,
      rejected_quantity, original_available_quantity, remaining_quantity, remarks
    ) values (
      v_header_id, v_batch, v_item, v_warehouse,
      v_quantity, v_available, v_available - v_quantity, 'Loading rejection'
    );
  end loop;

  return jsonb_build_object(
    'id', v_header_id,
    'rejection_reference', v_reference
  );
end;
$$;

create or replace function public.loading_rejection_history(
  p_reference text default '',
  p_batch text default '',
  p_from date default null,
  p_to date default null
) returns jsonb
language sql stable security definer
set search_path = public, auth
as $$
  with rejection_rows as (
    select
      h.id,
      h.rejection_reference,
      h.rejection_date,
      count(i.id) as affected_batches,
      coalesce(sum(i.rejected_quantity), 0) as total_rejected_quantity,
      coalesce(u.email, h.created_by::text) as recorded_by,
      h.created_at,
      jsonb_agg(jsonb_build_object(
        'batch_code', i.batch_code,
        'item_code', i.item_code,
        'warehouse_code', i.warehouse_code,
        'rejected_quantity', i.rejected_quantity,
        'original_available_quantity', i.original_available_quantity,
        'remaining_quantity', i.remaining_quantity,
        'remarks', i.remarks
      ) order by i.batch_code) as items
    from public.loading_rejections h
    join public.loading_rejection_items i on i.rejection_id = h.id
    left join auth.users u on u.id = h.created_by
    where auth.uid() is not null
      and (btrim(coalesce(p_reference, '')) = '' or strpos(lower(h.rejection_reference), lower(btrim(p_reference))) > 0)
      and (btrim(coalesce(p_batch, '')) = '' or exists (
        select 1 from public.loading_rejection_items bi
        where bi.rejection_id = h.id
          and strpos(lower(bi.batch_code), lower(btrim(p_batch))) > 0
      ))
      and (p_from is null or h.rejection_date >= p_from)
      and (p_to is null or h.rejection_date <= p_to)
    group by h.id, h.rejection_reference, h.rejection_date, h.created_by, h.created_at, u.email
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'rejection_reference', rejection_reference,
      'rejection_date', rejection_date,
      'affected_batches', affected_batches,
      'total_rejected_quantity', total_rejected_quantity,
      'recorded_by', recorded_by,
      'created_at', created_at,
      'items', items
    ) order by rejection_date desc, created_at desc
  ), '[]'::jsonb)
  from rejection_rows
$$;

revoke all on function public.loading_rejection_options(text) from public, anon;
revoke all on function public.submit_loading_rejection(text, date, jsonb) from public, anon;
revoke all on function public.loading_rejection_history(text, text, date, date) from public, anon;
grant execute on function public.loading_rejection_options(text) to authenticated;
grant execute on function public.submit_loading_rejection(text, date, jsonb) to authenticated;
grant execute on function public.loading_rejection_history(text, text, date, date) to authenticated;
