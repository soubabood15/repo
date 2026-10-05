CREATE TABLE IF NOT EXISTS hr_attendance (
  username TEXT NOT NULL,day TEXT NOT NULL,punch_in TEXT NOT NULL,punch_out TEXT,
  scheduled_shift TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(username,day)
);
CREATE INDEX IF NOT EXISTS hr_attendance_day_idx ON hr_attendance(day);
CREATE TABLE IF NOT EXISTS hr_actions (
  id TEXT PRIMARY KEY,username TEXT NOT NULL,action_date TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'verbal',message TEXT NOT NULL,created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS hr_actions_employee_idx ON hr_actions(username,created_at);
CREATE TABLE IF NOT EXISTS hr_sick_leaves (
  id TEXT PRIMARY KEY,username TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',file_key TEXT NOT NULL,file_type TEXT NOT NULL,file_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL,reviewed_at TEXT,reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS hr_sick_leaves_dates_idx ON hr_sick_leaves(start_date,end_date);
CREATE TABLE IF NOT EXISTS hr_audit (
  id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,
  details TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS hr_attendance_revision_insert AFTER INSERT ON hr_attendance BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_attendance_revision_update AFTER UPDATE ON hr_attendance BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_action_revision_insert AFTER INSERT ON hr_actions BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_action_revision_update AFTER UPDATE ON hr_actions BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_leave_revision_insert AFTER INSERT ON hr_sick_leaves BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_leave_revision_update AFTER UPDATE ON hr_sick_leaves BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_schedule_revision_insert AFTER INSERT ON app_control WHEN NEW.key LIKE 'shift_%' BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_schedule_revision_update AFTER UPDATE ON app_control WHEN NEW.key LIKE 'shift_%' BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision','initial',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO NOTHING;
