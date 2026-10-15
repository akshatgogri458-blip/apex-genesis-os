-- APEX GENESIS V9.1 — Public Repository Safety, Webhook Anti-Replay & Dead-Letter Recovery
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS webhook_receipt_nonces (
  receipt_hash TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  confirmation_id TEXT NOT NULL,
  webhook_timestamp TEXT,
  verified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_nonces_app ON webhook_receipt_nonces(application_id);

CREATE TABLE IF NOT EXISTS dead_letter_replay_audit (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  previous_error TEXT,
  replayed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_replay_task ON dead_letter_replay_audit(task_id, user_id);
