# APEX GENESIS V8 — UNIVERSAL TOOL & 24 SPECIALIST AGENT REGISTRY

## 1. Universal Tool Registry (`src/tools/index.ts`)
- `candidate.get_verified_facts` (`READ`)
- `jobs.search_stored` (`READ`)
- `jobs.verify_freshness` (`READ`)
- `jobs.evaluate_eligibility` (`READ`)
- `documents.create_truthful_package` (`WRITE`)
- `applications.prepare_authorized_submission` (`EXTERNAL`)
- `inbox.scan_employer_responses` (`EXTERNAL`)
- `campaigns.get_info` (`READ`)
- `system.inspect_health` (`READ`)
- `account.purge_all_data` (`DESTRUCTIVE` — requires explicit destructive grant; blocked by default)

## 2. 24 Executable Specialist Agents (`src/agents/index.ts`)
All 24 agents (`master-orchestration`, `candidate-intelligence`, `job-discovery`, `job-verification`, `job-matching`, `employer-research`, `salary-research`, `resume-analysis`, `resume-generation`, `cover-letter-generation`, `ats-preparation`, `authorized-application-execution`, `submission-verification`, `gmail-intelligence`, `recruiter-communication`, `interview-preparation`, `calendar-coordination`, `workflow-automation`, `analytics`, `knowledge-retrieval`, `memory-management`, `security`, `reliability`, `budget-protection`) have real executable handlers verified in `tests/milestone3.test.ts` and `tests/v8_reality_engine_gates.test.ts`.
