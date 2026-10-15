# APEX GENESIS V8 — PRODUCTION ARCHITECTURE

## 1. Unified Edge & Local Full-Stack Architecture
- **Frontend (`public/index.html`, `src/experience/*`, `src/scenes/*`, `src/interface/*`)**: Frozen V7 Infinity multi-pass WebGL 3D spatial interface connected to unified `/api/*` endpoints with strict separation between `SHOWCASE MODE` and authenticated `LIVE VERIFIED` sessions.
- **Unified API Layer (`src/api/contracts.ts`, `src/api/router.ts`, `src/worker.ts`)**: Exposes identical routes, status codes, and security invariants across the Node HTTP server (`src/server/local-server.ts`) and Cloudflare Worker (`src/worker.ts`).
- **Durable Persistence (`migrations/0001_genesis_schema.sql`, `0002_v2_resurrection.sql`, `0003_v8_reality_engine.sql`)**: 25 normalized SQLite/D1 tables covering identity, OAuth nonces, scoped emergency stops, persistent provider budget ledgers, candidate facts, official & user jobs, matches, campaigns, documents, claim links, resume versions, applications, external effect receipts, plans, tasks, dependencies, dead letters, memories, and SHA-256 hash-chained audit logs.
