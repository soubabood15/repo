-- Admin Live Pings
-- Run once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.admin_live_pings (
  id uuid primary key default gen_random_uuid(),
  presence_key text not null unique,
  username text not null,
  full_name text,
  project_id text not null,
  project_name text,
  page_path text,
  device_id text,
  status text not null default 'online',
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  last_seen timestamptz not null default now(),
  last_ping_at timestamptz not null default now(),
  last_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_live_daily_logs (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  full_name text,
  project_id text not null,
  project_name text,
  page_path text,
  device_id text,
  status text not null default 'online',
  reason text,
  pinged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.admin_live_pings
  add column if not exists presence_key text,
  add column if not exists username text,
  add column if not exists full_name text,
  add column if not exists project_id text,
  add column if not exists project_name text,
  add column if not exists page_path text,
  add column if not exists device_id text,
  add column if not exists status text default 'online',
  add column if not exists login_at timestamptz default now(),
  add column if not exists logout_at timestamptz,
  add column if not exists last_seen timestamptz default now(),
  add column if not exists last_ping_at timestamptz default now(),
  add column if not exists last_reason text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.admin_live_daily_logs
  add column if not exists username text,
  add column if not exists full_name text,
  add column if not exists project_id text,
  add column if not exists project_name text,
  add column if not exists page_path text,
  add column if not exists device_id text,
  add column if not exists status text default 'online',
  add column if not exists reason text,
  add column if not exists pinged_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

create unique index if not exists admin_live_pings_presence_key_unique
  on public.admin_live_pings(presence_key);

create index if not exists admin_live_pings_last_ping_idx
  on public.admin_live_pings(last_ping_at desc);

create index if not exists admin_live_pings_status_last_seen_idx
  on public.admin_live_pings(status,last_seen desc);

create index if not exists admin_live_pings_project_idx
  on public.admin_live_pings(project_id,last_ping_at desc);

create index if not exists admin_live_daily_logs_pinged_idx
  on public.admin_live_daily_logs(pinged_at desc);

create index if not exists admin_live_daily_logs_project_idx
  on public.admin_live_daily_logs(project_id,pinged_at desc);

grant usage on schema public
to anon, authenticated;

grant select, insert, update on public.admin_live_pings
to anon, authenticated;

grant select, insert on public.admin_live_daily_logs
to anon, authenticated;

alter table public.admin_live_pings enable row level security;
alter table public.admin_live_daily_logs enable row level security;

drop policy if exists "Public admin live read" on public.admin_live_pings;
create policy "Public admin live read"
on public.admin_live_pings for select
to anon, authenticated
using (true);

drop policy if exists "Public admin live insert" on public.admin_live_pings;
create policy "Public admin live insert"
on public.admin_live_pings for insert
to anon, authenticated
with check (true);

drop policy if exists "Public admin live update" on public.admin_live_pings;
create policy "Public admin live update"
on public.admin_live_pings for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public admin live logs read" on public.admin_live_daily_logs;
create policy "Public admin live logs read"
on public.admin_live_daily_logs for select
to anon, authenticated
using (true);

drop policy if exists "Public admin live logs insert" on public.admin_live_daily_logs;
create policy "Public admin live logs insert"
on public.admin_live_daily_logs for insert
to anon, authenticated
with check (true);

create or replace function public.cleanup_admin_live_data()
returns void
language sql
security definer
as $$
  delete from public.admin_live_daily_logs;
  delete from public.admin_live_pings;
$$;

-- Optional weekly cleanup if pg_cron is enabled in your Supabase project.
-- Saturday 00:00 UTC:
-- create extension if not exists pg_cron;
-- select cron.unschedule('cleanup-admin-live-data-weekly');
-- select cron.schedule(
--   'cleanup-admin-live-data-weekly',
--   '0 0 * * 6',
--   $$select public.cleanup_admin_live_data();$$
-- );
