# APEX GENESIS V8 — ZERO-CASH QUOTAS & PERSISTENT BUDGET GOVERNOR

| Provider / Resource | Official Free Tier Allowance | V8 Hard Stop (`BudgetGovernor`) | Scope & Persistence | Fallback / Action on Exhaustion |
| :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Workers Free** | 100,000 req/day, 10 ms CPU/invocation | 90,000 req/day, 60k PBKDF2 (~4ms CPU) | `UTC-day` & `UTC-month` in `provider_budget_ledger` | Rate-limit HTTP `429` |
| **Cloudflare D1 Free** | 5,000,000 rows read/day, 100,000 rows written/day, 50 queries/invocation | 4,500,000 reads/day, 90,000 writes/day, 50 queries/invocation | `provider_budget_ledger` + `CloudflareD1Adapter` | Suspends writes with HTTP `503 D1_QUOTA_EXCEEDED` |
| **Cloudflare Workers AI** | 10,000 Neurons/day | 9,000 Neurons/day | `provider_budget_ledger` + `model_usage_ledger` | Routes to `DeterministicStructuredEngine` (`DETERMINISTIC_FALLBACK`) |
| **Google Gemini Free Tier** | 1,500 RPD (`gemini-2.5-flash`) | 1,400 RPD | `provider_budget_ledger` + `model_usage_ledger` | Routes to `DeterministicStructuredEngine` |
| **Unverified / Paid Providers** | Unknown / Paid | `0` (`BLOCKED_COST_UNVERIFIED`) | Fail-closed in `BudgetGovernor.reserveBudget()` | Throws `BLOCKED_COST_UNVERIFIED` (`503`) |
