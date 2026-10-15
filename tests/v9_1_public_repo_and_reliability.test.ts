import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import {
  CANONICAL_PUBLIC_REPO_URL,
  CANONICAL_PUBLIC_REPO_OWNER,
  scanTextForPublicRepoLeaks,
  redactCandidatePiiForPublicExport,
} from '../src/security/public-repo-guard';
import { ApexNeuralCore, DeterministicStructuredEngine } from '../src/neural-core/index';
import { MemoryEngine } from '../src/memory/index';
import { UniversalToolRegistry } from '../src/tools/index';
import { AgentFleetRegistry } from '../src/agents/index';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';
import { AutonomousPlanner } from '../src/planner/index';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';
import { AuthorizedIntegrationNexus } from '../src/integrations/nexus';
import { ApexApplicationApi } from '../src/api/router';
import worker, { Env } from '../src/worker';
import {
  CloudflareD1DatabaseBinding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
} from '../src/types/cloudflare';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_v9_1_reliability_test.sqlite');
const SCHEMA_1 = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');
const SCHEMA_2 = path.resolve(__dirname, '../../migrations/0002_v2_resurrection.sql');
const SCHEMA_3 = path.resolve(__dirname, '../../migrations/0003_v8_reality_engine.sql');
const SCHEMA_4 = path.resolve(__dirname, '../../migrations/0004_v9_production_truth.sql');
const SCHEMA_5 = path.resolve(__dirname, '../../migrations/0005_v9_public_repo_reliability.sql');

