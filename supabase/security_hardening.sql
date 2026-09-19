-- NEWTEL security hardening migration
-- IMPORTANT: Take a Supabase database backup before running this file.
-- Run the whole file once in Supabase Dashboard > SQL Editor.
-- It removes existing policies from the listed application tables and replaces
-- them with authenticated, role-based policies. Existing rows are not deleted.

begin;

do $$
begin
  if not exists (
    select 1 from public.trainer_users
    where active is true and lower(role) = 'admin' and auth_user_id is not null
  ) then
    raise exception 'Safety stop: create/link at least one active Admin in trainer_users before applying security policies.';
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(t.role, ''))
  from public.trainer_users as t
  where t.auth_user_id = (select auth.uid())
    and t.active is true
  limit 1
$$;

create or replace function private.current_username()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(t.username, ''))
  from public.trainer_users as t
  where t.auth_user_id = (select auth.uid())
    and t.active is true
  limit 1
$$;

create or replace function private.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and private.current_profile_role() = any(allowed_roles)
$$;

revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.current_username() from public, anon;
revoke all on function private.has_role(text[]) from public, anon;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.current_username() to authenticated;
grant execute on function private.has_role(text[]) to authenticated;

-- Enable RLS, remove legacy/permissive policies, and remove anonymous access.
do $$
declare
  target_table text;
  policy_row record;
  protected_tables text[] := array[
    'trainer_users','ebook_permissions','app_control','sections','groups','cases',
    'knowledge_change_requests','icon7_items','saraya_kb_sections','saraya_kb_items',
    'shift_swap_requests','schedule_week_archive','schedule_month_archive',
    'admin_live_pings','admin_live_daily_logs','agent_kpi_monthly',
    'quality_calls','quality_access_requests','quality_presence','passkeys'
  ];
begin
  foreach target_table in array protected_tables loop
    if to_regclass('public.' || target_table) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('revoke all on table public.%I from anon', target_table);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', target_table);
      for policy_row in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = target_table
      loop
        execute format('drop policy if exists %I on public.%I', policy_row.policyname, target_table);
      end loop;
    end if;
  end loop;
end $$;

-- Profile directory: signed-in staff may read active profiles; Admin manages it.
create policy trainer_users_staff_read on public.trainer_users
for select to authenticated
using (active is true or private.has_role(array['admin']));
create policy trainer_users_admin_write on public.trainer_users
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- Project permissions: users see their own grants; Admin manages all grants.
create policy ebook_permissions_own_read on public.ebook_permissions
for select to authenticated
using (lower(agent_name) = private.current_username() or private.has_role(array['admin']));
create policy ebook_permissions_admin_write on public.ebook_permissions
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- System controls and schedules. Only two harmless boot flags are public.
grant select on public.app_control to anon;
create policy app_control_public_boot_read on public.app_control
for select to anon
using (key in ('system_status','force_refresh_all'));
create policy app_control_staff_read on public.app_control
for select to authenticated
using (private.has_role(array['agent','trainer','quality','admin']));
create policy app_control_admin_write on public.app_control
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- Knowledge is visible to signed-in staff. Trainers and Admin may edit it.
do $$
declare target_table text;
begin
  foreach target_table in array array['sections','groups','cases','icon7_items','saraya_kb_sections','saraya_kb_items'] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('create policy %I on public.%I for select to authenticated using (private.has_role(array[''agent'',''trainer'',''quality'',''admin'']))', target_table || '_staff_read', target_table);
      execute format('create policy %I on public.%I for all to authenticated using (private.has_role(array[''trainer'',''admin''])) with check (private.has_role(array[''trainer'',''admin'']))', target_table || '_trainer_write', target_table);
    end if;
  end loop;
end $$;

