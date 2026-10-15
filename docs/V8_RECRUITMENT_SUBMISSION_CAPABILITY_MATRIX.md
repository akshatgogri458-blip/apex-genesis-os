# APEX GENESIS V8 — RECRUITMENT SUBMISSION CAPABILITY MATRIX

| Board / Portal Type | Public Read (GET) | Direct Candidate API POST | Default V8 Capability State | Application Lifecycle State |
| :--- | :--- | :--- | :--- | :--- |
| **Greenhouse Public Board (`boards.greenhouse.io`)** | Supported (`SOURCE_RETRIEVED`) | Requires Employer API Key | `PREPARE_AND_HANDOFF` | `AWAITING_HUMAN_APPROVAL` → `SUBMITTED_VERIFIED` (upon receipt reconciliation) |
| **Lever Public Board (`jobs.lever.co`)** | Supported (`SOURCE_RETRIEVED`) | Requires Employer API Key | `PREPARE_AND_HANDOFF` | `AWAITING_HUMAN_APPROVAL` → `SUBMITTED_VERIFIED` |
| **Ashby Public Board (`jobs.ashbyhq.com`)** | Supported (`SOURCE_RETRIEVED`) | Requires Employer API Key | `PREPARE_AND_HANDOFF` | `AWAITING_HUMAN_APPROVAL` → `SUBMITTED_VERIFIED` |
| **Employer Portal with Verified Partner API Key** | Supported | Permitted | `EMPLOYER_API_AUTHORIZED` | `SUBMITTED_VERIFIED` (with confirmation ID) or `SUBMITTED_UNCONFIRMED` (if receipt missing) |
| **Portal Presenting CAPTCHA / Anti-Bot Challenge** | N/A | Strictly Prohibited | `BLOCKED` | `BLOCKED_CAPTCHA` (escalated to `HUMAN_ATTENTION` queue) |
