-- Run once in the Supabase SQL editor.
-- Assumes public.transfers has: id, transaction_reference, document_date (date), transferred_from, transferred_to,
-- item_code, description, product_code, batch_code, quantity (numeric), pallets (text[]), source_filename, created_at.
-- Check the column types first; if pallets is jsonb instead of text[], tell me and I will adjust the functions.

alter table public.transfers add column if not exists document_time time;

create index if not exists transfers_date_time_idx on public.transfers (document_date desc, document_time desc);
create index if not exists transfers_item_code_idx on public.transfers (item_code);
create index if not exists transfers_reference_idx on public.transfers (transaction_reference);
create index if not exists transfers_batch_norm_idx on public.transfers (lower(btrim(coalesce(batch_code, ''))));

-- ---------------------------------------------------------------------------
-- records_page: one page of TRANSACTIONS (all batches of a transaction stay together),
-- filtered, sorted and counted in Postgres. Returns jsonb:
--   { total_groups, total_records, total_quantity, rows: [ ...transfers with is_duplicate ] }
-- Sort modes: date-desc | date-asc | qty-desc | qty-asc (quantity = transaction total).
-- Runs as the calling user, so Row Level Security still applies.
-- ---------------------------------------------------------------------------
create or replace function public.records_page(
  p_query text default '',
  p_from date default null,
  p_to date default null,
  p_batch text default '',
  p_items text[] default null,
  p_sort text default 'date-desc',
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql stable
as $$
  with params as (
    select lower(btrim(coalesce(p_query, ''))) as q, lower(btrim(coalesce(p_batch, ''))) as b
  ),
  filtered as (
    select t.*
    from public.transfers t, params
    where (params.q = '' or
           strpos(lower(coalesce(t.transaction_reference, '')), params.q) > 0 or
           strpos(lower(coalesce(t.item_code, '')), params.q) > 0 or
           strpos(lower(coalesce(t.description, '')), params.q) > 0 or
           strpos(lower(coalesce(t.batch_code, '')), params.q) > 0 or
           strpos(lower(coalesce(t.transferred_from, '')), params.q) > 0 or
           strpos(lower(coalesce(t.transferred_to, '')), params.q) > 0)
      and (p_from is null or t.document_date >= p_from)
      and (p_to is null or t.document_date <= p_to)
      and (params.b = '' or strpos(lower(coalesce(t.batch_code, '')), params.b) > 0)
      and (p_items is null or t.item_code = any (p_items))
  ),
  groups as (
    select f.transaction_reference, f.document_date, f.transferred_from, f.transferred_to,
           f.item_code, f.description, coalesce(f.product_code, '') as product_code,
           sum(f.quantity) as total_qty,
           coalesce(max(f.document_time), time '00:00') as doc_time,
           min(f.created_at) as first_created
    from filtered f
    group by 1, 2, 3, 4, 5, 6, 7
  ),
  ranked as (
    select g.*,
           row_number() over (order by
             case when p_sort = 'date-asc'  then g.document_date end asc,
             case when p_sort = 'date-asc'  then g.doc_time end asc,
             case when p_sort = 'date-desc' then g.document_date end desc,
             case when p_sort = 'date-desc' then g.doc_time end desc,
             case when p_sort = 'qty-asc'   then g.total_qty end asc,
             case when p_sort = 'qty-desc'  then g.total_qty end desc,
             g.transaction_reference, g.item_code, g.first_created
           ) as rn
    from groups g
  ),
  page as (
    select * from ranked
    where rn > greatest(p_offset, 0) and rn <= greatest(p_offset, 0) + greatest(p_limit, 1)
  ),
  totals as (
    select count(*) as total_groups, coalesce(sum(total_qty), 0) as total_quantity from groups
  ),
  counts as (
    select count(*) as total_records from filtered
  ),
  page_rows as (
    select t.*, p.rn,
           exists (
             select 1 from public.transfers o
             where o.id <> t.id
               and lower(btrim(coalesce(o.batch_code, ''))) = lower(btrim(coalesce(t.batch_code, '')))
               and lower(btrim(coalesce(o.item_code, ''))) = lower(btrim(coalesce(t.item_code, '')))
               and o.quantity = t.quantity
               and o.pallets && t.pallets
           ) as is_duplicate
    from filtered t
    join page p
      on  t.transaction_reference is not distinct from p.transaction_reference
      and t.document_date         is not distinct from p.document_date
      and t.transferred_from      is not distinct from p.transferred_from
      and t.transferred_to        is not distinct from p.transferred_to
      and t.item_code             is not distinct from p.item_code
      and t.description           is not distinct from p.description
      and coalesce(t.product_code, '') = p.product_code
  )
  select jsonb_build_object(
    'total_groups',   (select total_groups from totals),
    'total_records',  (select total_records from counts),
    'total_quantity', (select total_quantity from totals),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(r) - 'rn' order by r.rn, coalesce(r.batch_code, ''), r.created_at) from page_rows r),
      '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- dashboard_stats: totals and per-item statistics, optionally for a document-date range.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats(
  p_from date default null,
  p_to date default null
) returns jsonb
language sql stable
as $$
  with f as (
    select * from public.transfers
    where (p_from is null or document_date >= p_from)
      and (p_to is null or document_date <= p_to)
  ),
  totals as (
    select count(*) as records,
           coalesce(sum(quantity), 0) as quantity,
           count(distinct transaction_reference) as refs,
           count(distinct transferred_to) as destinations
    from f
  ),
  pallet_counts as (
    select f.item_code, count(distinct u.pallet) as pallets
    from f cross join lateral unnest(f.pallets) as u(pallet)
    where btrim(u.pallet) <> ''
    group by f.item_code
  ),
  items as (
    select f.item_code,
           max(f.description) as description,
           count(*) as records,
           coalesce(sum(f.quantity), 0) as quantity,
           count(distinct nullif(btrim(f.batch_code), '')) as batches,
           count(distinct nullif(btrim(f.transferred_to), '')) as destinations,
           max(f.document_date) as latest_date
    from f
    where btrim(coalesce(f.item_code, '')) <> ''
    group by f.item_code
  )
  select jsonb_build_object(
    'records', t.records,
    'quantity', t.quantity,
    'references', t.refs,
    'destinations', t.destinations,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_code', i.item_code,
               'description', coalesce(i.description, ''),
               'records', i.records,
               'quantity', i.quantity,
               'batches', i.batches,
               'pallets', coalesce(pc.pallets, 0),
               'destinations', i.destinations,
               'latest_date', i.latest_date
             ) order by i.quantity desc, i.item_code)
      from items i left join pallet_counts pc on pc.item_code = i.item_code
    ), '[]'::jsonb)
  )
  from totals t
