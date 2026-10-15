# APEX Genesis — Next step (browser only; zero-cost target)

**Current status:** V9.1 source is on GitHub, and the GitHub CI checks pass. The actual Cloudflare Worker, D1 database, Google login, and AI inference have **not** been proven live.

## The only account action required now

Open [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages).

1. Sign in to **your Cloudflare account**.
2. Select **Create application**, then choose the option to **import/connect GitHub**.
3. Authorize the GitHub owner `akshatgogri458-blip` and choose **only** the repository `apex-genesis-os`.

**Do not click Save and Deploy yet.** First confirm the connected repository appears. Cloudflare may require configuring D1 before deployment. Avoid any paid upgrade or credit-card request.

Then return to ChatGPT with the simple message **“Cloudflare connected”**. No local installation or API key pasted into chat is needed.

## Work remaining after connection

- Create the D1 database on Cloudflare **Free**, replace the placeholder `database_id` in `wrangler.toml`, and apply migrations 0001–0005.
- Configure `APEX_SESSION_SECRET` and optional Google OAuth credentials via the **Cloudflare dashboard's secret settings**, not GitHub source files.
- Confirm secure production identity login and a real `/api/health` response.
- Test Workers AI inference and a real employer-hosted job feed with attribution and conservative free-tier budget limits.
- Confirm tasks still execute after the browser is closed; perform a security review before uploading any private resume.
- Do not enable paid billing. Free service allocations can be exhausted and are not unlimited.

## Status definitions

- `SOURCE_VERIFIED`: code exists on GitHub and CI checks pass.
- `BUNDLE_VERIFIED`: Cloudflare dry-run compiles locally; **not** deployed.
- `DEPLOYED_VERIFIED`: a live Cloudflare URL is confirmed.
- `INTEGRATIONS_VERIFIED`: authorized external requests and outputs are confirmed.
- `BLOCKED_EXTERNAL_AUTH`: an owner must authorize Google/Cloudflare/employer credentials.

## Reference

Official Cloudflare dashboard setup: https://developers.cloudflare.com/workers/get-started/dashboard/

Official GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/

Official D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/

**Security:** Keep private resumes, API tokens, employer credentials, Google OAuth secrets, and real user records OUT of this public repository.
