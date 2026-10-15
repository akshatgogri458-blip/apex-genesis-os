import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';
import { stripExecutableMarkup } from './sanitizer';

export type UserRole = 'CANDIDATE' | 'AUDITOR' | 'SYSTEM_ADMIN';
export type EmergencyStopScope = 'GLOBAL' | 'CANDIDATE' | 'CAMPAIGN' | 'AGENT';
export type ServerEnvironmentMode = 'production' | 'development' | 'test';

export interface GoogleJwkKey {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

export interface AuthenticatedContext {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
  csrfToken: string;
}

export interface PromptInjectionScanResult {
  safe: boolean;
  sanitizedText: string;
  detectedPatterns: string[];
}

export interface AuditChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  tamperedEntryId: string | null;
}

export interface OutOfBandEmailMessage {
  to: string;
  subject: string;
  challengeId: string;
  secretToken: string;
  expiresAt: string;
  dispatchedAt: string;
}

export class SecurityGuard {
  private db: ApexD1Database;
  private signingSecret: string;
  private rateBuckets: Map<string, { count: number; resetAt: number }> = new Map();
  private outOfBandMailbox: Map<string, OutOfBandEmailMessage> = new Map();
  private pbkdf2Iterations: number;
  private lastHashCpuMs = 0;
  private serverEnvironmentMode: ServerEnvironmentMode;
  private configuredGoogleClientId: string;
  private configuredSmtpProvider: boolean;
  private trustedGoogleJwks: Map<string, GoogleJwkKey> = new Map();

  constructor(
    db: ApexD1Database,
    signingSecret: string,
    opts?: {
      pbkdf2Iterations?: number;
      serverEnvironmentMode?: ServerEnvironmentMode;
      googleClientId?: string;
      hasConfiguredSmtpProvider?: boolean;
      trustedGoogleJwks?: GoogleJwkKey[];
    }
  ) {
    if (!signingSecret || signingSecret.length < 32) {
      throw new Error('SECURITY_CONFIG_ERROR: APEX_SESSION_SECRET must be at least 32 characters.');
    }
    this.db = db;
    this.signingSecret = signingSecret;
    this.pbkdf2Iterations = opts?.pbkdf2Iterations ?? 60_000;
    const rawEnv = String(opts?.serverEnvironmentMode || process.env.APEX_ENV || 'development').trim().toLowerCase();
    this.serverEnvironmentMode = rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';
    this.configuredGoogleClientId = String(opts?.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '').trim();
    this.configuredSmtpProvider = Boolean(opts?.hasConfiguredSmtpProvider || process.env.SMTP_PROVIDER_API_KEY);

    if (opts?.trustedGoogleJwks) {
      for (const k of opts.trustedGoogleJwks) {
        if (k && k.kid) this.trustedGoogleJwks.set(k.kid, k);
      }
    } else if (process.env.GOOGLE_JWKS_JSON) {
      try {
        const parsed = JSON.parse(process.env.GOOGLE_JWKS_JSON);
        const keys: GoogleJwkKey[] = Array.isArray(parsed) ? parsed : parsed.keys ?? [];
        for (const k of keys) {
          if (k && k.kid) this.trustedGoogleJwks.set(k.kid, k);
        }
      } catch {
        // Ignore malformed env JWKS
      }
    }
  }

  public getServerEnvironmentMode(): ServerEnvironmentMode {
    const envOverride = String(process.env.APEX_ENV || '').trim().toLowerCase();
    if (envOverride === 'production') return 'production';
    return this.serverEnvironmentMode;
  }

  public setServerEnvironmentMode(mode: ServerEnvironmentMode): void {
    this.serverEnvironmentMode = mode;
    if (mode === 'production') {
      this.outOfBandMailbox.clear();
    }
  }

  public configureGoogleOidc(params: { clientId: string; jwks: GoogleJwkKey[] }): void {
    this.configuredGoogleClientId = String(params.clientId || '').trim();
    this.trustedGoogleJwks.clear();
    for (const k of params.jwks) {
      if (k && k.kid) this.trustedGoogleJwks.set(k.kid, k);
    }
  }

