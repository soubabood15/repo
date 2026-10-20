-- Queue is deliberately separate from the generic REST table allowlist.
CREATE TABLE IF NOT EXISTS icon7_padel_jobs (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('availability','booking')),
 request_key TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','submitting','confirmed','failed','unknown')),
 claim_token TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 result TEXT, UNIQUE(username,request_key)
);
CREATE INDEX IF NOT EXISTS icon7_padel_queue ON icon7_padel_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS icon7_padel_user ON icon7_padel_jobs(username,created_at);
CREATE TABLE IF NOT EXISTS icon7_padel_connector (
 id INTEGER PRIMARY KEY CHECK(id=1), seen_at INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0
);

-- Prevent parallel employee submissions for the same slot, even with different request keys.
CREATE UNIQUE INDEX IF NOT EXISTS icon7_padel_active_slot ON icon7_padel_jobs(json_extract(payload,'$.date'),json_extract(payload,'$.court'),json_extract(payload,'$.start')) WHERE kind='booking' AND status IN ('queued','processing','submitting','confirmed','unknown');
CREATE TABLE IF NOT EXISTS icon7_padel_pairing (
 id INTEGER PRIMARY KEY CHECK(id=1), secret_hash TEXT, pairing_hash TEXT, pairing_expires INTEGER
);
