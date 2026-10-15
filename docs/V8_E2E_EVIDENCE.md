# APEX GENESIS V8 — 12-STAGE END-TO-END CAREER JOURNEY & TEST EVIDENCE

Executed via `npm test` (`tests/v8_reality_engine_gates.test.ts` and all 12 suites):
- **Total Suites**: `12 / 12 PASSED`
- **Total Subtests**: `52 / 52 PASSED` (`0 failed`, `0 skipped`)
- **Strict TypeScript Verification (`npm run typecheck`)**: `62 / 62 modules verified (0 errors)`
- **Static Linter (`npm run lint`)**: `66 / 66 files checked (0 violations)`
- **12-Stage End-to-End Career Journey (`tests/v8_reality_engine_gates.test.ts`)**:
  1. Out-of-band registration & verification (`0` tokens leaked in `/api/auth/register` HTTP response).
  2. Resume ingestion with semantic claim-to-excerpt entailment verification (`RESUME_CLAIM_ENTAILMENT_FAILED` on unentailed claims; `DOCUMENT_EVIDENCE` & `USER_CONFIRMED` persisted on entailed claims).
  3. Campaign creation with target roles, remote filter, company exclusions, and daily submission cap.
  4. Official Greenhouse public board fetch (`SOURCE_RETRIEVED`) vs spoofed browser job (`USER_SUPPLIED_UNVERIFIED` with `<script>` stripped).
  5. Explainable multi-factor job matching (`100%` skill match + ESCO gap list).
  6. Goal-variant DAG planning (`8` distinct plan archetypes verified).
  7. Durable task execution across registered tools and browser-closed `worker.scheduled()` cron sweeps.
  8. Truthful resume tailoring (`fullyGrounded: false` when `TEXT_EXTRACTION` claim rejected; `fullyGrounded: true` when 100% grounded).
  9. Submission Capability Registry check (`PREPARE_AND_HANDOFF` for public Greenhouse board without employer API key).
  10. Application handoff (`AWAITING_HUMAN_APPROVAL`) and receipt reconciliation (`reconcileUncertainSubmission` → `SUBMITTED_VERIFIED`).
  11. Tamper-evident SHA-256 audit chain verification (`valid: true`).
  12. Parallel worker atomic lease claiming (`claimRes.meta.changes === 1`) and `TOOL_NOT_IMPLEMENTED` dead-lettering.
