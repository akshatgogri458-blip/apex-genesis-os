-- APEX GENESIS V8 (OPERATION REALITY ENGINE) SCHEMA MIGRATION

CREATE TABLE IF NOT EXISTS oauth_replay_nonces (
  jti TEXT PRIMARY KEY,
  user_id TEXT,
  issuer TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scoped_emergency_stops (
  scope_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL', 'CANDIDATE', 'CAMPAIGN', 'AGENT')),
  owner_user_id TEXT NOT NULL,
  target_resource_id TEXT,
  stopped INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  triggered_by_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_budget_ledger (
  bucket_key TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL_DAILY', 'GLOBAL_MONTHLY', 'USER_DAILY', 'CAMPAIGN_DAILY')),
  scope_owner_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  units_reserved INTEGER NOT NULL DEFAULT 0,
  units_consumed INTEGER NOT NULL DEFAULT 0,
  hard_limit INTEGER NOT NULL,
  billing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (billing_enabled = 0),
  suspended INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_effect_receipts (
  idempotency_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'ATTEMPTED', 'ACKNOWLEDGED', 'CONFIRMED', 'UNCERTAIN', 'FAILED')),
  external_receipt_id TEXT,
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_capability_policies (
  board_id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  capability_state TEXT NOT NULL CHECK (capability_state IN ('READ_ONLY', 'PREPARE_AND_HANDOFF', 'USER_APPROVED_BROWSER_ASSIST', 'EMPLOYER_API_AUTHORIZED', 'MANUAL_ONLY', 'BLOCKED', 'UNSUPPORTED')),
  requires_employer_api_key INTEGER NOT NULL DEFAULT 1,
  supports_public_read INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_job_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT,
  board_source TEXT NOT NULL CHECK (board_source IN ('GREENHOUSE_PUBLIC', 'LEVER_PUBLIC', 'ASHBY_PUBLIC')),
  board_token TEXT NOT NULL,
  query_filter_json TEXT NOT NULL DEFAULT '{}',
  last_fetched_at TEXT,
  last_etag TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_dedupe_merges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  merged_external_id TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  merge_reason TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
