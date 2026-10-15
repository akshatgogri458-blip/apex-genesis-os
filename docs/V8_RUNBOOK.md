# APEX GENESIS V8 — ZERO-INSTALL BROWSER DEPLOYMENT & DISASTER RECOVERY RUNBOOK

## 1. GitHub Private Repository Upload (`akshatgogri458-blip/apex-genesis-os`)
1. Extract `APEX_GENESIS_V8_REALITY_ENGINE_COMPLETE_SOURCE.zip` on your Windows 11 laptop.
2. Upload to your dedicated private repository `akshatgogri458-blip/apex-genesis-os` (never modifying `APEX` or `apex-neural-core`).
3. GitHub Actions (`.github/workflows/ci.yml`) will automatically run `npm ci`, `npx tsc` across all 3 `tsconfig` files, `npm run lint`, `npm run build`, and `npm test`.

## 2. Cloudflare Free Tier D1 & Worker Setup ($0 Budget)
1. In the Cloudflare Dashboard (**Workers & Pages → D1 SQL Database**), create `apex-genesis-d1` and paste its UUID into `wrangler.toml`.
2. Execute `migrations/0001_genesis_schema.sql`, `migrations/0002_v2_resurrection.sql`, and `migrations/0003_v8_reality_engine.sql` in the D1 Console.
3. Configure secrets: `APEX_SESSION_SECRET` (64-char hex), `GOOGLE_CLIENT_ID` (for verified OIDC sign-in), and `APEX_ENV = "production"`.
