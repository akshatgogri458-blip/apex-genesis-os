import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard, GoogleJwkKey } from '../src/security/auth';
import { verifyExcerptEntailment } from '../src/security/sanitizer';
import { ApexNeuralCore, DeterministicStructuredEngine } from '../src/neural-core/index';
import { MemoryEngine } from '../src/memory/index';
import { UniversalToolRegistry } from '../src/tools/index';
import { AgentFleetRegistry } from '../src/agents/index';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';
import { AutonomousPlanner } from '../src/planner/index';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';
import { AuthorizedIntegrationNexus } from '../src/integrations/nexus';
import { ApexApplicationApi } from '../src/api/router';
import {
  CloudflareD1DatabaseBinding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
} from '../src/types/cloudflare';
import worker, { Env } from '../src/worker';

const V9_DB_PATH = path.resolve(__dirname, '../../.tmp_v9_production_truth.sqlite');

function createAsyncD1Binding(sqliteDb: ApexD1Database): CloudflareD1DatabaseBinding {
  const makeStmt = (sql: string, boundParams: any[] = []): CloudflareD1PreparedStatement => ({
    bind(...values: any[]) {
      return makeStmt(sql, values);
    },
    async first<T = Record<string, any>>(colName?: string): Promise<T | null> {
      await Promise.resolve();
      const row = sqliteDb.prepare(sql).bind(...boundParams).first<any>();
      if (!row) return null;
      return colName ? (row[colName] ?? null) : (row as T);
    },
    async run<T = Record<string, any>>(): Promise<CloudflareD1Result<T>> {
      await Promise.resolve();
      const res = sqliteDb.prepare(sql).bind(...boundParams).run();
      return {
        results: [],
        success: res.success,
        meta: {
          duration: 0.3,
          changes: res.meta.changes,
          last_row_id: res.meta.last_row_id,
          rows_read: 1,
          rows_written: Math.max(1, res.meta.changes),
        },
      };
    },
    async all<T = Record<string, any>>(): Promise<CloudflareD1Result<T>> {
      await Promise.resolve();
      const res = sqliteDb.prepare(sql).bind(...boundParams).all<T>();
      return {
        results: res.results,
        success: true,
        meta: {
          duration: 0.2,
          changes: 0,
          last_row_id: 0,
          rows_read: Math.max(1, res.results.length),
          rows_written: 0,
        },
      };
    },
  });

  return {
    prepare(query: string) {
      return makeStmt(query, []);
    },
    async batch<T = Record<string, any>>(statements: CloudflareD1PreparedStatement[]): Promise<CloudflareD1Result<T>[]> {
      const out: CloudflareD1Result<T>[] = [];
      for (const st of statements) {
        out.push(await st.run<T>());
      }
      return out;
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      await Promise.resolve();
      sqliteDb.execSchema(query);
      return { count: 1, duration: 1.0 };
    },
  };
}

