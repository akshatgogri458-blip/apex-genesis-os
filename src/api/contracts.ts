/**
 * APEX GENESIS V8 — UNIFIED FRONTEND / NODE / CLOUDFLARE WORKER API CONTRACTS
 * Guarantees identical route paths, HTTP status codes, and response shapes across
 * local Node development and edge Cloudflare Worker execution.
 */

export type CapabilityImplementationState =
  | 'LIVE_VERIFIED'
  | 'LOCAL_REAL_TESTED'
  | 'MOCK_ONLY'
  | 'PARTIALLY_IMPLEMENTED'
  | 'BLOCKED_EXTERNAL_AUTH'
  | 'BLOCKED_COST'
  | 'NOT_IMPLEMENTED';

export const UNIFIED_API_ROUTES = {
  HEALTH: '/api/health',
  REGISTER: '/api/auth/register',
  VERIFY_EMAIL: '/api/auth/verify-email',
  OAUTH_GOOGLE: '/api/auth/oauth/google',
  SESSION_LOGIN: '/api/auth/session',
  SESSION_REVOKE: '/api/auth/revoke',
  DEV_OOB_MAILBOX: '/api/dev/out-of-band-mailbox',
  WORKSPACES_STATE: '/api/workspaces/state',
  CANDIDATE_PROFILE: '/api/candidate/profile',
  CANDIDATE_FACTS: '/api/candidate/facts',
  JOBS_DISCOVER: '/api/jobs/discover',
  JOBS_DISCOVER_OFFICIAL: '/api/jobs/discover-official',
  JOBS_MATCH: '/api/jobs/match',
  DOCUMENTS_INGEST_RESUME: '/api/documents/ingest-resume',
  DOCUMENTS_TAILOR_RESUME: '/api/documents/tailor-resume',
  DOCUMENTS_COMPARE: '/api/documents/compare',
  CAMPAIGNS: '/api/campaigns',
  NEURAL_INFER: '/api/neural/infer',
  PLANNER_EXECUTE: '/api/planner/execute',
  TASKS: '/api/tasks',
  TASKS_CANCEL: '/api/tasks/cancel',
  AGENTS_INVOKE: '/api/agents/invoke',
  APPLICATIONS_SUBMIT: '/api/applications/submit',
  APPLICATIONS_RECONCILE: '/api/applications/reconcile',
  APPLICATIONS_CAPABILITY: '/api/applications/capability',
  EMERGENCY_STOP: '/api/system/emergency-stop',
  AUDIT_VERIFY: '/api/security/audit-verify',
} as const;