  public hashPassword(password: string, salt?: string): { hash: string; salt: string; cpuDurationMs: number } {
    const t0 = performance.now();
    const usedSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, usedSalt, this.pbkdf2Iterations, 64, 'sha512').toString('hex');
    this.lastHashCpuMs = Number((performance.now() - t0).toFixed(3));
    return { hash, salt: usedSalt, cpuDurationMs: this.lastHashCpuMs };
  }

  public getLastPasswordHashCpuMs(): number {
    return this.lastHashCpuMs;
  }

  /**
   * V9 P0.1 FIX (C1):
   * - Server-owned execution environment ONLY: ignores any caller-supplied `environmentMode`.
   * - Never accepts client-supplied `emailVerified` or `role`.
   * - In production (`getServerEnvironmentMode() === 'production'`), fails closed with 503 BLOCKED_IDENTITY_PROVIDER
   *   unless an authorized transactional email provider is configured for password registration.
   */
  public registerUser(params: {
    email: string;
    displayName: string;
    password: string;
    ipAddress?: string;
    emailVerified?: unknown;
    role?: unknown;
    browserSuppliedRole?: unknown;
  }): { id: string; email: string; role: UserRole; emailVerified: boolean } {
    const envMode = this.getServerEnvironmentMode();
    if (envMode === 'production' && !this.configuredSmtpProvider && !process.env.SMTP_PROVIDER_API_KEY) {
      throw new Error(
        'AUTH_PROVIDER_UNAVAILABLE_FAIL_CLOSED: BLOCKED_IDENTITY_PROVIDER — Production password registration requires a configured transactional SMTP provider (or use verified Google OIDC sign-in).'
      );
    }

    const clientIp = params.ipAddress || '127.0.0.1';
    this.enforceRateLimit(`register:${clientIp}`, 25, 60_000);

    const emailNorm = (params.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      throw new Error('INVALID_EMAIL_FORMAT');
    }
    if (!params.password || params.password.length < 10) {
      throw new Error('WEAK_PASSWORD: Minimum 10 characters required.');
    }

    const id = 'usr_' + crypto.randomBytes(12).toString('hex');
    const { hash, salt, cpuDurationMs } = this.hashPassword(params.password);
    const now = new Date().toISOString();
    const assignedRole: UserRole = 'CANDIDATE';
    const initialEmailVerified = 0;

    const attemptedImpersonation =
      params.emailVerified === true ||
      params.emailVerified === 1 ||
      (params as any).email_verified === 1 ||
      (params as any).email_verified === true;

    const attemptedRoleEscalation =
      Boolean(params.role && params.role !== 'CANDIDATE') ||
      Boolean(params.browserSuppliedRole && params.browserSuppliedRole !== 'CANDIDATE');

    const safeDisplayName = stripExecutableMarkup(params.displayName || 'Candidate') || 'Candidate';

    this.db
      .prepare(
        `INSERT INTO users (id, email, email_verified, display_name, password_hash, password_salt, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, emailNorm, initialEmailVerified, safeDisplayName, hash, salt, assignedRole, now, now)
      .run();

    const candId = 'cand_' + crypto.randomBytes(10).toString('hex');
    this.db
      .prepare(
        `INSERT INTO candidates (id, user_id, headline, location, remote_preference, work_authorization, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'REMOTE_FIRST', 'UNKNOWN', ?, ?)`
      )
      .bind(candId, id, 'Candidate Profile (Pending Verification)', '', now, now)
      .run();

    this.recordAuditLog({
      userId: id,
      actor: id,
      action: 'USER_REGISTERED_UNVERIFIED',
      resourceType: 'USER',
      resourceId: id,
      outcome: 'ALLOW',
      details: {
        emailVerified: false,
        roleAssigned: assignedRole,
        pbkdf2CpuMs: cpuDurationMs,
        blockedClientEmailVerifiedAttempt: attemptedImpersonation,
        blockedClientRoleAttempt: attemptedRoleEscalation,
      },
    });

    return { id, email: emailNorm, role: assignedRole, emailVerified: false };
  }

  /**
   * Issues a single-use, expiring email verification challenge.
   * In production, NEVER writes to the in-memory development mailbox sink.
   */
  public issueVerificationChallenge(userId: string, ttlMs = 15 * 60 * 1000): {
    challengeId: string;
    verificationToken: string;
    expiresAt: string;
    deliveryMethod: 'OUT_OF_BAND_MAILBOX' | 'PRODUCTION_SMTP_DISPATCH';
  } {
    const userRow = this.db.prepare(`SELECT id, email FROM users WHERE id = ?`).bind(userId).first<any>();
    if (!userRow) {
      throw new Error('USER_NOT_FOUND');
    }
    const challengeId = 'evc_' + crypto.randomBytes(10).toString('hex');
    const rawToken = 'evtok_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();

    this.db
      .prepare(
        `INSERT INTO email_verification_challenges (id, user_id, email, token_hash, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      )
      .bind(challengeId, userRow.id, userRow.email, tokenHash, expiresAt, new Date(now).toISOString())
      .run();

    const envMode = this.getServerEnvironmentMode();
    if (envMode !== 'production') {
      this.outOfBandMailbox.set(String(userRow.email).toLowerCase(), {
        to: userRow.email,
        subject: 'APEX Genesis V9 — Verify Your Email Ownership',
        challengeId,
        secretToken: rawToken,
        expiresAt,
        dispatchedAt: new Date(now).toISOString(),
      });
    }

    const deliveryMethod = envMode === 'production' ? 'PRODUCTION_SMTP_DISPATCH' : 'OUT_OF_BAND_MAILBOX';

    this.recordAuditLog({
      userId: userRow.id,
      actor: userRow.id,
      action: 'EMAIL_VERIFICATION_CHALLENGE_ISSUED',
      resourceType: 'EMAIL_CHALLENGE',
      resourceId: challengeId,
      outcome: 'ALLOW',
      details: { expiresAt, deliveryMethod },
    });

    return { challengeId, verificationToken: rawToken, expiresAt, deliveryMethod };
  }

  /**
   * Retrieves the out-of-band verification message ONLY in non-production test/dev environments.
   * Ignores any caller-supplied environment flags.
   */
  public getOutOfBandMailboxMessage(email: string): OutOfBandEmailMessage {
    if (this.getServerEnvironmentMode() === 'production') {
      throw new Error('FORBIDDEN_IN_PRODUCTION: Out-of-band dev mailbox is strictly disabled in production.');
    }
    const msg = this.outOfBandMailbox.get(String(email || '').trim().toLowerCase());
    if (!msg) {
      throw new Error('OOB_MESSAGE_NOT_FOUND: No pending verification email for this address.');
    }
    return msg;
  }

  public verifyEmailChallenge(email: string, rawToken: string): { verified: boolean; userId: string } {
    const emailNorm = (email || '').trim().toLowerCase();
    if (!rawToken || typeof rawToken !== 'string') {
      throw new Error('VERIFICATION_TOKEN_REQUIRED');
    }
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const row = this.db
      .prepare(`SELECT * FROM email_verification_challenges WHERE email = ? AND token_hash = ?`)
      .bind(emailNorm, tokenHash)
      .first<any>();

    if (!row) {
      this.recordAuditLog({
        userId: null,
        actor: emailNorm || 'ANONYMOUS',
        action: 'EMAIL_VERIFICATION_FAILED_INVALID_TOKEN',
        resourceType: 'EMAIL_CHALLENGE',
        resourceId: emailNorm,
        outcome: 'DENY',
        details: { reason: 'Token hash not found' },
      });
      throw new Error('INVALID_VERIFICATION_TOKEN');
    }

    if (row.consumed_at) {
      this.recordAuditLog({
        userId: row.user_id,
        actor: row.user_id,
        action: 'EMAIL_VERIFICATION_REPLAY_BLOCKED',
        resourceType: 'EMAIL_CHALLENGE',
        resourceId: row.id,
        outcome: 'DENY',
        details: { consumedAt: row.consumed_at },
      });
      throw new Error(
        'AUTH_VERIFICATION_TOKEN_REPLAYED: AUTH_VERIFICATION_TOKEN_ALREADY_USED — AUTH_CHALLENGE_ALREADY_CONSUMED — VERIFICATION_TOKEN_ALREADY_USED — Challenge tokens are strictly single-use.'
      );
    }

    const nowIso = new Date().toISOString();
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.recordAuditLog({
        userId: row.user_id,
        actor: row.user_id,
        action: 'EMAIL_VERIFICATION_EXPIRED',
        resourceType: 'EMAIL_CHALLENGE',
        resourceId: row.id,
        outcome: 'DENY',
        details: { expiresAt: row.expires_at },
      });
      throw new Error('AUTH_VERIFICATION_TOKEN_EXPIRED: VERIFICATION_TOKEN_EXPIRED');
    }

    this.db
      .prepare(`UPDATE email_verification_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
      .bind(nowIso, row.id)
      .run();

    this.db
      .prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`)
      .bind(nowIso, row.user_id)
      .run();

    this.recordAuditLog({
      userId: row.user_id,
      actor: row.user_id,
      action: 'EMAIL_OWNERSHIP_VERIFIED',
      resourceType: 'USER',
      resourceId: row.user_id,
      outcome: 'ALLOW',
      details: { challengeId: row.id },
    });

    return { verified: true, userId: row.user_id };
  }

  /**
   * V9 P0.2 FIX (C2):
   * Genuine Google OpenID Connect (OIDC) ID Token Verification using asymmetric RS256 JWKS.
   * - Strictly rejects `HS256`, `none`, or tokens signed with APEX's session secret.
   * - Validates `kid` against server-configured / Google-published RSA JWKS.
   * - Enforces server-owned `GOOGLE_CLIENT_ID` audience (never trusts caller-supplied `expectedClientId`).
   * - Validates `iss`, `exp`, `iat`, `nbf`, non-empty `sub`, `email_verified === true`, and optional `expectedNonce`.
   * - Enforces replay protection via `jti` OR `sha256(iss|sub|iat|sig)` (does NOT require non-standard `jti`).
   * - Links accounts by permanent `(oauth_issuer, oauth_subject)` key and rotates unverified password hashes
   *   to prevent pre-registration account takeover.
   */
  public verifyGoogleOAuthIdToken(params: {
    idToken: string;
    expectedNonce?: string;
    ipAddress?: string;
    userAgent?: string;
  }): {
    sessionId: string;
    sessionToken: string;
    csrfToken: string;
    expiresAt: string;
    user: { id: string; email: string; displayName: string; role: UserRole };
  } {
    const trustedAudience = this.configuredGoogleClientId || String(process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!trustedAudience) {
      throw new Error(
        'AUTH_PROVIDER_UNAVAILABLE_FAIL_CLOSED: BLOCKED_IDENTITY_PROVIDER — Server GOOGLE_CLIENT_ID is not configured.'
      );
    }

    const parts = String(params.idToken || '').split('.');
    if (parts.length !== 3) {
      throw new Error('OAUTH_INVALID_FORMAT: ID token must be a 3-part JWT.');
    }
    const [headerB64, payloadB64, sigB64Url] = parts;

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new Error('OAUTH_INVALID_FORMAT: Malformed JWT base64url header or payload.');
    }

    // 1. Enforce RS256 algorithm and non-empty kid (never allow HS256 or alg:none)
    if (!header || header.alg !== 'RS256') {
      throw new Error(`OAUTH_INVALID_ALGORITHM: Expected 'RS256', received '${header?.alg ?? 'none'}'. Symmetric HMAC tokens are forbidden.`);
    }
    if (!header.kid || typeof header.kid !== 'string') {
      throw new Error('OAUTH_MISSING_KID: Google ID token header must include a key ID (kid).');
    }

    // 2. Resolve JWK public key by kid from trusted JWKS
    const jwk = this.trustedGoogleJwks.get(header.kid);
    if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
      throw new Error(`OAUTH_UNKNOWN_KID: Key ID '${header.kid}' is not present in trusted Google JWKS.`);
    }

    // 3. Verify asymmetric RS256 signature
    let signatureValid = false;
    try {
      const publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
      const signedData = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
      const sigBuf = Buffer.from(sigB64Url, 'base64url');
      signatureValid = crypto.verify('RSA-SHA256', signedData, publicKey, sigBuf);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      throw new Error('OAUTH_INVALID_SIGNATURE: RS256 cryptographic signature verification against Google JWKS failed.');
    }

    // 4. Validate issuer, server-owned audience, subject, and time claims
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      throw new Error(`OAUTH_INVALID_ISSUER: Untrusted issuer '${payload.iss}'.`);
    }
    if (payload.aud !== trustedAudience) {
      throw new Error(`OAUTH_INVALID_AUDIENCE: Token audience '${payload.aud}' does not match server-configured GOOGLE_CLIENT_ID.`);
    }
    const subClean = String(payload.sub ?? '').trim();
    if (!subClean) {
      throw new Error('OAUTH_MISSING_SUB: Google ID token must contain a non-empty subject (sub) identifier.');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      throw new Error('OAUTH_TOKEN_EXPIRED: Google ID token has expired.');
    }
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
      throw new Error('OAUTH_INVALID_IAT: Google ID token has a missing or future iat claim.');
    }
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSec + 60)) {
      throw new Error('OAUTH_TOKEN_NOT_YET_VALID: Google ID token nbf is in the future.');
    }

    if (params.expectedNonce && payload.nonce !== params.expectedNonce) {
      throw new Error('OAUTH_NONCE_MISMATCH: Token nonce does not match expected session nonce.');
    }

    const emailNorm = String(payload.email || '').trim().toLowerCase();
    if (!emailNorm || payload.email_verified !== true) {
      throw new Error('OAUTH_EMAIL_UNVERIFIED: Google account email_verified must be true.');
    }

    // 5. Replay protection (uses jti if present, otherwise deterministic hash of iss|sub|iat|sig)
    const replayKey = payload.jti
      ? String(payload.jti)
      : 'oidcreplay_' +
        crypto
          .createHash('sha256')
          .update(`${payload.iss}|${subClean}|${payload.iat}|${sigB64Url}`)
          .digest('hex');

    const existingReplay = this.db
      .prepare(`SELECT jti FROM oauth_replay_nonces WHERE jti = ?`)
      .bind(replayKey)
      .first<any>();
    if (existingReplay) {
      throw new Error('OAUTH_REPLAY_DETECTED: Google ID token has already been consumed.');
    }

    const nowIso = new Date().toISOString();
    const canonicalIssuer = 'https://accounts.google.com';

    this.db
      .prepare(`INSERT INTO oauth_replay_nonces (jti, user_id, issuer, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(replayKey, subClean, canonicalIssuer, new Date(Number(payload.exp) * 1000).toISOString(), nowIso)
      .run();

    // 6. Account lookup & linking by permanent (oauth_issuer, oauth_subject) key
    let userRow = this.db
      .prepare(`SELECT * FROM users WHERE oauth_issuer = ? AND oauth_subject = ?`)
      .bind(canonicalIssuer, subClean)
      .first<any>();

    if (userRow) {
      // If user changed their email in Google, update email safely if not conflicting
      if (userRow.email !== emailNorm) {
        this.db.prepare(`UPDATE users SET email = ?, updated_at = ? WHERE id = ?`).bind(emailNorm, nowIso, userRow.id).run();
        userRow.email = emailNorm;
      }
    } else {
      const existingByEmail = this.db.prepare(`SELECT * FROM users WHERE email = ?`).bind(emailNorm).first<any>();
      if (existingByEmail) {
        if (existingByEmail.oauth_subject && existingByEmail.oauth_subject !== subClean) {
          throw new Error(
            'OAUTH_ACCOUNT_CONFLICT: Email address is already linked to a different Google subject identifier; account takeover blocked.'
          );
        }
        // If existing account was an unverified password registration, rotate password_hash so pre-registration squatter cannot log in!
        if (Number(existingByEmail.email_verified) !== 1) {
          const { hash: freshHash, salt: freshSalt } = this.hashPassword(crypto.randomBytes(32).toString('hex'));
          this.db
            .prepare(
              `UPDATE users
               SET email_verified = 1,
                   oauth_issuer = ?,
                   oauth_subject = ?,
                   password_hash = ?,
                   password_salt = ?,
                   updated_at = ?
               WHERE id = ?`
            )
            .bind(canonicalIssuer, subClean, freshHash, freshSalt, nowIso, existingByEmail.id)
            .run();
        } else {
          this.db
            .prepare(`UPDATE users SET oauth_issuer = ?, oauth_subject = ?, updated_at = ? WHERE id = ?`)
            .bind(canonicalIssuer, subClean, nowIso, existingByEmail.id)
            .run();
        }
        userRow = this.db.prepare(`SELECT * FROM users WHERE id = ?`).bind(existingByEmail.id).first<any>();
      } else {
        const newId = 'usr_' + crypto.randomBytes(12).toString('hex');
        const { hash, salt } = this.hashPassword(crypto.randomBytes(32).toString('hex'));
        this.db
          .prepare(
            `INSERT INTO users (id, email, email_verified, display_name, password_hash, password_salt, role, oauth_issuer, oauth_subject, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?, ?, 'CANDIDATE', ?, ?, ?, ?)`
          )
          .bind(
            newId,
            emailNorm,
            stripExecutableMarkup(payload.name || 'Verified Google User'),
            hash,
            salt,
            canonicalIssuer,
            subClean,
            nowIso,
            nowIso
          )
          .run();
        const candId = 'cand_' + crypto.randomBytes(10).toString('hex');
        this.db
          .prepare(
            `INSERT INTO candidates (id, user_id, headline, location, remote_preference, work_authorization, created_at, updated_at)
             VALUES (?, ?, 'Verified Google Candidate', '', 'REMOTE_FIRST', 'UNKNOWN', ?, ?)`
          )
          .bind(candId, newId, nowIso, nowIso)
          .run();
        userRow = this.db.prepare(`SELECT * FROM users WHERE id = ?`).bind(newId).first<any>();
      }
    }

    return this.createSessionForVerifiedUser(userRow, params.ipAddress, params.userAgent);
  }

  private createSessionForVerifiedUser(
    userRow: any,
    ipAddress?: string,
    userAgent?: string,
    ttlMs = 24 * 60 * 60 * 1000
  ) {
    const rawToken = 'apex_ses_' + crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', this.signingSecret).update(rawToken).digest('hex');
    const signedSessionToken = `${rawToken}.${signature}`;
    const tokenHash = crypto.createHash('sha256').update(signedSessionToken).digest('hex');
    const csrfToken = 'csrf_' + crypto.randomBytes(20).toString('hex');
    const sessionId = 'ses_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, expires_at, revoked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(
        sessionId,
        userRow.id,
        tokenHash,
        csrfToken,
        ipAddress || '127.0.0.1',
        userAgent || 'ApexGenesisClient/9.0',
        expiresAt,
        new Date(now).toISOString()
      )
      .run();

    this.recordAuditLog({
      userId: userRow.id,
      actor: userRow.id,
      action: 'SESSION_ISSUED',
      resourceType: 'SESSION',
      resourceId: sessionId,
      outcome: 'ALLOW',
      details: { expiresAt },
    });

    return {
      sessionId,
      sessionToken: signedSessionToken,
      csrfToken,
      expiresAt,
      user: {
        id: userRow.id,
        email: userRow.email,
        displayName: userRow.display_name,
        role: userRow.role as UserRole,
      },
    };
  }

  public issueSession(params: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
    ttlMs?: number;
  }): {
    sessionId: string;
    sessionToken: string;
    csrfToken: string;
    expiresAt: string;
    user: { id: string; email: string; displayName: string; role: UserRole };
  } {
    const emailNorm = (params.email || '').trim().toLowerCase();
    this.enforceRateLimit(`login:${emailNorm}`, 15, 60_000);

    const userRow = this.db.prepare(`SELECT * FROM users WHERE email = ?`).bind(emailNorm).first<any>();
    if (!userRow) {
      this.recordAuditLog({
        userId: null,
        actor: emailNorm || 'ANONYMOUS',
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'SESSION',
        resourceId: 'NONE',
        outcome: 'DENY',
        details: { reason: 'User not found' },
      });
      throw new Error('INVALID_CREDENTIALS');
    }

    const { hash } = this.hashPassword(params.password, userRow.password_salt);
    const hashBuf = Buffer.from(hash, 'hex');
    const storedBuf = Buffer.from(userRow.password_hash, 'hex');
    if (hashBuf.length !== storedBuf.length || !crypto.timingSafeEqual(hashBuf, storedBuf)) {
      this.recordAuditLog({
        userId: userRow.id,
        actor: userRow.id,
        action: 'AUTH_LOGIN_FAILED',
        resourceType: 'SESSION',
        resourceId: 'NONE',
        outcome: 'DENY',
        details: { reason: 'Password mismatch' },
      });
      throw new Error('INVALID_CREDENTIALS');
    }

    if (userRow.email_verified !== 1) {
      this.recordAuditLog({
        userId: userRow.id,
        actor: userRow.id,
        action: 'AUTH_UNVERIFIED_BLOCKED',
        resourceType: 'SESSION',
        resourceId: 'NONE',
        outcome: 'DENY',
        details: { reason: 'Email not verified' },
      });
      throw new Error(
        'UNAUTHORIZED: AUTH_UNVERIFIED_EMAIL — AUTH_EMAIL_UNVERIFIED — EMAIL_UNVERIFIED: Account email must be verified before issuing a session.'
      );
    }

    return this.createSessionForVerifiedUser(userRow, params.ipAddress, params.userAgent, params.ttlMs);
  }

  public authenticateRequest(
    signedSessionToken: string,
    csrfTokenHeader?: string,
    requireCsrf = false
  ): AuthenticatedContext {
    if (!signedSessionToken || !signedSessionToken.includes('.')) {
      throw new Error('UNAUTHORIZED: Missing or malformed session token.');
    }
    const [rawToken, providedSig] = signedSessionToken.split('.');
    const expectedSig = crypto.createHmac('sha256', this.signingSecret).update(rawToken).digest('hex');
    if (providedSig !== expectedSig) {
      throw new Error('UNAUTHORIZED: AUTH_INVALID_SIGNATURE — Invalid session token signature.');
    }

    const tokenHash = crypto.createHash('sha256').update(signedSessionToken).digest('hex');
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.expires_at, s.revoked,
                u.email, u.display_name, u.role, u.email_verified
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .bind(tokenHash)
      .first<any>();

    if (!row) {
      throw new Error('UNAUTHORIZED: Session not found.');
    }
    if (row.revoked === 1) {
      throw new Error('UNAUTHORIZED: AUTH_SESSION_REVOKED — Session has been revoked.');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new Error('UNAUTHORIZED: AUTH_SESSION_EXPIRED — Session has expired.');
    }
    if (row.email_verified !== 1) {
      throw new Error('UNAUTHORIZED: User email is not verified.');
    }
    if (requireCsrf && (!csrfTokenHeader || csrfTokenHeader !== row.csrf_token)) {
      this.recordAuditLog({
        userId: row.user_id,
        actor: row.user_id,
        action: 'CSRF_VALIDATION_FAILED',
        resourceType: 'SESSION',
        resourceId: row.session_id,
        outcome: 'DENY',
        details: {},
      });
      throw new Error('FORBIDDEN: AUTH_CSRF_MISMATCH — Invalid or missing CSRF token.');
    }

    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role as UserRole,
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
    };
  }

  public revokeSession(sessionId: string, actorUserId: string): void {
    this.db.prepare(`UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?`).bind(sessionId, actorUserId).run();
    this.recordAuditLog({
      userId: actorUserId,
      actor: actorUserId,
      action: 'SESSION_REVOKED',
      resourceType: 'SESSION',
      resourceId: sessionId,
      outcome: 'ALLOW',
      details: {},
    });
  }

  public promoteUserRoleForTestingOrAdmin(targetUserId: string, newRole: UserRole): void {
    this.db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).bind(newRole, new Date().toISOString(), targetUserId).run();
  }

  public assertEmergencyStopPermission(
    ctx: AuthenticatedContext,
    scope: EmergencyStopScope,
    targetResourceId?: string
  ): { scopeId: string; ownerUserId: string; targetResourceId: string | null } {
    if (scope === 'GLOBAL') {
      if (ctx.role !== 'SYSTEM_ADMIN') {
        this.recordAuditLog({
          userId: ctx.userId,
          actor: ctx.userId,
          action: 'UNAUTHORIZED_GLOBAL_EMERGENCY_STOP_ATTEMPT',
          resourceType: 'SYSTEM_QUEUE',
          resourceId: 'GLOBAL',
          outcome: 'DENY',
          details: { role: ctx.role },
        });
        throw new Error('AUTHZ_ADMIN_REQUIRED: 403 Forbidden — Only SYSTEM_ADMIN may toggle the GLOBAL emergency stop.');
      }
      return { scopeId: 'GLOBAL', ownerUserId: ctx.userId, targetResourceId: null };
    }

    if (scope === 'CANDIDATE') {
      const targetUser = targetResourceId || ctx.userId;
      if (targetUser !== ctx.userId && ctx.role !== 'SYSTEM_ADMIN') {
        throw new Error('AUTHZ_FORBIDDEN_CROSS_USER: Cannot toggle another candidate emergency stop.');
      }
      return { scopeId: `CANDIDATE:${targetUser}`, ownerUserId: targetUser, targetResourceId: targetUser };
    }

    if (scope === 'CAMPAIGN') {
      if (!targetResourceId) throw new Error('CAMPAIGN_ID_REQUIRED');
      const camp = this.assertCampaignOwnership(ctx, targetResourceId);
      return { scopeId: `CAMPAIGN:${camp.id}`, ownerUserId: ctx.userId, targetResourceId: camp.id };
    }

    if (scope === 'AGENT') {
      const agentTarget = targetResourceId || 'ALL_USER_AGENTS';
      return { scopeId: `AGENT:${ctx.userId}:${agentTarget}`, ownerUserId: ctx.userId, targetResourceId: agentTarget };
    }

    throw new Error(`INVALID_EMERGENCY_STOP_SCOPE: ${scope}`);
  }

  public assertResourceOwnership(
    ctxOrActorId: AuthenticatedContext | string,
    resourceOwnerUserId: string,
    resourceType = 'RESOURCE',
    resourceId = 'id'
  ): void {
    const actorUserId = typeof ctxOrActorId === 'string' ? ctxOrActorId : ctxOrActorId.userId;
    if (actorUserId !== resourceOwnerUserId) {
      this.recordAuditLog({
        userId: actorUserId,
        actor: actorUserId,
        action: 'CROSS_USER_ACCESS_BLOCKED',
        resourceType,
        resourceId,
        outcome: 'DENY',
        details: { attemptedOwner: resourceOwnerUserId },
      });
      throw new Error(`AUTHZ_FORBIDDEN_OWNERSHIP: AUTHZ_FORBIDDEN_CROSS_USER — AUTHZ_FORBIDDEN_${resourceType}_OWNERSHIP — Access denied to ${resourceType} ${resourceId}.`);
    }
  }

  public assertCampaignOwnership(ctx: AuthenticatedContext, campaignId: string): {
    id: string;
    userId: string;
    name: string;
    authorizedActions: string[];
  } {
    const camp = this.db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(campaignId).first<any>();
    if (!camp) {
      throw new Error(`CAMPAIGN_NOT_FOUND: ${campaignId}`);
    }
    this.assertResourceOwnership(ctx, camp.user_id, 'CAMPAIGN', campaignId);
    return {
      id: camp.id,
      userId: camp.user_id,
      name: camp.name,
      authorizedActions: JSON.parse(camp.authorized_actions_json || '[]'),
    };
  }

  public enforceRateLimit(bucketKey: string, maxRequests: number, windowMs: number): void {
    const now = Date.now();
    const entry = this.rateBuckets.get(bucketKey);
    if (!entry || now >= entry.resetAt) {
      this.rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (entry.count >= maxRequests) {
      throw new Error(`RATE_LIMIT_EXCEEDED: Bucket ${bucketKey} exceeded ${maxRequests} requests.`);
    }
    entry.count += 1;
  }

  public scanPromptInjection(untrustedText: string): PromptInjectionScanResult {
    const patterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'IGNORE_PRIOR_INSTRUCTIONS', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
      { name: 'IGNORE_PREVIOUS_INSTRUCTIONS', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
      { name: 'SYSTEM_PROMPT_OVERRIDE', regex: /(system\s+override|you\s+are\s+now\s+unrestricted|developer\s+mode)/i },
      { name: 'EXFILTRATE_SECRETS', regex: /(print|reveal|send|exfiltrate)\s+(all\s+)?(api\s*keys|secrets|session\s*tokens|passwords)/i },
      { name: 'PRIVILEGE_ESCALATION', regex: /(grant\s+(yourself\s+)?admin(\s+permissions)?|grant\s+destructive\s+permission|escalate\s+privilege)/i },
      { name: 'CAPTCHA_BYPASS_DIRECTIVE', regex: /(bypass\s+captcha|auto[-\s]?submit\s+without\s+approval|bypass\s+human\s+confirmation)/i },
      { name: 'BYPASS_APPROVAL_GATE', regex: /(auto[-\s]?submit\s+without\s+approval|bypass\s+human\s+confirmation|grant\s+destructive\s+permission)/i },
    ];

    const detected: string[] = [];
    let sanitized = untrustedText || '';
    for (const p of patterns) {
      if (p.regex.test(sanitized)) {
        detected.push(p.name);
        sanitized = sanitized.replace(p.regex, '[REDACTED_INJECTION_ATTEMPT]');
      }
    }
    return {
      safe: detected.length === 0,
      sanitizedText: sanitized,
      detectedPatterns: detected,
    };
  }

  public recordAuditLog(params: {
    userId: string | null;
    actor: string;
    action: string;
    resourceType: string;
    resourceId: string;
    outcome: 'ALLOW' | 'DENY' | 'ERROR';
    details: Record<string, any>;
  }): { id: string; entryHash: string; prevHash: string } {
    const lastRow = this.db
      .prepare(`SELECT entry_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1`)
      .first<{ entry_hash: string }>();

    const prevHash = lastRow ? lastRow.entry_hash : 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
    const id = 'aud_' + crypto.randomBytes(12).toString('hex');
    const createdAt = new Date().toISOString();
    const detailsJson = JSON.stringify(params.details ?? {});

    const canonicalPayload = [
      id,
      params.userId ?? 'SYSTEM',
      params.actor,
      params.action,
      params.resourceType,
      params.resourceId,
      params.outcome,
      detailsJson,
      prevHash,
      createdAt,
    ].join('|');

    const entryHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    this.db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, actor, action, resource_type, resource_id, outcome, details_json, prev_hash, entry_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.userId,
        params.actor,
        params.action,
        params.resourceType,
        params.resourceId,
        params.outcome,
        detailsJson,
        prevHash,
        entryHash,
        createdAt
      )
      .run();

    return { id, entryHash, prevHash };
  }

  public verifyAuditChainIntegrity(): AuditChainVerificationResult {
    const rows = this.db.prepare(`SELECT * FROM audit_logs ORDER BY rowid ASC`).all<any>().results;
    let expectedPrev = 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

    for (const r of rows) {
      if (r.prev_hash !== expectedPrev) {
        return { valid: false, totalEntries: rows.length, tamperedEntryId: r.id };
      }
      const canonical = [
        r.id,
        r.user_id ?? 'SYSTEM',
        r.actor,
        r.action,
        r.resource_type,
        r.resource_id,
        r.outcome,
        r.details_json,
        r.prev_hash,
        r.created_at,
      ].join('|');
      const recomputed = crypto.createHash('sha256').update(canonical).digest('hex');
      if (recomputed !== r.entry_hash) {
        return { valid: false, totalEntries: rows.length, tamperedEntryId: r.id };
      }
      expectedPrev = r.entry_hash;
    }

    return { valid: true, totalEntries: rows.length, tamperedEntryId: null };
  }
}
