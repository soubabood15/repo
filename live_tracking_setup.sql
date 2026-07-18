-- Simple Live Presence
-- Run once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.live_agents (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  user_id uuid,
  device_id text,
  session_id text not null unique,
  project_id text not null,
  page_path text,
  status text not null default 'online',
  event_type text not null default 'heartbeat',
  is_visible boolean not null default true,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.live_agents
  add column if not exists username text,
  add column if not exists user_id uuid,
  add column if not exists device_id text,
  add column if not exists session_id text,
  add column if not exists project_id text,
  add column if not exists page_path text,
  add column if not exists status text default 'online',
  add column if not exists event_type text default 'heartbeat',
  add column if not exists is_visible boolean default true,
  add column if not exists started_at timestamptz default now(),
  add column if not exists last_seen timestamptz default now(),
  add column if not exists last_activity_at timestamptz default now(),
  add column if not exists ended_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists live_agents_session_id_unique
  on public.live_agents(session_id);

create index if not exists live_agents_project_last_seen_idx
  on public.live_agents(project_id,last_seen desc);

create index if not exists live_agents_username_last_seen_idx
  on public.live_agents(username,last_seen desc);

alter table public.live_agents enable row level security;

drop policy if exists "Public live agents read" on public.live_agents;
create policy "Public live agents read"
on public.live_agents for select
to anon, authenticated
using (true);

drop policy if exists "Public live agents insert" on public.live_agents;
create policy "Public live agents insert"
on public.live_agents for insert
to anon, authenticated
with check (true);

drop policy if exists "Public live agents update" on public.live_agents;
create policy "Public live agents update"
on public.live_agents for update
to anon, authenticated
using (true)
with check (true);
