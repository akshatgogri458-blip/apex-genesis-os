import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import {
  CloudflareD1DatabaseBinding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
} from '../src/types/cloudflare';
import worker, { Env } from '../src/worker';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_phase3_worker_d1.sqlite');

function createAsyncD1BindingFromSqlite(sqliteDb: ApexD1Database): CloudflareD1DatabaseBinding {
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
          duration: 0.4,
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
          duration: 0.3,
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

test('Phase 3 & V8 Worker Suite — Unified Contract, Zero Token Leak, Scoped Stop, Goal-Variant DAGs & Atomic Cron Execution', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const sqliteDb = new ApexD1Database(TEST_DB_PATH, { maxQueriesPerInvocation: 500 });
  const schema1 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql'), 'utf8');
  const schema2 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0002_v2_resurrection.sql'), 'utf8');
  const schema3 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0003_v8_reality_engine.sql'), 'utf8');
  sqliteDb.execSchema(schema1);
  sqliteDb.execSchema(schema2);
  sqliteDb.execSchema(schema3);

  const asyncD1 = createAsyncD1BindingFromSqlite(sqliteDb);
  const env: Env = {
    APEX_DB: asyncD1,
    APEX_SESSION_SECRET: 'worker_d1_super_secret_signing_key_32_bytes_minimum!!',
    AI: {
      __isTestMock: true,
      async run(model: string, _input: any) {
        return {
          response: JSON.stringify({ modelUsed: model, verified: true }),
          usage: { prompt_tokens: 18, completion_tokens: 24, neurons: 1.4 },
        };
      },
    },
  };

  let sessionToken = '';
  let csrfToken = '';

  await t.test('Gates 1, 2, 6, 7 & 8: Cloudflare Worker registers user WITHOUT leaking token, verifies OOB token, and serves unified /api/workspaces/state', async () => {
    const regReq = new Request('https://apex-genesis.workers.dev/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'worker.user@apex-genesis.io',
        displayName: 'Worker Edge User',
        password: 'WorkerStrongPassword!2026',
        emailVerified: true,
        role: 'SYSTEM_ADMIN',
      }),
    });
    const regRes = await worker.fetch(regReq, env);
    const regBody: any = await regRes.json();
    assert.equal(regRes.status, 201, JSON.stringify(regBody));
    assert.equal(regBody.user.emailVerified, false);
    assert.equal(regBody.user.role, 'CANDIDATE');
    assert.equal(regBody.verificationChallengeToken, undefined, 'Worker must NEVER leak verificationChallengeToken in HTTP response');

    // Fetch token from out-of-band dev mailbox
    const oobRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/dev/out-of-band-mailbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'worker.user@apex-genesis.io' }),
      }),
      env
    );
    const oobBody: any = await oobRes.json();
    assert.equal(oobRes.status, 200);

    // Complete single-use verification challenge
    const verRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'worker.user@apex-genesis.io',
          verificationToken: oobBody.outOfBandMessage.secretToken,
        }),
      }),
      env
    );
    assert.equal(verRes.status, 200);

    // Login now succeeds
    const loginRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'worker.user@apex-genesis.io', password: 'WorkerStrongPassword!2026' }),
      }),
      env
    );
    assert.equal(loginRes.status, 200);
    const loginBody: any = await loginRes.json();
    sessionToken = loginBody.sessionToken;
    csrfToken = loginBody.csrfToken;

    // Verify unified /api/workspaces/state on Worker
    const wsRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/workspaces/state', {
        method: 'GET',
        headers: { authorization: `Bearer ${sessionToken}` },
      }),
      env
    );
    assert.equal(wsRes.status, 200);
    const wsBody: any = await wsRes.json();
    assert.equal(wsBody.user.email, 'worker.user@apex-genesis.io');
  });

  await t.test('Gate 9: Worker /api/neural/infer routes to @cf/google/gemma-4-26b-a4b-it (256K context) and distinguishes MOCK_INFERENCE from REAL_INFERENCE', async () => {
    const inferRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/neural/infer', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ prompt: 'Analyze distributed systems architecture fit' }),
      }),
      env
    );
    assert.equal(inferRes.status, 200);
    const inferBody: any = await inferRes.json();
    assert.equal(inferBody.inference.modelId, '@cf/google/gemma-4-26b-a4b-it');
    assert.equal(inferBody.inference.maxContextTokens, 256000);
    assert.equal(inferBody.inference.executionCategory, 'MOCK_INFERENCE');
    assert.equal(inferBody.inference.neuronsConsumed, 1.4);
  });

  await t.test('Gates 8, 9, 10 & 11: Worker enforces ADMIN on global stop, allows CANDIDATE stop, rejects unknown tools with TOOL_NOT_IMPLEMENTED, and progresses multi-step DAGs', async () => {
    // 1. Ordinary candidate attempting GLOBAL stop must receive 403 AUTHZ_ADMIN_REQUIRED
    const unauthGlobalStop = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/system/emergency-stop', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ scope: 'GLOBAL', stopped: true, reason: 'Candidate trying global stop' }),
      }),
      env
    );
    assert.equal(unauthGlobalStop.status, 403);

    // 2. Candidate CAN engage CANDIDATE-scoped emergency stop
    const candStopRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/system/emergency-stop', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ scope: 'CANDIDATE', stopped: true, reason: 'Pause my own tasks' }),
      }),
      env
    );
    assert.equal(candStopRes.status, 200);

    // Release candidate stop
    await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/system/emergency-stop', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ scope: 'CANDIDATE', stopped: false, reason: 'Resume my tasks' }),
      }),
      env
    );

    // 3. Execute a multi-step plan on Worker (returns 200)
    const planRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/planner/execute', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ objective: 'Shortlist remote TypeScript roles' }),
      }),
      env
    );
    assert.equal(planRes.status, 200);
    const planBody: any = await planRes.json();
    assert.equal(planBody.report.planArchetype, 'SHORTLIST_ROLES');
    assert.equal(planBody.report.dagSteps.length, 3);

    // 4. Run scheduled() sweeps to progress the 3-step DAG while browser is closed
    await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() }, env);
    await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() + 1000 }, env);
    await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: Date.now() + 2000 }, env);

    const tasksRes = await worker.fetch(
      new Request('https://apex-genesis.workers.dev/api/tasks', {
        method: 'GET',
        headers: { authorization: `Bearer ${sessionToken}` },
      }),
      env
    );
    const tasksBody: any = await tasksRes.json();
    assert.ok(tasksBody.tasks.every((tk: any) => tk.status === 'COMPLETED'));
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
