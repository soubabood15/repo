-- Compact globally shared jobs. Call records themselves never go into D1.
CREATE TABLE IF NOT EXISTS ucm_day_jobs (
  day TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','complete','failed')),
  requested_at TEXT NOT NULL,
  lease_until TEXT,
  updated_at TEXT NOT NULL,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ucm_day_jobs_status ON ucm_day_jobs(status,requested_at);
CREATE INDEX IF NOT EXISTS idx_ucm_queue_events_time ON ucm_queue_events(occurred_at);
