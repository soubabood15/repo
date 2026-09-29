-- Export any UCM audit data before running this rollback.
DROP TABLE IF EXISTS ucm_ingest_failures;
DROP TABLE IF EXISTS ucm_sync_state;
DROP TABLE IF EXISTS ucm_agent_daily;
DROP TABLE IF EXISTS ucm_queue_events;
DROP TABLE IF EXISTS ucm_cdr;
DROP TABLE IF EXISTS ucm_agent_mapping;
