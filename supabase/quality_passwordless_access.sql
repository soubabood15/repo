create extension if not exists pgcrypto;

create table if not exists public.quality_access_requests (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  request_token uuid not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  expires_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists public.quality_presence (
  request_id uuid primary key references public.quality_access_requests(id) on delete cascade,
  username text not null,
  activity_state text not null default 'active',
  current_call text,
  page_visible boolean not null default true,
  last_activity_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);

alter table public.quality_access_requests enable row level security;
alter table public.quality_presence enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert on public.quality_access_requests to anon, authenticated;
grant update, delete on public.quality_access_requests to authenticated;
grant select, insert, update, delete on public.quality_presence to anon, authenticated;
grant select, update on public.quality_calls to anon, authenticated;

create or replace function public.quality_request_token()
returns uuid language sql stable as $$
  select nullif(current_setting('request.headers',true)::jsonb->>'x-quality-token','')::uuid
$$;

create or replace function public.is_active_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.trainer_users where auth_user_id=auth.uid() and active=true and lower(role)='admin')
$$;

create or replace function public.has_approved_quality_access()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.quality_access_requests
    where request_token=public.quality_request_token()
      and status='approved' and coalesce(expires_at,now()+interval '1 minute')>now()
  )
$$;

grant execute on function public.quality_request_token() to anon, authenticated;
grant execute on function public.is_active_admin() to anon, authenticated;
grant execute on function public.has_approved_quality_access() to anon, authenticated;

drop policy if exists quality_request_create on public.quality_access_requests;
create policy quality_request_create on public.quality_access_requests for insert to anon,authenticated
with check (status='pending' and reviewed_at is null and reviewed_by is null);
drop policy if exists quality_request_read_own on public.quality_access_requests;
create policy quality_request_read_own on public.quality_access_requests for select to anon,authenticated
using (request_token=public.quality_request_token() or public.is_active_admin());
drop policy if exists quality_request_admin_update on public.quality_access_requests;
create policy quality_request_admin_update on public.quality_access_requests for update to authenticated
using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists quality_presence_own_all on public.quality_presence;
create policy quality_presence_own_all on public.quality_presence for all to anon,authenticated
using (request_id in (select id from public.quality_access_requests where request_token=public.quality_request_token() and status='approved' and expires_at>now()))
with check (request_id in (select id from public.quality_access_requests where request_token=public.quality_request_token() and status='approved' and expires_at>now()));
drop policy if exists quality_presence_admin_read on public.quality_presence;
create policy quality_presence_admin_read on public.quality_presence for select to authenticated
using (public.is_active_admin());
drop policy if exists quality_presence_admin_delete on public.quality_presence;
create policy quality_presence_admin_delete on public.quality_presence for delete to authenticated
using (public.is_active_admin());

drop policy if exists quality_calls_temporary_read on public.quality_calls;
create policy quality_calls_temporary_read on public.quality_calls for select to anon,authenticated
using (public.has_approved_quality_access());
drop policy if exists quality_calls_temporary_update on public.quality_calls;
create policy quality_calls_temporary_update on public.quality_calls for update to anon,authenticated
using (public.has_approved_quality_access()) with check (public.has_approved_quality_access());

drop policy if exists quality_audio_temporary_read on storage.objects;
create policy quality_audio_temporary_read on storage.objects for select to anon,authenticated
using (bucket_id='quality-calls' and public.has_approved_quality_access());

create index if not exists quality_access_status_idx on public.quality_access_requests(status,requested_at desc);
create index if not exists quality_presence_seen_idx on public.quality_presence(last_seen_at desc);
notify pgrst, 'reload schema';
