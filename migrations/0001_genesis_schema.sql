-- APEX GENESIS — Complete Persistent Data Layer Schema (SQLite / Cloudflare D1)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (role IN ('CANDIDATE', 'AUDITOR', 'SYSTEM_ADMIN')),
  oauth_issuer TEXT,
  oauth_subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_subject
  ON users(oauth_issuer, oauth_subject)
  WHERE oauth_issuer IS NOT NULL AND oauth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  remote_preference TEXT NOT NULL DEFAULT 'REMOTE_FIRST' CHECK (remote_preference IN ('REMOTE_ONLY', 'REMOTE_FIRST', 'HYBRID', 'ONSITE', 'UNKNOWN')),
  work_authorization TEXT NOT NULL DEFAULT 'UNKNOWN',
  min_base_salary_usd INTEGER,
  preferred_currency TEXT NOT NULL DEFAULT 'USD',
  years_experience REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('EMPLOYMENT', 'EDUCATION', 'SKILL', 'PROJECT', 'CERTIFICATION', 'EXPERIENCE', 'PREFERENCE', 'CONFIRMED_ANSWER')),
  attribute_key TEXT NOT NULL,
  attribute_value TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  evidence_source TEXT NOT NULL,
  evidence_excerpt TEXT,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidate_facts_user ON candidate_facts(user_id, category);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source_feed TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT NOT NULL,
  remote_status TEXT NOT NULL CHECK (remote_status IN ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN')),
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME',
  seniority_level TEXT NOT NULL DEFAULT 'MID_SENIOR',
  min_years_required REAL,
  salary_min_usd INTEGER,
  salary_max_usd INTEGER,
  work_auth_required TEXT NOT NULL DEFAULT 'UNKNOWN',
  required_skills_json TEXT NOT NULL DEFAULT '[]',
  preferred_skills_json TEXT NOT NULL DEFAULT '[]',
  description_text TEXT NOT NULL,
  submission_method TEXT NOT NULL CHECK (submission_method IN ('GREENHOUSE_API', 'LEVER_API', 'DIRECT_PORTAL', 'MANUAL_ONLY')),
  verification_status TEXT NOT NULL DEFAULT 'USER_SUPPLIED_UNVERIFIED' CHECK (verification_status IN ('VERIFIED', 'SOURCE_RETRIEVED', 'USER_SUPPLIED_UNVERIFIED', 'STALE', 'UNVERIFIED')),
  posted_at TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(user_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, remote_status);

CREATE TABLE IF NOT EXISTS job_matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  overall_score REAL NOT NULL,
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('ELIGIBLE', 'PARTIAL_UNKNOWN', 'INELIGIBLE')),
  score_breakdown_json TEXT NOT NULL,
  matched_skills_json TEXT NOT NULL,
  missing_skills_json TEXT NOT NULL,
  unknown_facts_json TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE(user_id, job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'SUSPENDED_QUOTA')),
  target_roles_json TEXT NOT NULL,
  remote_only INTEGER NOT NULL DEFAULT 0,
  min_match_score REAL NOT NULL DEFAULT 70.0,
  excluded_companies_json TEXT NOT NULL DEFAULT '[]',
  preferred_companies_json TEXT NOT NULL DEFAULT '[]',
  authorized_actions_json TEXT NOT NULL DEFAULT '["DISCOVER","MATCH","TAILOR_RESUME","DRAFT_PACKAGE"]',
  daily_submission_cap INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('MASTER_RESUME', 'TAILORED_RESUME', 'COVER_LETTER', 'ATS_ANSWERS', 'APPLICATION_PACKAGE')),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('MARKDOWN', 'PLAIN_TEXT', 'PDF_TEXT', 'DOCX_TEXT', 'JSON')),
  content TEXT NOT NULL,
  truthfulness_verified INTEGER NOT NULL DEFAULT 1 CHECK (truthfulness_verified IN (0, 1)),
  grounding_report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  fact_id TEXT NOT NULL REFERENCES candidate_facts(id) ON DELETE RESTRICT,
  verification_state TEXT NOT NULL CHECK (verification_state IN ('VERIFIED_FACT_LINKED', 'REJECTED_UNVERIFIED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  cover_letter_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT_READY', 'AWAITING_HUMAN_APPROVAL', 'BLOCKED_CAPTCHA', 'SUBMITTED_VERIFIED', 'SUBMITTED_UNCONFIRMED',
    'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN',
    'PREPARED', 'AWAITING_APPROVAL', 'SUBMITTING', 'SUBMISSION_UNCERTAIN', 'USER_REPORTED', 'PROVIDER_CONFIRMED', 'MANUAL_ONLY', 'BLOCKED'
  )),
  evidence_level TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL' CHECK (evidence_level IN (
    'PREPARED', 'AWAITING_APPROVAL', 'SUBMITTING', 'SUBMISSION_UNCERTAIN', 'USER_REPORTED', 'PROVIDER_CONFIRMED', 'MANUAL_ONLY', 'BLOCKED'
  )),
  submission_adapter TEXT NOT NULL,
  external_confirmation_id TEXT,
  external_receipt_json TEXT,
  submitted_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('CANDIDATE', 'CAMPAIGN', 'AGENT', 'EMPLOYER', 'SYSTEM')),
  memory_key TEXT NOT NULL,
  memory_value_json TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('VERIFIED_EVIDENCE', 'TOOL_EXECUTION', 'USER_CONFIRMED', 'AI_HYPOTHESIS')),
  is_verified_truth INTEGER NOT NULL DEFAULT 0 CHECK (is_verified_truth IN (0, 1)),
  evidence_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, domain, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories(user_id, domain);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALIDATED', 'EXECUTING', 'COMPLETED', 'PAUSED_BLOCKER', 'FAILED', 'CANCELLED')),
  constraints_json TEXT NOT NULL,
  unknown_facts_json TEXT NOT NULL,
  required_tools_json TEXT NOT NULL,
  dag_json TEXT NOT NULL,
  execution_report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'LEASED', 'COMPLETED', 'RETRY_WAIT', 'DEAD_LETTER', 'HUMAN_ATTENTION', 'CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 5,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_eligible_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, next_eligible_at, priority);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS dead_letter_tasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  failure_category TEXT NOT NULL,
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  permission_tier TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'DENIED_PERMISSION', 'VALIDATION_ERROR', 'TIMEOUT', 'QUOTA_EXCEEDED', 'EXECUTION_ERROR')),
  duration_ms INTEGER NOT NULL,
  cost_units REAL NOT NULL DEFAULT 0,
  verified_output INTEGER NOT NULL DEFAULT 0,
  executed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  neurons_consumed REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('AI_PROVIDER', 'GOOGLE_WORKSPACE', 'RECRUITMENT_API', 'CLOUD_INFRA')),
  connection_status TEXT NOT NULL CHECK (connection_status IN ('CONNECTED_VERIFIED', 'UNVERIFIED_CONFIG', 'DISCONNECTED', 'QUOTA_EXHAUSTED', 'ERROR')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_health_check_at TEXT,
  health_detail TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, provider_key)
);

CREATE TABLE IF NOT EXISTS recruiter_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  external_thread_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('INTERVIEW_INVITE', 'ASSESSMENT', 'RECRUITER_OUTREACH', 'REJECTION', 'OFFER', 'CONFIRMATION')),
  requires_response INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  scheduled_start_at TEXT NOT NULL,
  scheduled_end_at TEXT NOT NULL,
  calendar_event_id TEXT,
  prep_brief_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ALLOW', 'DENY', 'ERROR')),
  details_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_challenges_user ON email_verification_challenges(user_id, email);

CREATE TABLE IF NOT EXISTS resume_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  linked_fact_ids_json TEXT NOT NULL,
  diff_summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

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
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_job_id TEXT NOT NULL,
  merged_external_id TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  merge_reason TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
