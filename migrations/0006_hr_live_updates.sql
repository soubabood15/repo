-- Track deletion as well as insertion/update. No existing records are deleted.
CREATE TABLE IF NOT EXISTS hr_file_cleanup(file_key TEXT PRIMARY KEY,queued_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS hr_action_revision_delete AFTER DELETE ON hr_actions BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_leave_revision_delete AFTER DELETE ON hr_sick_leaves BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_schedule_revision_delete AFTER DELETE ON app_control WHEN OLD.key LIKE 'shift_%' BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
