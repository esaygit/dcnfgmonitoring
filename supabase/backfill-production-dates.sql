-- Run after feature-expansion.sql has added public.transfers.production_date.
-- Maps the first numeric digit to 2020-2029 and the next three digits to the Julian day.
-- Invalid or unparseable batch codes are assigned NULL. Batch codes are not modified.

with batch_digits as (
  select
    t.id,
    regexp_replace(coalesce(t.batch_code, ''), '[^0-9]', '', 'g') as digits
  from public.transfers t
),
parsed as (
  select
    id,
    case when length(digits) >= 4
      then 2020 + substring(digits from 1 for 1)::integer
    end as production_year,
    case when length(digits) >= 4
      then substring(digits from 2 for 3)::integer
    end as julian_day
  from batch_digits
),
calculated as (
  select
    id,
    case
      when production_year is not null
       and julian_day between 1 and (case
         when production_year % 4 = 0
          and (production_year % 100 <> 0 or production_year % 400 = 0)
         then 366
         else 365
       end)
      then make_date(production_year, 1, 1) + (julian_day - 1)
      else null
    end as production_date
  from parsed
)
update public.transfers as t
set production_date = c.production_date
from calculated as c
where t.id = c.id
  and t.production_date is distinct from c.production_date
returning t.id, t.batch_code, t.production_date;
