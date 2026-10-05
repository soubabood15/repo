-- Month-level change markers: automatic and transactional for every writer.
CREATE TRIGGER IF NOT EXISTS quality_month_revision_insert AFTER INSERT ON quality_calls BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('quality_revision_' || substr(coalesce(nullif(NEW.call_date,''),NEW.created_at),1,7),lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS quality_month_revision_update AFTER UPDATE ON quality_calls BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('quality_revision_' || substr(coalesce(nullif(OLD.call_date,''),OLD.created_at),1,7),lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
  INSERT INTO app_control(key,value,updated_at) VALUES('quality_revision_' || substr(coalesce(nullif(NEW.call_date,''),NEW.created_at),1,7),lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
CREATE TRIGGER IF NOT EXISTS quality_month_revision_delete AFTER DELETE ON quality_calls BEGIN
  INSERT INTO app_control(key,value,updated_at) VALUES('quality_revision_' || substr(coalesce(nullif(OLD.call_date,''),OLD.created_at),1,7),lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
INSERT INTO app_control(key,value,updated_at) VALUES('quality_revision_ready','1',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value='1';
