# APEX GENESIS V8 — PROVIDER AUTHENTICATION & AUTHORIZATION MATRIX

| Provider | Auth Mechanism | Required Scopes / Secrets | Current Sandbox Status | Production Fail-Closed Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **APEX Native Auth** | PBKDF2-HMAC-SHA512 + HMAC-SHA256 `HttpOnly; SameSite=Strict` cookie + CSRF header | `APEX_SESSION_SECRET` (>= 32 chars) | `LOCAL_REAL_TESTED` | Rejects unverified emails (`401`) and missing CSRF (`403`) |
| **Google OIDC Sign-In** | Server-verified JWT (`iss`, `aud`, `exp`, `email_verified`, `jti` anti-replay) | `GOOGLE_CLIENT_ID` | `LOCAL_REAL_TESTED` (Verifier) / `BLOCKED_EXTERNAL_AUTH` (Live Google Cloud) | Rejects invalid issuer/audience/replayed `jti` |
| **Cloudflare Workers AI** | Edge `env.AI` binding or `CF_ACCOUNT_ID` + `CF_API_TOKEN` | Workers AI Free Tier | `BLOCKED_EXTERNAL_AUTH` (Sandbox Air-Gap) | Falls back to `DETERMINISTIC_FALLBACK` |
| **Greenhouse / Lever / Ashby Public Boards** | Public unauthenticated HTTP GET | None (Public Read API) | `LOCAL_REAL_TESTED` (Adapter + Fixture) | Marks jobs `SOURCE_RETRIEVED`; blocks direct POST submission without employer API key |
| **Google Gmail & Calendar** | OAuth 2.0 least-privilege scopes (`gmail.readonly`, `calendar.events`) | User OAuth consent token | `BLOCKED_EXTERNAL_AUTH` | Reports `NOT_CONNECTED`; never fabricates inbox or calendar data |