create policy knowledge_requests_staff_read on public.knowledge_change_requests
for select to authenticated
using (private.has_role(array['trainer','admin']));
create policy knowledge_requests_trainer_insert on public.knowledge_change_requests
for insert to authenticated
with check (private.has_role(array['trainer','admin']));
create policy knowledge_requests_admin_manage on public.knowledge_change_requests
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- Swap requests can only be seen/created by either participant; Admin sees all.
create policy swaps_participant_read on public.shift_swap_requests
for select to authenticated
using (
  lower(requester_username) = private.current_username()
  or lower(target_username) = private.current_username()
  or private.has_role(array['admin'])
);
create policy swaps_requester_insert on public.shift_swap_requests
for insert to authenticated
with check (
  lower(requester_username) = private.current_username()
  and lower(target_username) <> private.current_username()
  and status = 'pending_agent'
);
create policy swaps_target_reply on public.shift_swap_requests
for update to authenticated
using (lower(target_username) = private.current_username() and status = 'pending_agent')
with check (lower(target_username) = private.current_username() and status in ('agent_approved','agent_rejected'));
create policy swaps_admin_manage on public.shift_swap_requests
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- Schedule archives are staff-readable and Admin-managed.
do $$
declare target_table text;
begin
  foreach target_table in array array['schedule_week_archive','schedule_month_archive'] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('create policy %I on public.%I for select to authenticated using (private.has_role(array[''agent'',''trainer'',''quality'',''admin'']))', target_table || '_staff_read', target_table);
      execute format('create policy %I on public.%I for all to authenticated using (private.has_role(array[''admin''])) with check (private.has_role(array[''admin'']))', target_table || '_admin_write', target_table);
    end if;
  end loop;
end $$;

-- Presence/log rows must belong to the signed-in username.
create policy live_pings_own_read on public.admin_live_pings
for select to authenticated
using (lower(username) = private.current_username() or private.has_role(array['admin']));
create policy live_pings_own_insert on public.admin_live_pings
for insert to authenticated
with check (lower(username) = private.current_username());
create policy live_pings_own_update on public.admin_live_pings
for update to authenticated
using (lower(username) = private.current_username())
with check (lower(username) = private.current_username());
create policy live_pings_admin_manage on public.admin_live_pings
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

create policy daily_logs_own_insert on public.admin_live_daily_logs
for insert to authenticated
with check (lower(username) = private.current_username());
create policy daily_logs_admin_read on public.admin_live_daily_logs
for select to authenticated
using (private.has_role(array['admin']));
create policy daily_logs_admin_manage on public.admin_live_daily_logs
for update to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));
create policy daily_logs_admin_delete on public.admin_live_daily_logs
for delete to authenticated
using (private.has_role(array['admin']));

-- KPI: an employee sees only their own rows; only Admin changes published KPI.
create policy kpi_own_read on public.agent_kpi_monthly
for select to authenticated
using (lower(username) = private.current_username() or private.has_role(array['admin']));
create policy kpi_admin_write on public.agent_kpi_monthly
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- Quality: only authenticated Quality/Admin accounts. Passwordless token access
-- is intentionally removed because a browser-held bearer token is not identity.
create policy quality_calls_quality_read on public.quality_calls
for select to authenticated
using (private.has_role(array['trainer','quality','admin']));
create policy quality_calls_quality_update on public.quality_calls
for update to authenticated
using (private.has_role(array['trainer','quality','admin']))
with check (private.has_role(array['trainer','quality','admin']));
create policy quality_calls_admin_insert on public.quality_calls
for insert to authenticated
with check (private.has_role(array['admin']));
create policy quality_calls_admin_delete on public.quality_calls
for delete to authenticated
using (private.has_role(array['admin']));

create policy quality_access_admin_only on public.quality_access_requests
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));
create policy quality_presence_admin_only on public.quality_presence
for all to authenticated
using (private.has_role(array['admin']))
with check (private.has_role(array['admin']));

-- The old custom passkey table must not authenticate anyone. Keep it locked so
-- it can be removed after moving to Supabase Auth Passkeys.
revoke all on table public.passkeys from authenticated;

-- Private Quality audio. Remove all existing bucket policies first.
do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (qual ilike '%quality-calls%' or with_check ilike '%quality-calls%')
  loop
    execute format('drop policy if exists %I on storage.objects', policy_row.policyname);
  end loop;
end $$;

create policy quality_audio_read on storage.objects
for select to authenticated
using (bucket_id = 'quality-calls' and private.has_role(array['trainer','quality','admin']));
create policy quality_audio_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'quality-calls' and private.has_role(array['admin']));
create policy quality_audio_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'quality-calls' and private.has_role(array['admin']))
with check (bucket_id = 'quality-calls' and private.has_role(array['admin']));
create policy quality_audio_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'quality-calls' and private.has_role(array['admin']));

update storage.buckets set public = false where id = 'quality-calls';

notify pgrst, 'reload schema';
commit;
