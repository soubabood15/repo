CREATE TABLE IF NOT EXISTS hr_staff_permissions(
  username TEXT PRIMARY KEY,permissions_json TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS hr_attendance_revision_delete AFTER DELETE ON hr_attendance BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_permissions_revision_insert AFTER INSERT ON hr_staff_permissions BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS hr_permissions_revision_update AFTER UPDATE ON hr_staff_permissions BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('hr_revision',lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
