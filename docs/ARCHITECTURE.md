# APEX GENESIS V2 — System Architecture Specification

## 1. Environment Separation

The codebase enforces strict environment boundaries verified by `npm run typecheck` (`scripts/typecheck.cjs`) and separate TypeScript configurations:

- **Cloudflare Worker Runtime (`tsconfig.worker.json`)**: `src/worker.ts`, `src/db/cloudflare-d1-adapter.ts`, `src/types/cloudflare.d.ts`. Pure Web-Standard `fetch` / `scheduled` / `crypto.subtle` / `env.APEX_DB` / `env.AI` modules. Prohibits Node `fs`, `child_process`, `path`, and `http`.
- **Browser Frontend (`tsconfig.browser.json`)**: `src/ui/design-system.ts`, `src/ui/ApexGenesisApp.tsx`, `public/index.html`. Communicates exclusively over authenticated HTTP `fetch('/api/*')`.
- **Local Development & Test Runtime (`tsconfig.json`)**: `src/server/local-server.ts`, `src/db/d1-sqlite-engine.ts`, `tests/*.test.ts`.

## 2. Database Schema & Migrations

- `migrations/0001_genesis_schema.sql`: Core 18 relational tables (`users`, `sessions`, `candidates`, `candidate_facts`, `jobs`, `job_matches`, `campaigns`, `documents`, `document_claims`, `applications`, `memories`, `plans`, `tasks`, `task_dependencies`, `dead_letter_tasks`, `tool_executions`, `model_usage_ledger`, `integrations`, `recruiter_messages`, `interviews`, `audit_logs`, `system_settings`).
- `migrations/0002_v2_resurrection.sql`: Adds `email_verification_challenges` (single-use, expiring SHA-256 hashed verification tokens) and `resume_versions` (immutable version history and diff summaries).

## 3. Durable Autonomous Execution (`scheduled()` & Queue Engine)

- **Atomic Task Leasing**: `scheduled()` in `src/worker.ts` and `acquireLease()` in `src/autonomy/queue-engine.ts` atomically transition `READY` tasks to `LEASED` with a `lease_owner` and `lease_expires_at` timestamp.
- **Crash & Lease Recovery**: Expired leases (`lease_expires_at <= now`) are automatically reclaimed to `READY`.
- **DAG Dependency Promotion**: `PENDING` tasks whose parent rows in `task_dependencies` have all reached `COMPLETED` are promoted to `READY`.
- **Global Server Emergency Stop**: Stored in `system_settings` (`key = 'EMERGENCY_STOP'`) and enforced across `worker.fetch`, `worker.scheduled`, `AutonomousPlanner`, `AgentFleetRegistry`, and `AuthorizedIntegrationNexus`.