$$;

-- ---------------------------------------------------------------------------
-- check_duplicates: which review rows match an already saved record
-- (same batch code, same quantity, at least one shared pallet, same item when both are given).
-- Input: [{ "batch": "B1", "item": "4554770121", "quantity": 1200, "pallets": ["1001"] }, ...]
-- Output: one row per match, idx = position in the input array.
-- ---------------------------------------------------------------------------
create or replace function public.check_duplicates(p_rows jsonb)
returns table (idx int, reference text)
language sql stable
as $$
  select distinct (r.ord - 1)::int, o.transaction_reference
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as r(val, ord)
  join public.transfers o
    on  lower(btrim(coalesce(o.batch_code, ''))) = lower(btrim(coalesce(r.val ->> 'batch', '')))
    and (btrim(coalesce(r.val ->> 'item', '')) = '' or lower(btrim(coalesce(o.item_code, ''))) = lower(btrim(r.val ->> 'item')))
    and o.quantity = (r.val ->> 'quantity')::numeric
    and o.pallets && array(select jsonb_array_elements_text(coalesce(r.val -> 'pallets', '[]'::jsonb)))
$$;

-- Only signed-in users may call these.
revoke all on function public.records_page(text, date, date, text, text[], text, int, int) from public, anon;
revoke all on function public.dashboard_stats(date, date) from public, anon;
revoke all on function public.check_duplicates(jsonb) from public, anon;
grant execute on function public.records_page(text, date, date, text, text[], text, int, int) to authenticated;
grant execute on function public.dashboard_stats(date, date) to authenticated;
grant execute on function public.check_duplicates(jsonb) to authenticated;
