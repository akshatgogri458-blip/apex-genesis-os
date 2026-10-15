# APEX GENESIS V2 — Security & Cryptographic Audit Architecture

## 1. Remediation of CVE-APEX-001 (Email Verification Impersonation)

- **Vulnerability in V1**: `SecurityGuard.registerUser()` accepted `emailVerified: boolean` from the caller, allowing an unauthenticated caller to pass `emailVerified: true` to `POST /api/auth/register` and immediately obtain an authenticated session.
- **V2 Remediation (`src/security/auth.ts` & `src/worker.ts`)**:
  1. `registerUser()` hardcodes `email_verified = 0` and `role = 'CANDIDATE'`. Any caller-supplied `emailVerified`, `email_verified`, `role`, or `browserSuppliedRole` properties are ignored and flagged in `audit_logs`.
  2. `issueVerificationChallenge()` generates a 256-bit cryptographically random token (`evtok_<64_hex_chars>`) and stores only its SHA-256 digest (`token_hash`) in `email_verification_challenges` with a 15-minute expiration (`expires_at`).
  3. `verifyEmailChallenge(email, rawToken)` verifies the SHA-256 hash, rejects expired tokens (`AUTH_VERIFICATION_TOKEN_EXPIRED`), rejects already-used tokens (`AUTH_VERIFICATION_TOKEN_ALREADY_USED`), and atomically marks `consumed_at` and `users.email_verified = 1`.
  4. `issueSession()` refuses to issue a session (`401 AUTH_UNVERIFIED_EMAIL`) until `email_verified === 1`.

## 2. Authorization & Tenant Isolation Invariants

- **Forged Identity Rejection**: Any request body containing a `userId` that differs from the authenticated session's `ctx.userId` is rejected with `403 AUTHZ_FORGED_IDENTITY`.
- **Cross-User & Cross-Campaign Isolation**: `assertResourceOwnership()` and `assertCampaignOwnership()` verify database ownership before any read or write.
- **Server-Derived Tool Permissions**: `POST /api/planner/execute` and `POST /api/tools/invoke` derive `grantedPermissions` strictly on the server from user role and campaign authorization settings — never from client payloads.

## 3. Tamper-Evident SHA-256 Audit Ledger

Every security-relevant event appends a row to `audit_logs` where:
```
entry_hash = SHA256(prev_hash | id | user_id | actor | action | resource_type | resource_id | outcome | details_json | created_at)
```
`verifyAuditChainIntegrity()` recomputes every hash from `GENESIS_00000000000000000000000000000000` forward and identifies the exact `tamperedEntryId` if any historical record is modified.
