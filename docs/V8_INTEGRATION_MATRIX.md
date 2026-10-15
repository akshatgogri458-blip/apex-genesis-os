# APEX GENESIS V8 — EXTERNAL INTEGRATION MATRIX

| Integration | Source File | Read Capability | Write / Side-Effect Capability | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Greenhouse Job Board API** | `src/recruitment/engine.ts` (`fetchOfficialPublicJobBoard`) | `GET /v1/boards/{token}/jobs?content=true` (`SOURCE_RETRIEVED`) | `PREPARE_AND_HANDOFF` (POST requires employer-issued Basic Auth key) | `LOCAL_REAL_TESTED` |
| **Lever Postings API** | `src/recruitment/engine.ts` (`fetchOfficialPublicJobBoard`) | `GET /v0/postings/{site}?mode=json` (`SOURCE_RETRIEVED`) | `PREPARE_AND_HANDOFF` (POST requires employer API key) | `LOCAL_REAL_TESTED` |
| **Ashby Public Job Postings API** | `src/recruitment/engine.ts` (`fetchOfficialPublicJobBoard`) | `GET /posting-api/job-board/{org}` (`SOURCE_RETRIEVED`) | `PREPARE_AND_HANDOFF` | `LOCAL_REAL_TESTED` |
| **Authorized Employer Submission** | `src/integrations/nexus.ts` (`executeAuthorizedSubmission`) | Verifies external receipt ID | Marks `SUBMITTED_VERIFIED` ONLY when external confirmation ID is returned; halts on CAPTCHA (`BLOCKED_CAPTCHA`) | `LOCAL_REAL_TESTED` |
| **Gmail Recruiter Triage** | `src/integrations/nexus.ts` (`ingestRecruiterEmail`) | Classifies `INTERVIEW_INVITE`, `ASSESSMENT`, `OFFER`, `CONFIRMATION`, `REJECTION` | Drafts reply requiring human sign-off | `LOCAL_REAL_TESTED` (Classifier) / `BLOCKED_EXTERNAL_AUTH` (Live Gmail API) |
| **Google Calendar Scheduling** | `src/integrations/nexus.ts` (`scheduleInterviewSlot`), `src/agents/index.ts` | Pairwise overlap detection on `interviews` | Reports `NOT_CONNECTED` until Google Calendar OAuth is linked | `LOCAL_REAL_TESTED` (Overlap Engine) / `BLOCKED_EXTERNAL_AUTH` (Live Calendar API) |
