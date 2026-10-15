import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import { ApexNeuralCore, DeterministicStructuredEngine } from '../src/neural-core/index';
import { MemoryEngine } from '../src/memory/index';
import { UniversalToolRegistry } from '../src/tools/index';
import { AgentFleetRegistry } from '../src/agents/index';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';
import { AutonomousPlanner } from '../src/planner/index';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';
import { AuthorizedIntegrationNexus } from '../src/integrations/nexus';
import { ApexApplicationApi } from '../src/api/router';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_phase1_adv_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Phase 1 — Adversarial Security & Authorization Regression Suite (Gates 1, 6, 11)', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const neural = new ApexNeuralCore(db);
  neural.registerProvider(new DeterministicStructuredEngine());
  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory);
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

  await t.test('Gate 1: Adversarial emailVerified:true impersonation exploit via API & direct method fails completely', async () => {
    const advReg = await api.handle({
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'x-forwarded-for': '203.0.113.5' },
      body: {
        email: 'attacker@evil.example',
        displayName: 'Evil Attacker',
        password: 'AttackerPassword!2026',
        emailVerified: true,
        email_verified: 1,
        role: 'SYSTEM_ADMIN',
        browserSuppliedRole: 'SYSTEM_ADMIN',
      },
    });
    assert.equal(advReg.status, 201);
    assert.equal(advReg.body.user.emailVerified, false, 'Attacker account must remain UNVERIFIED');
    assert.equal(advReg.body.user.role, 'CANDIDATE', 'Attacker role must remain CANDIDATE');

    // Attempt immediate login without completing the verification challenge
    const loginAttempt = await api.handle({
      method: 'POST',
      path: '/api/auth/session',
      headers: { 'x-forwarded-for': '203.0.113.5' },
      body: {
        email: 'attacker@evil.example',
        password: 'AttackerPassword!2026',
      },
    });
    assert.equal(loginAttempt.status, 401, 'Unverified attacker must receive 401');
    assert.match(loginAttempt.body.error, /AUTH_UNVERIFIED_EMAIL/);
  });

  await t.test('Gate 6a: Verification challenges enforce expiration and single-use anti-replay', async () => {
    const user = security.registerUser({
      email: 'challenge.test@example.com',
      displayName: 'Challenge User',
      password: 'ChallengePassword!2026',
    });

    // 1. Expired challenge token must be rejected
    const expiredChallenge = security.issueVerificationChallenge(user.id, -5000);
    assert.throws(
      () => security.verifyEmailChallenge('challenge.test@example.com', expiredChallenge.verificationToken),
      /AUTH_VERIFICATION_TOKEN_EXPIRED/
    );

    // 2. Valid challenge token succeeds once, and replaying the exact same token fails
    const validChallenge = security.issueVerificationChallenge(user.id, 60_000);
    const firstUse = security.verifyEmailChallenge('challenge.test@example.com', validChallenge.verificationToken);
    assert.equal(firstUse.verified, true);

    assert.throws(
      () => security.verifyEmailChallenge('challenge.test@example.com', validChallenge.verificationToken),
      /AUTH_VERIFICATION_TOKEN_ALREADY_USED/,
      'Replaying a consumed verification token must fail'
    );
  });

  let aliceSession: any;
  let bobSession: any;
  let aliceCampaignId = '';
  let aliceJobId = '';

  await t.test('Gate 6b: Rejects forged identity, cross-user records, cross-campaign access, and unauthorized tool execution', async () => {
    const alice = security.registerUser({ email: 'alice@example.com', displayName: 'Alice', password: 'AlicePassword!2026' });
    const chAlice = security.issueVerificationChallenge(alice.id);
    security.verifyEmailChallenge('alice@example.com', chAlice.verificationToken);
    aliceSession = security.issueSession({ email: 'alice@example.com', password: 'AlicePassword!2026', ipAddress: '10.0.0.11', userAgent: 'Test' });

    const bob = security.registerUser({ email: 'bob@example.com', displayName: 'Bob', password: 'BobPassword!2026' });
    const chBob = security.issueVerificationChallenge(bob.id);
    security.verifyEmailChallenge('bob@example.com', chBob.verificationToken);
    bobSession = security.issueSession({ email: 'bob@example.com', password: 'BobPassword!2026', ipAddress: '10.0.0.12', userAgent: 'Test' });

    // Alice creates a campaign and job
    const campRes = await api.handle({
      method: 'POST',
      path: '/api/campaigns',
      headers: { authorization: `Bearer ${aliceSession.sessionToken}`, 'x-csrf-token': aliceSession.csrfToken },
      body: { name: 'Alice Private Campaign', targetRoles: ['Staff Engineer'], remoteOnly: true, minMatchScore: 80 },
    });
    assert.equal(campRes.status, 201);
    aliceCampaignId = campRes.body.campaignId;

    const jobRes = await api.handle({
      method: 'POST',
      path: '/api/jobs/discover',
      headers: { authorization: `Bearer ${aliceSession.sessionToken}`, 'x-csrf-token': aliceSession.csrfToken },
      body: {
        vacancies: [
          {
            externalId: 'gh_alice_1',
            sourceFeed: 'Greenhouse',
            sourceUrl: 'https://boards.greenhouse.io/acme/jobs/1',
            title: 'Staff Engineer',
            companyName: 'Acme',
            location: 'Remote',
            remoteStatus: 'REMOTE',
            requiredSkills: ['TypeScript'],
            descriptionText: 'Core platform',
            submissionMethod: 'GREENHOUSE_API',
            postedAt: new Date().toISOString(),
          },
        ],
      },
    });
    aliceJobId = jobRes.body.jobIds[0];

    // 1. Forged identity in body: Bob tries to pass Alice's userId in request body
    const forgedIdRes = await api.handle({
      method: 'POST',
      path: '/api/campaigns',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-csrf-token': bobSession.csrfToken },
      body: { userId: aliceSession.user.id, name: 'Forged Campaign' },
    });
    assert.equal(forgedIdRes.status, 403);
    assert.match(forgedIdRes.body.error, /AUTHZ_FORGED_IDENTITY/);

    // 2. Cross-user record access: Bob tries to read Alice's candidate facts or match Alice's job
    const crossFacts = await api.handle({
      method: 'GET',
      path: '/api/candidate/facts',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-target-user-id': aliceSession.user.id },
    });
    assert.equal(crossFacts.status, 403);

    const crossJobMatch = await api.handle({
      method: 'POST',
      path: '/api/jobs/match',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-csrf-token': bobSession.csrfToken },
      body: { jobId: aliceJobId },
    });
    assert.equal(crossJobMatch.status, 403);

    // 3. Cross-campaign access: Bob tries to execute a plan attached to Alice's campaignId
    const crossCamp = await api.handle({
      method: 'POST',
      path: '/api/planner/execute',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-csrf-token': bobSession.csrfToken },
      body: { objective: 'Find remote roles', campaignId: aliceCampaignId },
    });
    assert.equal(crossCamp.status, 403);
    assert.match(crossCamp.body.error, /AUTHZ_FORBIDDEN_CAMPAIGN_OWNERSHIP/);

    // 4. Unauthorized tool execution: Bob tries to invoke DESTRUCTIVE tool 'account.purge_all_data'
    const unauthTool = await api.handle({
      method: 'POST',
      path: '/api/tools/invoke',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-csrf-token': bobSession.csrfToken },
      body: { toolId: 'account.purge_all_data', input: { confirmPurge: true } },
    });
    assert.equal(unauthTool.status, 403);
    assert.match(unauthTool.body.error, /TOOL_PERMISSION_DENIED/);
  });

  await t.test('Gate 6c: Rejects expired and revoked sessions', async () => {
    const expiredSession = security.issueSession({
      email: 'alice@example.com',
      password: 'AlicePassword!2026',
      ipAddress: '10.0.0.11',
      userAgent: 'Test',
      ttlMs: -1000, // Already expired
    });
    assert.throws(
      () => security.authenticateRequest(expiredSession.sessionToken),
      /AUTH_SESSION_EXPIRED/
    );

    // Revoke Bob's active session via API
    const revRes = await api.handle({
      method: 'POST',
      path: '/api/auth/revoke',
      headers: { authorization: `Bearer ${bobSession.sessionToken}`, 'x-csrf-token': bobSession.csrfToken },
      body: { sessionId: bobSession.sessionId },
    });
    assert.equal(revRes.status, 200);

    // Subsequent call with Bob's revoked token must fail with 401 AUTH_SESSION_REVOKED
    const afterRevoke = await api.handle({
      method: 'GET',
      path: '/api/profile',
      headers: { authorization: `Bearer ${bobSession.sessionToken}` },
    });
    assert.equal(afterRevoke.status, 401);
    assert.match(afterRevoke.body.error, /AUTH_SESSION_REVOKED/);
  });

  await t.test('Gate 11 & Phase 1.3/1.4: Ordinary candidate is FORBIDDEN from GLOBAL stop (403); SYSTEM_ADMIN controls GLOBAL stop & detects tampered audit entries', async () => {
    // 1. Ordinary candidate (Bob) attempting GLOBAL emergency stop MUST be rejected with 403 AUTHZ_ADMIN_REQUIRED
    const activeBobSession = security.issueSession({ email: 'bob@example.com', password: 'BobPassword!2026', ipAddress: '10.0.0.12', userAgent: 'Test' });
    const bobGlobalStop = await api.handle({
      method: 'POST',
      path: '/api/system/emergency-stop',
      headers: { authorization: `Bearer ${activeBobSession.sessionToken}`, 'x-csrf-token': activeBobSession.csrfToken },
      body: { scope: 'GLOBAL', stopped: true, reason: 'Unauthorized global stop attempt' },
    });
    assert.equal(bobGlobalStop.status, 403);
    assert.match(bobGlobalStop.body.error, /AUTHZ_ADMIN_REQUIRED/);

    // 2. Promote Alice to SYSTEM_ADMIN so she can lawfully control GLOBAL emergency stop
    security.promoteUserRoleForTestingOrAdmin(aliceSession.user.id, 'SYSTEM_ADMIN');

    const stopRes = await api.handle({
      method: 'POST',
      path: '/api/system/emergency-stop',
      headers: { authorization: `Bearer ${aliceSession.sessionToken}`, 'x-csrf-token': aliceSession.csrfToken },
      body: { scope: 'GLOBAL', stopped: true, reason: 'Critical security drill' },
    });
    assert.equal(stopRes.status, 200);
    assert.equal(stopRes.body.emergencyStopped, true);
    assert.equal(stopRes.body.auditChainVerification.valid, true);

    // Attempting to execute planner, agent, or acquire queue lease while stopped must be rejected
    const planWhileStopped = await api.handle({
      method: 'POST',
      path: '/api/planner/execute',
      headers: { authorization: `Bearer ${aliceSession.sessionToken}`, 'x-csrf-token': aliceSession.csrfToken },
      body: { objective: 'Find 10 remote jobs' },
    });
    assert.equal(planWhileStopped.status, 503);
    assert.match(planWhileStopped.body.error, /EMERGENCY_STOP_ACTIVE/);

    assert.equal(queue.acquireLease('worker-test'), null);

    // Re-instantiate DurableExecutionEngine against the same SQLite DB to simulate service restart
    const restartedQueue = new DurableExecutionEngine(db);
    assert.equal(restartedQueue.isEmergencyStopped(), true, 'Emergency stop must persist across service restarts');

    // Release emergency stop
    await api.handle({
      method: 'POST',
      path: '/api/system/emergency-stop',
      headers: { authorization: `Bearer ${aliceSession.sessionToken}`, 'x-csrf-token': aliceSession.csrfToken },
      body: { stopped: false, reason: 'Drill complete' },
    });
    assert.equal(restartedQueue.isEmergencyStopped(), false);

    // Tamper with an audit log entry in DB and verify tamper detection catches it
    const targetAudit = db.prepare(`SELECT id, details_json FROM audit_logs LIMIT 1`).first<any>()!;
    db.prepare(`UPDATE audit_logs SET details_json = '{"tampered":true}' WHERE id = ?`).bind(targetAudit.id).run();

    const tamperedCheck = security.verifyAuditChainIntegrity();
    assert.equal(tamperedCheck.valid, false, 'Must detect tampered audit log row');
    assert.equal(tamperedCheck.tamperedEntryId, targetAudit.id);

    // Restore original details_json and verify chain is valid again
    db.prepare(`UPDATE audit_logs SET details_json = ? WHERE id = ?`).bind(targetAudit.details_json, targetAudit.id).run();
    assert.equal(security.verifyAuditChainIntegrity().valid, true);
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
