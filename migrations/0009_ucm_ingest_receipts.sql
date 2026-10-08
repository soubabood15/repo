CREATE TABLE IF NOT EXISTS ucm_ingest_receipts (
  receipt_id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ucm_ingest_receipts_expiry ON ucm_ingest_receipts(expires_at);