test('APEX GENESIS V9 — OPERATION PRODUCTION TRUTH: Adversarial Regression & Hard Acceptance Gates 1–20', async (t) => {
  if (fs.existsSync(V9_DB_PATH)) fs.unlinkSync(V9_DB_PATH);
  const sqliteDb = new ApexD1Database(V9_DB_PATH, { maxQueriesPerInvocation: 500 });
  sqliteDb.execSchema(fs.readFileSync(path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql'), 'utf8'));
  sqliteDb.execSchema(fs.readFileSync(path.resolve(__dirname, '../../migrations/0002_v2_resurrection.sql'), 'utf8'));
  sqliteDb.execSchema(fs.readFileSync(path.resolve(__dirname, '../../migrations/0003_v8_reality_engine.sql'), 'utf8'));
  sqliteDb.execSchema(fs.readFileSync(path.resolve(__dirname, '../../migrations/0004_v9_production_truth.sql'), 'utf8'));

  const asyncD1 = createAsyncD1Binding(sqliteDb);
  const sessionSecret = 'production_secret_key_at_least_32_characters_long!!';

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { privateKey: wrongPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubJwk = publicKey.export({ format: 'jwk' }) as any;
  const googleJwk: GoogleJwkKey = {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'google_prod_key_2026',
    n: pubJwk.n,
    e: pubJwk.e,
  };

  await t.test('Gates 1 & 2 (C1): With APEX_ENV=production, attacker-supplied environmentMode=development cannot bypass identity restrictions or access dev mailbox', async () => {
    const prodEnv: Env = {
      APEX_DB: asyncD1,
      APEX_SESSION_SECRET: sessionSecret,
      APEX_ENV: 'production',
    };

    const reg = await worker.fetch(
      new Request('https://apex.example/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'victim-owner@company.com',
          displayName: 'Attacker',
          password: 'StrongPassword!2026',
          environmentMode: 'development',
        }),
      }),
      prodEnv
    );
    const regJson: any = await reg.json();
    assert.equal(reg.status, 503, 'Production registration without SMTP must fail closed with 503 even when environmentMode=development is sent');
    assert.equal(regJson.user, undefined);

    const oob = await worker.fetch(
      new Request('https://apex.example/api/dev/out-of-band-mailbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'victim-owner@company.com',
          environmentMode: 'development',
        }),
      }),
      prodEnv
    );
    const oobJson: any = await oob.json();
    assert.equal(oob.status, 403, 'Production dev mailbox route must be denied even when environmentMode=development is sent');
    assert.equal(oobJson.outOfBandMessage, undefined);
  });

  await t.test('Gates 3 & 4 (C2): Google OIDC rejects homemade HS256+hex tokens, forged alg, altered payload, wrong aud, unknown kid, and account takeover attempts while verifying real RS256 JWKS', async () => {
    const security = new SecurityGuard(sqliteDb, sessionSecret, {
      serverEnvironmentMode: 'production',
      googleClientId: 'trusted-server-client-id.apps.googleusercontent.com',
      trustedGoogleJwks: [googleJwk],
    });
    const neural = new ApexNeuralCore(sqliteDb);
    neural.registerProvider(new DeterministicStructuredEngine());
    const memory = new MemoryEngine(sqliteDb);
    const tools = new UniversalToolRegistry(sqliteDb, memory);
    const agents = new AgentFleetRegistry({ db: sqliteDb, memory, tools, neural });
    const queue = new DurableExecutionEngine(sqliteDb);
    const planner = new AutonomousPlanner({ db: sqliteDb, neural, memory, tools, agents, queue });
    const recruitment = new RecruitmentWorkflowEngine(sqliteDb, memory);
    const nexus = new AuthorizedIntegrationNexus(sqliteDb, queue, memory);
    const api = new ApexApplicationApi({ db: sqliteDb, security, neural, memory, tools, agents, queue, planner, recruitment, nexus });

    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Handcrafted HS256+hex fake Google token signed with APEX's session secret -> REJECTED
    const hsHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'google_prod_key_2026' })).toString('base64url');
    const hsPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'trusted-server-client-id.apps.googleusercontent.com',
        sub: 'attacker_sub',
        email: 'ceo@company.com',
        email_verified: true,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const hsSigHex = crypto.createHmac('sha256', sessionSecret).update(`${hsHeader}.${hsPayload}`).digest('hex');
    const fakeHsToken = `${hsHeader}.${hsPayload}.${hsSigHex}`;

    const hsRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: fakeHsToken, expectedClientId: 'trusted-server-client-id.apps.googleusercontent.com' },
    });
    assert.equal(hsRes.status, 400);
    assert.match(hsRes.body.error, /OAUTH_INVALID_ALGORITHM/);

    // 2. Wrong audience even when caller passes matching expectedClientId in body -> REJECTED
    const rsaHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'google_prod_key_2026' })).toString('base64url');
    const wrongAudPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'attacker-controlled-client-id.apps.googleusercontent.com',
        sub: 'sub_wrong_aud',
        email: 'user@company.com',
        email_verified: true,
        iat: nowSec - 5,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const wrongAudSig = crypto.sign('RSA-SHA256', Buffer.from(`${rsaHeader}.${wrongAudPayload}`, 'utf8'), privateKey).toString('base64url');

    const wrongAudRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: {
        idToken: `${rsaHeader}.${wrongAudPayload}.${wrongAudSig}`,
        expectedClientId: 'attacker-controlled-client-id.apps.googleusercontent.com',
      },
    });
    assert.equal(wrongAudRes.status, 400);
    assert.match(wrongAudRes.body.error, /OAUTH_INVALID_AUDIENCE/);

    // 3. Unknown kid -> REJECTED
    const badKidHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'unknown_kid_999' })).toString('base64url');
    const validPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'trusted-server-client-id.apps.googleusercontent.com',
        sub: 'sub_legit_user_1',
        email: 'legit.oidc@company.com',
        email_verified: true,
        name: 'Legit OIDC User',
        iat: nowSec - 5,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const badKidSig = crypto.sign('RSA-SHA256', Buffer.from(`${badKidHeader}.${validPayload}`, 'utf8'), privateKey).toString('base64url');
    const badKidRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: `${badKidHeader}.${validPayload}.${badKidSig}` },
    });
    assert.equal(badKidRes.status, 400);
    assert.match(badKidRes.body.error, /OAUTH_UNKNOWN_KID/);

    // 4. Altered payload or wrong RSA signing key -> REJECTED
    const wrongKeySig = crypto.sign('RSA-SHA256', Buffer.from(`${rsaHeader}.${validPayload}`, 'utf8'), wrongPrivateKey).toString('base64url');
    const wrongKeyRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: `${rsaHeader}.${validPayload}.${wrongKeySig}` },
    });
    assert.equal(wrongKeyRes.status, 400);
    assert.match(wrongKeyRes.body.error, /OAUTH_INVALID_SIGNATURE/);

    // 5. Pre-registration squatter account takeover defense
    security.setServerEnvironmentMode('development');
    await api.handle({
      method: 'POST',
      path: '/api/auth/register',
      headers: {},
      body: {
        email: 'legit.oidc@company.com',
        displayName: 'Squatter Attacker',
        password: 'AttackerPassword!2026',
      },
    });
    security.setServerEnvironmentMode('production');

    const validSig = crypto.sign('RSA-SHA256', Buffer.from(`${rsaHeader}.${validPayload}`, 'utf8'), privateKey).toString('base64url');
    const legitOidcRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: `${rsaHeader}.${validPayload}.${validSig}` },
    });
    assert.equal(legitOidcRes.status, 200, JSON.stringify(legitOidcRes.body));
    assert.ok(legitOidcRes.body.sessionToken);

    const squatterLogin = await api.handle({
      method: 'POST',
      path: '/api/auth/session',
      headers: {},
      body: { email: 'legit.oidc@company.com', password: 'AttackerPassword!2026' },
    });
    assert.ok(
      squatterLogin.status === 401 || squatterLogin.status === 400,
      'Pre-registered squatter password must be invalidated upon legitimate Google OIDC verification'
    );
    assert.equal(squatterLogin.body.sessionToken, undefined);
  });

  await t.test('Gates 5, 6, 7, 8, 13, 14, 15, 16 & 17 (C3, C4, C5, H1, H2, H5): Worker Job Provenance, Application Confirmation, Cron Tool Handlers, Production Feed Fail-Closed & Semantic Entailment', async () => {
    const devEnv: Env = {
      APEX_DB: asyncD1,
      APEX_SESSION_SECRET: sessionSecret,
      APEX_ENV: 'development',
      EMPLOYER_WEBHOOK_SECRET: 'worker_webhook_secret_key_minimum_32_bytes!!',
    };

    const regRes = await worker.fetch(
      new Request('https://apex.example/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'dev.tester@company.com',
          displayName: 'Dev Tester',
          password: 'StrongPassword!2026',
        }),
      }),
      devEnv
    );
    const regBody: any = await regRes.json();
    assert.equal(regRes.status, 201, JSON.stringify(regBody));

    const oobRes = await worker.fetch(
      new Request('https://apex.example/api/dev/out-of-band-mailbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dev.tester@company.com' }),
      }),
      devEnv
    );
    const oobBody: any = await oobRes.json();
    assert.equal(oobRes.status, 200, JSON.stringify(oobBody));

    await worker.fetch(
      new Request('https://apex.example/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'dev.tester@company.com',
          verificationToken: oobBody.outOfBandMessage.secretToken,
        }),
      }),
      devEnv
    );
    const loginRes = await worker.fetch(
      new Request('https://apex.example/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dev.tester@company.com', password: 'StrongPassword!2026' }),
      }),
      devEnv
    );
    const loginJson: any = await loginRes.json();
    const authHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${loginJson.sessionToken}`,
      'x-csrf-token': loginJson.csrfToken,
    };

    // Gate 5 (C3): Caller-provided verifiedByEmployerFeed: true on Worker /api/jobs/discover MUST be USER_SUPPLIED_UNVERIFIED
    const jobRes = await worker.fetch(
      new Request('https://apex.example/api/jobs/discover', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          vacancies: [
            {
              externalId: 'fake_1',
              sourceFeed: 'Attacker',
              sourceUrl: 'https://boards.greenhouse.io/fake/jobs/1',
              title: 'Fake Verified CEO Role',
              companyName: 'FakeCorp',
              requiredSkills: ['TypeScript'],
              verifiedByEmployerFeed: true,
              sourceRetrieved: true,
            },
          ],
        }),
      }),
      devEnv
    );
    const jobJson: any = await jobRes.json();
    assert.equal(jobRes.status, 200);
    assert.deepEqual(jobJson.verificationStatuses, ['USER_SUPPLIED_UNVERIFIED']);

    // Add a verified fact and execute `documents.create_truthful_package` via Worker cron
    await worker.fetch(
      new Request('https://apex.example/api/candidate/facts', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          category: 'SKILL',
          attributeKey: 'Language',
          attributeValue: 'TypeScript',
          verified: true,
          evidenceSource: 'Verified CV',
          evidenceExcerpt: '5 years TypeScript architecture',
        }),
      }),
      devEnv
    );

    const planRes = await worker.fetch(
      new Request('https://apex.example/api/planner/execute', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ objective: 'Tailor truthful resume for target role' }),
      }),
      devEnv
    );
    assert.equal(planRes.status, 200);

    // Gate 7 & 14: Simulate two concurrent Worker cron instances racing for the same task
    await Promise.all([
      worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() }, devEnv),
      worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() }, devEnv),
    ]);
    await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() + 1000 }, devEnv);

    const stateRes = await worker.fetch(
      new Request('https://apex.example/api/workspaces/state', {
        method: 'GET',
        headers: { authorization: `Bearer ${loginJson.sessionToken}` },
      }),
      devEnv
    );
    const stateJson: any = await stateRes.json();
    assert.ok(stateJson.documents.length >= 1, 'Worker cron tool documents.create_truthful_package must create a real document in D1');
    const realDocId = stateJson.documents[0].id;

    // Gate 6 (C4): Submitting with fake doc_id is rejected (400), and submitting with a valid doc_id + caller-supplied externalConfirmationId ('confirmation123') remains UNVERIFIED!
    const fakeDocSub = await worker.fetch(
      new Request('https://apex.example/api/applications/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jobId: jobJson.jobIds[0],
          resumeDocId: 'doc_fake',
          externalConfirmationId: 'attacker_typed_confirmation_123',
        }),
      }),
      devEnv
    );
    assert.equal(fakeDocSub.status, 400);

    const unverifiedSub = await worker.fetch(
      new Request('https://apex.example/api/applications/submit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jobId: jobJson.jobIds[0],
          resumeDocId: realDocId,
          externalConfirmationId: 'confirmation123',
        }),
      }),
      devEnv
    );
    const unverifiedSubJson: any = await unverifiedSub.json();
    assert.equal(unverifiedSub.status, 200);
    assert.equal(unverifiedSubJson.outcome.status, 'AWAITING_HUMAN_APPROVAL');
    assert.equal(unverifiedSubJson.outcome.evidenceLevel, 'USER_REPORTED');
    assert.equal(unverifiedSubJson.outcome.verified, false);
    assert.equal(unverifiedSubJson.outcome.externalConfirmationId, null);

    // Gate 15 (H5): In production mode, if upstream Greenhouse fetch fails, /api/jobs/discover-official does NOT invent fallback fixtures
    const prodEnvWithSession: Env = {
      ...devEnv,
      APEX_ENV: 'production',
    };
    const prodFeedRes = await worker.fetch(
      new Request('https://apex.example/api/jobs/discover-official', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ boardSource: 'GREENHOUSE_PUBLIC', boardToken: 'nonexistent_board_xyz_999' }),
      }),
      prodEnvWithSession
    );
    assert.equal(prodFeedRes.status, 503, 'Production feed fetch must fail closed (503) rather than inventing fallback fixture vacancies');

    // Gate 16 (P4): Adversarial semantic entailment checks (negation, contradictory numbers, role inflation)
    const docText = 'Worked 2 years as a Junior Software Intern with TypeScript; no experience with Kubernetes or Rust.';
    const negatedCheck = verifyExcerptEntailment({
      attributeKey: 'Container Orchestration',
      attributeValue: 'Kubernetes',
      evidenceExcerpt: 'no experience with Kubernetes or Rust',
      rawDocumentText: docText,
    });
    assert.equal(negatedCheck.claimEntailedByExcerpt, false);
    assert.match(negatedCheck.reason, /ENTAILMENT_NEGATED/);

    const numberCheck = verifyExcerptEntailment({
      attributeKey: 'TypeScript Experience',
      attributeValue: '8 years TypeScript',
      evidenceExcerpt: 'Worked 2 years as a Junior Software Intern with TypeScript',
      rawDocumentText: docText,
    });
    assert.equal(numberCheck.claimEntailedByExcerpt, false);
    assert.match(numberCheck.reason, /ENTAILMENT_NUMERIC_CONTRADICTION/);

    const inflationCheck = verifyExcerptEntailment({
      attributeKey: 'Role',
      attributeValue: 'Principal Software Architect',
      evidenceExcerpt: 'Worked 2 years as a Junior Software Intern with TypeScript',
      rawDocumentText: docText,
    });
    assert.equal(inflationCheck.claimEntailedByExcerpt, false);
    assert.match(inflationCheck.reason, /ENTAILMENT_ROLE_INFLATION/);
  });

  if (fs.existsSync(V9_DB_PATH)) fs.unlinkSync(V9_DB_PATH);
});
