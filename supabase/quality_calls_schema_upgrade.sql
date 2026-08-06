-- Bring an existing quality_calls table up to date without deleting its data.
alter table public.quality_calls
  add column if not exists agent_username text,
  add column if not exists agent_name text,
  add column if not exists audio_name text,
  add column if not exists audio_size bigint,
  add column if not exists uploaded_by text,
  add column if not exists source_call_id text,
  add column if not exists customer_number text,
  add column if not exists call_date date,
  add column if not exists call_started_at timestamptz,
  add column if not exists queue_name text,
  add column if not exists agent_extension text,
  add column if not exists answered_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists talk_seconds numeric,
  add column if not exists wait_seconds numeric,
  add column if not exists source_type text not null default 'audio',
  add column if not exists selected_for_qa_at timestamptz,
  add column if not exists score numeric,
  add column if not exists notes text,
  add column if not exists status text not null default 'pending',
  add column if not exists evaluated_by text,
  add column if not exists evaluated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- KPI samples are references that may be evaluated before their audio is uploaded.
alter table public.quality_calls alter column audio_path drop not null;

create index if not exists quality_calls_agent_username_idx
  on public.quality_calls (agent_username);

create index if not exists quality_calls_created_at_idx
  on public.quality_calls (created_at desc);

create index if not exists quality_calls_call_date_idx
  on public.quality_calls (call_date desc);

create unique index if not exists quality_calls_kpi_reference_unique
  on public.quality_calls (agent_username, source_call_id)
  where source_type = 'kpi_reference' and source_call_id is not null;

notify pgrst, 'reload schema';
