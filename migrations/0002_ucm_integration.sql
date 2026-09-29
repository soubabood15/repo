CREATE TABLE IF NOT EXISTS ucm_agent_mapping (
  extension TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  team TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ucm_agent_mapping_username_idx ON ucm_agent_mapping(username);

CREATE TABLE IF NOT EXISTS ucm_cdr (
  external_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  unique_id TEXT,
  agent_extension TEXT,
  username TEXT,
  queue_name TEXT,
  direction TEXT NOT NULL,
  source_number TEXT,
  destination_number TEXT,
  started_at TEXT NOT NULL,
  answered_at TEXT,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  talk_seconds INTEGER NOT NULL DEFAULT 0,
  wait_seconds INTEGER NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ucm_cdr_agent_day_idx ON ucm_cdr(agent_extension,started_at);
CREATE INDEX IF NOT EXISTS ucm_cdr_username_day_idx ON ucm_cdr(username,started_at);
CREATE INDEX IF NOT EXISTS ucm_cdr_queue_day_idx ON ucm_cdr(queue_name,started_at);

CREATE TABLE IF NOT EXISTS ucm_queue_events (
  event_id TEXT PRIMARY KEY,
  agent_extension TEXT NOT NULL,
  username TEXT,
  queue_name TEXT,
  event_type TEXT NOT NULL,
  reason TEXT,
  occurred_at TEXT NOT NULL,
  raw_json TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ucm_queue_events_agent_day_idx ON ucm_queue_events(agent_extension,occurred_at);

CREATE TABLE IF NOT EXISTS ucm_agent_daily (
  username TEXT NOT NULL,
  agent_extension TEXT NOT NULL,
  day TEXT NOT NULL,
  first_login TEXT,
  last_logout TEXT,
  break_seconds INTEGER NOT NULL DEFAULT 0,
  work_seconds INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  attendance_status TEXT NOT NULL DEFAULT 'not_logged_in',
  total_calls INTEGER NOT NULL DEFAULT 0,
  answered_calls INTEGER NOT NULL DEFAULT 0,
  missed_calls INTEGER NOT NULL DEFAULT 0,
  inbound_calls INTEGER NOT NULL DEFAULT 0,
  outbound_calls INTEGER NOT NULL DEFAULT 0,
  talk_seconds INTEGER NOT NULL DEFAULT 0,
  wait_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(username,day)
);
CREATE INDEX IF NOT EXISTS ucm_agent_daily_day_idx ON ucm_agent_daily(day);

CREATE TABLE IF NOT EXISTS ucm_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO ucm_sync_state(key,value,status,updated_at) VALUES('change_cursor','0','ok',CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS ucm_ingest_failures (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
