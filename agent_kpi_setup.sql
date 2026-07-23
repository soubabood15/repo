-- Run once in Supabase SQL Editor.
-- Stores one current-month KPI snapshot per employee.
create table if not exists public.agent_kpi_monthly (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  username text not null,
  agent_name text not null,
  period_start date not null,
  period_end date not null,
  data_from timestamptz,
  data_to timestamptz,
  quality_score numeric,
  response_score numeric not null default 0,
  productivity_score numeric not null default 0,
  handling_score numeric not null default 0,
  answer_rate_score numeric not null default 0,
  kpi_score numeric not null default 0,
  total_calls integer not null default 0,
  answered_calls integer not null default 0,
  abandoned_calls integer not null default 0,
  abandoned_rate numeric not null default 0,
  average_wait_seconds numeric not null default 0,
  average_talk_seconds numeric not null default 0,
  active_days integer not null default 0,
  main_queue text,
  total_break_seconds numeric not null default 0,
  break_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, period_start)
);

create index if not exists agent_kpi_monthly_auth_user_idx
  on public.agent_kpi_monthly(auth_user_id, period_start desc);

alter table public.agent_kpi_monthly enable row level security;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trainer_users
    where auth_user_id = auth.uid()
      and active = true
      and lower(trim(role)) = 'admin'
  );
$$;

revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

-- Never trust imported_by from the browser. The database records the
-- authenticated administrator automatically for every insert/update.
create or replace function public.set_agent_kpi_import_actor()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.imported_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_agent_kpi_import_actor_trigger
  on public.agent_kpi_monthly;
create trigger set_agent_kpi_import_actor_trigger
before insert or update on public.agent_kpi_monthly
for each row execute function public.set_agent_kpi_import_actor();

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.agent_kpi_monthly to authenticated;

drop policy if exists "Employee reads own KPI" on public.agent_kpi_monthly;
drop policy if exists "Admin reads all KPI" on public.agent_kpi_monthly;
drop policy if exists "Admin inserts KPI" on public.agent_kpi_monthly;
drop policy if exists "Admin updates KPI" on public.agent_kpi_monthly;
drop policy if exists "Admin deletes KPI" on public.agent_kpi_monthly;

create policy "Employee reads own KPI"
on public.agent_kpi_monthly for select to authenticated
using (auth_user_id = auth.uid());

create policy "Admin reads all KPI"
on public.agent_kpi_monthly for select to authenticated
using (public.is_active_admin());

create policy "Admin inserts KPI"
on public.agent_kpi_monthly for insert to authenticated
with check (public.is_active_admin());

create policy "Admin updates KPI"
on public.agent_kpi_monthly for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

create policy "Admin deletes KPI"
on public.agent_kpi_monthly for delete to authenticated
using (public.is_active_admin());

-- The browser calls these protected functions instead of deleting the table
-- directly. Both functions verify the signed-in administrator first.
create or replace function public.admin_agent_kpi_record_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  record_count bigint;
begin
  if not public.is_active_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select count(*) into record_count
  from public.agent_kpi_monthly;

  return record_count;
end;
$$;

create or replace function public.admin_clear_agent_kpi()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if not public.is_active_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  with deleted_rows as (
    delete from public.agent_kpi_monthly
    where id is not null
    returning 1
  )
  select count(*) into deleted_count from deleted_rows;

  return deleted_count;
end;
$$;

revoke all on function public.admin_agent_kpi_record_count() from public;
revoke all on function public.admin_clear_agent_kpi() from public;
grant execute on function public.admin_agent_kpi_record_count() to authenticated;
grant execute on function public.admin_clear_agent_kpi() to authenticated;

-- The KPI importer needs the employee directory for automatic name matching.
drop policy if exists "Admin reads employee directory" on public.trainer_users;
create policy "Admin reads employee directory"
on public.trainer_users for select to authenticated
using (public.is_active_admin());

notify pgrst, 'reload schema';