function createAsyncD1Binding(sqliteDb: ApexD1Database): CloudflareD1DatabaseBinding {
  const wrapStmt = (sql: string, boundValues: any[] = []): CloudflareD1PreparedStatement => ({
    bind(...values: any[]) {
      return wrapStmt(sql, values);
    },
    async first<T = Record<string, any>>(colName?: string): Promise<T | null> {
      await Promise.resolve();
      const row = sqliteDb.prepare(sql).bind(...boundValues).first<any>();
      if (!row) return null;
      return colName ? (row[colName] ?? null) : (row as T);
    },
    async run<T = Record<string, any>>(): Promise<CloudflareD1Result<T>> {
      await Promise.resolve();
      const res = sqliteDb.prepare(sql).bind(...boundValues).run();
      return {
        results: [],
        success: res.success,
        meta: {
          duration: res.meta.duration_ms,
          changes: res.meta.changes,
          last_row_id: res.meta.last_row_id,
          rows_read: 1,
          rows_written: Math.max(1, res.meta.changes),
        },
      };
    },
    async all<T = Record<string, any>>(): Promise<CloudflareD1Result<T>> {
      await Promise.resolve();
      const res = sqliteDb.prepare(sql).bind(...boundValues).all<T>();
      return {
        results: res.results,
        success: true,
        meta: {
          duration: res.meta.duration_ms,
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
      return wrapStmt(query, []);
    },
    async batch<T = Record<string, any>>(statements: CloudflareD1PreparedStatement[]): Promise<CloudflareD1Result<T>[]> {
      const out: CloudflareD1Result<T>[] = [];
      for (const s of statements) {
        out.push(await s.run<T>());
      }
      return out;
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      await Promise.resolve();
      sqliteDb.exec(query);
      return { count: 1, duration: 1 };
    },
  };
}

test('APEX GENESIS V9.1 — Public Repository Safety, Timestamped Webhook Anti-Replay & Dead-Letter Task Recovery Suite', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.execSchema(fs.readFileSync(SCHEMA_1, 'utf8'));
  db.execSchema(fs.readFileSync(SCHEMA_2, 'utf8'));
  db.execSchema(fs.readFileSync(SCHEMA_3, 'utf8'));
  db.execSchema(fs.readFileSync(SCHEMA_4, 'utf8'));
  db.execSchema(fs.readFileSync(SCHEMA_5, 'utf8'));

  const webhookSecret = 'apex_v9_1_test_employer_webhook_secret_key_64bytes_verified';
  const sessionSecret = 'apex_v9_1_super_secret_session_signing_key_2026_verified_32bytes';

  const security = new SecurityGuard(db, sessionSecret, { serverEnvironmentMode: 'development' });
  const neural = new ApexNeuralCore(db);
  neural.registerProvider(new DeterministicStructuredEngine());
  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory, webhookSecret);
  const api = new ApexApplicationApi({
    db,
    security,
    neural,
    memory,
    tools,
    agents,
    queue,
    planner,
    recruitment,
    nexus,
  });

  const workerEnv: Env = {
    APEX_DB: createAsyncD1Binding(db),
    APEX_SESSION_SECRET: sessionSecret,
    EMPLOYER_WEBHOOK_SECRET: webhookSecret,
    APEX_ENV: 'development',
  };

  await t.test('1. Public Repository Metadata, Lockfile Sync, Secret Detector & Candidate PII Redaction Guard (Node & Worker)', async () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    const lockJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package-lock.json'), 'utf8'));
    assert.equal(pkgJson.version, lockJson.version, 'package.json and package-lock.json versions must match');
    assert.equal(lockJson.lockfileVersion, 3);
    for (const [depName, depRange] of Object.entries(pkgJson.devDependencies || {})) {
      assert.equal(lockJson.packages[''].devDependencies[depName], depRange);
      assert.ok(lockJson.packages[`node_modules/${depName}`], `Missing ${depName} in package-lock.json`);
    }

    const nodeMeta = await api.handle({
      method: 'GET',
      path: '/api/system/repository-metadata',
      headers: {},
    });
    assert.equal(nodeMeta.status, 200);
    assert.equal(nodeMeta.body.canonicalRepositoryUrl, CANONICAL_PUBLIC_REPO_URL);
    assert.equal(nodeMeta.body.canonicalOwner, CANONICAL_PUBLIC_REPO_OWNER);
    assert.equal(nodeMeta.body.publicRepoSafety, 'PUBLIC_SAFE_VERIFIED');
    assert.ok(nodeMeta.body.migrations.includes('0005_v9_public_repo_reliability.sql'));

    const workerMetaRes = await worker.fetch(new Request('https://apex.example/api/system/repository-metadata'), workerEnv);
    assert.equal(workerMetaRes.status, 200);
    const workerMeta = (await workerMetaRes.json()) as any;
    assert.equal(workerMeta.canonicalRepositoryUrl, 'https://github.com/akshatgogri458-blip/apex-genesis-os');
    assert.equal(workerMeta.canonicalOwner, 'akshatgogri458-blip');

    // Secret scanner detects leaked tokens and private keys
    const fakePat = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const findings = scanTextForPublicRepoLeaks(`export GITHUB_TOKEN=${fakePat}`, 'test_env');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'SECRET_GITHUB_PAT');

    // Redaction scrubs emails, phone numbers, session tokens, and document content
    const redacted = redactCandidatePiiForPublicExport({
      email: 'candidate.name@example.org',
      phone: '+1 (415) 555-0199 Built systems',
      sessionToken: 'secret_tok_123',
      rawText: 'Private personal resume text',
    });
    assert.equal(redacted.email, 'c***@example.org');
    assert.ok(redacted.phone.includes('[REDACTED_PHONE]'));
    assert.equal(redacted.sessionToken, '[REDACTED_FOR_PUBLIC_SAFETY]');
    assert.equal(redacted.rawText, '[REDACTED_FOR_PUBLIC_SAFETY]');
  });

  await t.test('2. Timestamped Employer Webhook Verification & Single-Use Nonce Anti-Replay (Node & Worker)', async () => {
    await api.handle({
      method: 'POST',
      path: '/api/auth/register',
      headers: {},
      body: { email: 'v91_candidate@apex.io', displayName: 'V91 Candidate', password: 'StrongPassword#2026' },
    });
    const oob = await api.handle({
      method: 'POST',
      path: '/api/dev/out-of-band-mailbox',
      headers: {},
      body: { email: 'v91_candidate@apex.io' },
    });
    await api.handle({
      method: 'POST',
      path: '/api/auth/verify-email',
      headers: {},
      body: { email: 'v91_candidate@apex.io', verificationToken: oob.body.outOfBandMessage.secretToken },
    });
    const login = await api.handle({
      method: 'POST',
      path: '/api/auth/session',
      headers: {},
      body: { email: 'v91_candidate@apex.io', password: 'StrongPassword#2026' },
    });
    const authHeaders = {
      authorization: `Bearer ${login.body.sessionToken}`,
      'x-csrf-token': login.body.csrfToken,
    };

    // Public safety audit endpoint returns redacted snapshot with 0 leaks
    const safetyAudit = await api.handle({
      method: 'GET',
      path: '/api/security/public-safety-audit',
      headers: authHeaders,
    });
    assert.equal(safetyAudit.status, 200);
    assert.equal(safetyAudit.body.audit.safeForPublicRepository, true);
    assert.equal(safetyAudit.body.redactedSnapshot.user.email, 'v***@apex.io');

    // Ingest grounded resume & job to create an application
    const docRes = await api.handle({
      method: 'POST',
      path: '/api/documents/ingest-resume',
      headers: authHeaders,
      body: {
        title: 'V9.1 Resume',
        format: 'PLAIN_TEXT',
        rawText: 'Engineered distributed TypeScript and SQLite services handling 25,000 req/s.',
        verifiedExtractions: [
          {
            category: 'SKILL',
            attributeKey: 'TypeScript',
            attributeValue: 'Engineered distributed TypeScript and SQLite services',
            evidenceExcerpt: 'Engineered distributed TypeScript and SQLite services handling 25,000 req/s.',
            provenanceTier: 'DOCUMENT_EVIDENCE',
          },
        ],
      },
    });
    assert.equal(docRes.status, 201);

    const jobRes = await api.handle({
      method: 'POST',
      path: '/api/jobs/discover',
      headers: authHeaders,
      body: {
        vacancies: [
          {
            externalId: 'ext_v91_1',
            sourceFeed: 'Operator',
            sourceUrl: 'https://boards.greenhouse.io/cloudflare/jobs/991',
            title: 'Staff Distributed Systems Engineer',
            companyName: 'Cloudflare',
            location: 'Remote',
            remoteStatus: 'REMOTE',
            minYearsRequired: 3,
            salaryMinUsd: 180000,
            salaryMaxUsd: 240000,
            workAuthRequired: 'GLOBAL_REMOTE',
            requiredSkills: ['TypeScript'],
            descriptionText: 'Distributed systems role',
            submissionMethod: 'GREENHOUSE_API',
            postedAt: new Date().toISOString(),
          },
        ],
      },
    });
    const jobId = jobRes.body.jobIds[0];

    const subRes = await api.handle({
      method: 'POST',
      path: '/api/applications/submit',
      headers: authHeaders,
      body: {
        jobId,
        resumeDocId: docRes.body.documentId,
      },
    });
    assert.equal(subRes.status, 200);
    const applicationId = subRes.body.outcome.applicationId;

    const confId = 'gh_receipt_verified_99100';
    const verSource = 'EMPLOYER_CONFIRMATION_WEBHOOK';
    const validSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${applicationId}|${confId}|${verSource}`)
      .digest('hex');

    // A) Expired timestamp (10 minutes old) is rejected with 401 WEBHOOK_TIMESTAMP_EXPIRED
    const expiredTs = Math.floor((Date.now() - 600_000) / 1000);
    const expiredRes = await api.handle({
      method: 'POST',
      path: '/api/applications/reconcile',
      headers: {
        ...authHeaders,
        'x-employer-webhook-signature': validSig,
        'x-employer-webhook-timestamp': String(expiredTs),
      },
      body: {
        applicationId,
        externalConfirmationId: confId,
        verificationSource: verSource,
      },
    });
    assert.equal(expiredRes.status, 401);
    assert.ok(expiredRes.body.error.includes('WEBHOOK_TIMESTAMP_EXPIRED'));

    // B) Fresh timestamp + valid signature succeeds on Worker and transitions to SUBMITTED_VERIFIED
    const freshTs = Math.floor(Date.now() / 1000);
    const workerReconRes = await worker.fetch(
      new Request('https://apex.example/api/applications/reconcile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
          'x-employer-webhook-signature': validSig,
          'x-employer-webhook-timestamp': String(freshTs),
        },
        body: JSON.stringify({
          applicationId,
          externalConfirmationId: confId,
          verificationSource: verSource,
        }),
      }),
      workerEnv
    );
    assert.equal(workerReconRes.status, 200);
    const workerReconBody = (await workerReconRes.json()) as any;
    assert.equal(workerReconBody.reconciled.newStatus, 'SUBMITTED_VERIFIED');
    assert.equal(workerReconBody.reconciled.evidenceLevel, 'PROVIDER_CONFIRMED');
    assert.equal(workerReconBody.reconciled.verified, true);

    // C) Replaying the exact same signed webhook receipt is rejected with 409 WEBHOOK_REPLAY_DETECTED
    const replayRes = await worker.fetch(
      new Request('https://apex.example/api/applications/reconcile', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
          'x-employer-webhook-signature': validSig,
          'x-employer-webhook-timestamp': String(freshTs),
        },
        body: JSON.stringify({
          applicationId,
          externalConfirmationId: confId,
          verificationSource: verSource,
        }),
      }),
      workerEnv
    );
    assert.equal(replayRes.status, 409);
    const replayBody = (await replayRes.json()) as any;
    assert.ok(replayBody.error.includes('WEBHOOK_REPLAY_DETECTED'));
  });

  await t.test('3. Autonomous Dead-Letter Task Replay Enforces Tool Registration & Tenant Ownership (Node & Worker)', async () => {
    const login = await api.handle({
      method: 'POST',
      path: '/api/auth/session',
      headers: {},
      body: { email: 'v91_candidate@apex.io', password: 'StrongPassword#2026' },
    });
    const authHeaders = {
      authorization: `Bearer ${login.body.sessionToken}`,
      'x-csrf-token': login.body.csrfToken,
    };
    const userId = login.body.user.id;
    const now = new Date().toISOString();

    // Create a plan and two DEAD_LETTER tasks: one with an unregistered tool, one with a registered tool
    db.prepare(`INSERT INTO plans (id, user_id, objective, status, constraints_json, unknown_facts_json, required_tools_json, dag_json, execution_report_json, created_at, updated_at) VALUES ('pln_dlq_1', ?, 'DLQ Test', 'VALIDATED', '{}', '[]', '[]', '[]', '{}', ?, ?)`).bind(userId, now, now).run();
    db.prepare(
      `INSERT INTO tasks (id, user_id, plan_id, agent_id, tool_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempt_count, max_attempts, next_eligible_at, last_error, created_at, updated_at)
       VALUES ('tsk_unregistered_1', ?, 'pln_dlq_1', 'job-discovery', 'unknown.phantom.tool', 'idem_unreg_1', 'DEAD_LETTER', 1, '{}', '{}', 3, 3, ?, 'TOOL_NOT_IMPLEMENTED', ?, ?)`
    ).bind(userId, now, now, now).run();

    db.prepare(
      `INSERT INTO tasks (id, user_id, plan_id, agent_id, tool_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempt_count, max_attempts, next_eligible_at, last_error, created_at, updated_at)
       VALUES ('tsk_recoverable_1', ?, 'pln_dlq_1', 'candidate-intelligence', 'candidate.get_verified_facts', 'idem_rec_1', 'DEAD_LETTER', 1, '{}', '{}', 3, 3, ?, 'TRANSIENT_TIMEOUT', ?, ?)`
    ).bind(userId, now, now, now).run();

    // A) Unregistered tool replay is blocked with 422 REPLAY_BLOCKED_TOOL_NOT_IMPLEMENTED
    const unregReplay = await api.handle({
      method: 'POST',
      path: '/api/autonomy/dead-letter/replay',
      headers: authHeaders,
      body: { taskId: 'tsk_unregistered_1' },
    });
    assert.equal(unregReplay.status, 422);
    assert.ok(unregReplay.body.error.includes('REPLAY_BLOCKED_TOOL_NOT_IMPLEMENTED'));

    // B) Registered tool replay succeeds on Worker, resets status to READY and attempt_count to 0, and executes on cron
    const validReplayRes = await worker.fetch(
      new Request('https://apex.example/api/autonomy/dead-letter/replay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ taskId: 'tsk_recoverable_1' }),
      }),
      workerEnv
    );
    assert.equal(validReplayRes.status, 200);
    const validReplayBody = (await validReplayRes.json()) as any;
    assert.equal(validReplayBody.replayed.task.status, 'READY');
    assert.equal(Number(validReplayBody.replayed.task.attempt_count), 0);

    // Run Worker scheduled() cron sweep and confirm tsk_recoverable_1 completes
    const cronOut = await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() }, workerEnv);
    assert.ok(cronOut.processedTasks >= 1);
    const completedRow = db.prepare(`SELECT status, result_json FROM tasks WHERE id = 'tsk_recoverable_1'`).first<any>();
    assert.equal(completedRow?.status, 'COMPLETED');
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
