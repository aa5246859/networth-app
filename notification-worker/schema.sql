CREATE TABLE IF NOT EXISTS devices (
  uid TEXT NOT NULL,
  device_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  strategy_enabled INTEGER NOT NULL DEFAULT 1,
  daily_enabled INTEGER NOT NULL DEFAULT 1,
  last_opened_day TEXT,
  daily_sent_day TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, device_id)
);
CREATE INDEX IF NOT EXISTS devices_daily_enabled ON devices(daily_enabled, last_opened_day);
CREATE TABLE IF NOT EXISTS sent_events (event_key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);

