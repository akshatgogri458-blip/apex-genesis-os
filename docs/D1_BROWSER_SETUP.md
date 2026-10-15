# APEX database: 100% browser-only setup

The GitHub [database setup workflow](../.github/workflows/apex-d1-initialize.yml) is **manual only**. It never runs by itself and **does not deploy the Worker or enable paid billing**.

What the owner must do once:
1. In Cloudflare, create a **restricted API token** for the single account, granting **Account → D1 → Edit**. Never choose global API key, Account Settings Edit, billing permissions, or broad 'all resources' token.
2. In GitHub repository **Settings → Secrets and variables → Actions → New repository secret**, use name `APEX_D1_MIGRATION_TOKEN` and paste the token there. Don't send token through ChatGPT, Gemini, issues, screenshots or commit files.
3. Open **Actions → APEX — Set up Cloudflare D1 database (manual) → Run workflow**. Select `main`, click Run.
4. Check green result, then return to Cloudflare D1 Overview and confirm approximately 34 tables (33 APEX tables plus Wrangler's migrations metadata table).

Source protection: All 5 migration files are checked locally first; no DROP or DELETE allowed; real database UUID is checked; Wrangler applies recorded migrations. If Cloudflare D1 contains unexpected preexisting tables, investigate them before enabling live app authentication.

**No Worker deployment, OAuth or AI setup is performed here.** After DB setup, configure production secrets in Cloudflare and perform authenticated deployment verification.

Cloudflare D1 migrations documentation: https://developers.cloudflare.com/d1/wrangler-commands/
Cloudflare API token creation: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
