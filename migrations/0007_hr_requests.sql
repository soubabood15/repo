CREATE TABLE IF NOT EXISTS hr_employee_requests (
 id TEXT PRIMARY KEY, username TEXT NOT NULL,
 request_type TEXT NOT NULL CHECK(request_type IN ('annual','short_leave','schedule_preference')),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
 note TEXT NOT NULL DEFAULT '', requested_minutes INTEGER NOT NULL DEFAULT 0,
 shift_snapshot TEXT, week_json TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT, decision_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS hr_requests_employee_dates ON hr_employee_requests(username,start_date,end_date);
CREATE INDEX IF NOT EXISTS hr_requests_status ON hr_employee_requests(status,created_at);
ALTER TABLE hr_sick_leaves ADD COLUMN decision_seen_at TEXT;
CREATE TRIGGER IF NOT EXISTS hr_request_insert AFTER INSERT ON hr_employee_requests BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_request_update AFTER UPDATE ON hr_employee_requests BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_request_delete AFTER DELETE ON hr_employee_requests BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_kpi_insert AFTER INSERT ON agent_kpi_monthly BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_kpi_update AFTER UPDATE ON agent_kpi_monthly BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_kpi_delete AFTER DELETE ON agent_kpi_monthly BEGIN
 INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
