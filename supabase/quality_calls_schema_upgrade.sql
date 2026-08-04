-- Bring an existing quality_calls table up to date without deleting its data.
alter table public.quality_calls
  add column if not exists agent_username text,
  add column if not exists agent_name text,
  add column if not exists audio_name text,
  add column if not exists audio_size bigint,
  add column if not exists uploaded_by text,
  add column if not exists score numeric,
  add column if not exists notes text,
  add column if not exists status text not null default 'pending',
  add column if not exists evaluated_by text,
  add column if not exists evaluated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists quality_calls_agent_username_idx
  on public.quality_calls (agent_username);

create index if not exists quality_calls_created_at_idx
  on public.quality_calls (created_at desc);

notify pgrst, 'reload schema';
