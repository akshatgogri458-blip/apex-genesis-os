import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { BudgetGovernor } from '../src/db/budget-governor';
import { SecurityGuard, GoogleJwkKey } from '../src/security/auth';
import { verifyExcerptEntailment } from '../src/security/sanitizer';
import { ApexNeuralCore, CloudflareWorkersAIProvider, DeterministicStructuredEngine } from '../src/neural-core/index';
import { MemoryEngine } from '../src/memory/index';
import { UniversalToolRegistry } from '../src/tools/index';
import { AgentFleetRegistry } from '../src/agents/index';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';
import { AutonomousPlanner } from '../src/planner/index';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';
import { AuthorizedIntegrationNexus } from '../src/integrations/nexus';
import { ApexApplicationApi } from '../src/api/router';

const V8_TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_v8_reality_engine.sqlite');

test('APEX GENESIS V8/V9 — Independent Audit Remediation & 12-Stage E2E Career Journey Suite', async (t) => {
  if (fs.existsSync(V8_TEST_DB_PATH)) fs.unlinkSync(V8_TEST_DB_PATH);
  const db = new ApexD1Database(V8_TEST_DB_PATH, { maxQueriesPerInvocation: 500 });
  const schema1 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql'), 'utf8');
  const schema2 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0002_v2_resurrection.sql'), 'utf8');
  const schema3 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0003_v8_reality_engine.sql'), 'utf8');
  const schema4 = fs.readFileSync(path.resolve(__dirname, '../../migrations/0004_v9_production_truth.sql'), 'utf8');
  db.execSchema(schema1);
  db.execSchema(schema2);
  db.execSchema(schema3);
  db.execSchema(schema4);

  // Generate a genuine 2048-bit RSA keypair for Google OIDC JWKS verification
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubJwk = publicKey.export({ format: 'jwk' }) as any;
  const googleJwk: GoogleJwkKey = {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'google_rsa_kid_2026_v9',
    n: pubJwk.n,
    e: pubJwk.e,
  };

  const signingSecret = 'v8_reality_engine_hmac_secret_key_minimum_32_bytes_2026!!';
  const security = new SecurityGuard(db, signingSecret, {
    googleClientId: 'apex-v9-google-client-id.apps.googleusercontent.com',
    trustedGoogleJwks: [googleJwk],
  });
  const neural = new ApexNeuralCore(db);
  const cfProvider = new CloudflareWorkersAIProvider({ isMockAdapter: false });
  neural.registerProvider(cfProvider);
  neural.registerProvider(new DeterministicStructuredEngine());

  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory);
  const budget = new BudgetGovernor(db);
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

  await t.test('Audit Findings #1, #2, #9 & #12: Zero Registration Token Leak, Server-Owned Production Fail-Closed, RS256 Google OIDC & Gemma 4 256K Specs', async () => {
    // 1. Official Gemma 4 26B A4B context window must be 256,000 tokens
    const gemmaCap = cfProvider.getCapabilities().find((c) => c.modelId === '@cf/google/gemma-4-26b-a4b-it');
    assert.ok(gemmaCap);
    assert.equal(gemmaCap.maxContextTokens, 256000);

    // 2. Server-owned production fail-closed registration guard (503 BLOCKED_IDENTITY_PROVIDER)
    // Even if the client sends environmentMode: 'development', server-owned production mode blocks it!
    security.setServerEnvironmentMode('production');
    const prodBlocked = await api.handle({
      method: 'POST',
      path: '/api/auth/register',
      headers: {},
      body: {
        email: 'prod@apex.io',
        displayName: 'Prod Candidate',
        password: 'ProdStrongPassword!2026',
        environmentMode: 'development', // Attacker attempt to override production mode — ignored!
      },
    });
    assert.equal(prodBlocked.status, 503);
    assert.match(prodBlocked.body.error, /BLOCKED_IDENTITY_PROVIDER/);
    security.setServerEnvironmentMode('development');

    // 3. Google OIDC ID token verification using real RS256 asymmetric signature against JWKS
    const nowSec = Math.floor(Date.now() / 1000);
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'google_rsa_kid_2026_v9' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: 'apex-v9-google-client-id.apps.googleusercontent.com',
        sub: 'google_sub_1001',
        email: 'oidc.candidate@apex.io',
        email_verified: true,
        name: 'OIDC Verified Candidate',
        iat: nowSec - 10,
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const rsaSigB64Url = crypto
      .sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'), privateKey)
      .toString('base64url');
    const validIdToken = `${headerB64}.${payloadB64}.${rsaSigB64Url}`;

    const oauthRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: validIdToken },
    });
    assert.equal(oauthRes.status, 200, JSON.stringify(oauthRes.body));
    assert.ok(oauthRes.body.sessionToken);

    // Replaying the same Google ID token (even without a jti claim!) must be rejected
    const replayRes = await api.handle({
      method: 'POST',
      path: '/api/auth/oauth/google',
      headers: {},
      body: { idToken: validIdToken },
    });
    assert.equal(replayRes.status, 400);
    assert.match(replayRes.body.error, /OAUTH_REPLAY_DETECTED/);
  });

  await t.test('Audit Findings #4, #7, #8 & #11: 8 Goal-Variant DAG Plans, Persistent BudgetGovernor, Excerpt Entailment Guard & Honest Calendar Status', async () => {
    const goals = [
      'Discover remote TypeScript roles',
      'Shortlist top matching roles',
      'Tailor truthful resume for target role',
      'Draft recruiter follow-up message',
      'Prepare interview STAR stories',
      'Schedule interview slot without conflicts',
      'Reconcile uncertain application status',
      'Research company engineering dossier',
    ];
    const archetypes = new Set<string>();
    const detEngine = new DeterministicStructuredEngine();
    for (const g of goals) {
      const res = await detEngine.generate({ userId: 'usr_test', taskType: 'PLANNING', prompt: g });
      const parsed = JSON.parse(res.outputText);
      archetypes.add(parsed.planArchetype);
      assert.ok(Array.isArray(parsed.steps) && parsed.steps.length >= 2);
    }
    assert.equal(archetypes.size, 8, `Expected 8 distinct plan archetypes, got ${archetypes.size}`);

    const resumeText = 'Built distributed TypeScript microservices and Cloudflare Workers handling 45,000 req/s with SQLite D1.';
    const validEntailment = verifyExcerptEntailment({
      attributeKey: 'TypeScript & Cloudflare Workers',
      attributeValue: '45,000 req/s distributed microservices',
      evidenceExcerpt: 'Built distributed TypeScript microservices and Cloudflare Workers handling 45,000 req/s',
      rawDocumentText: resumeText,
    });
    assert.equal(validEntailment.claimEntailedByExcerpt, true);

    const bogusEntailment = verifyExcerptEntailment({
      attributeKey: 'Rust Kernel Driver',
      attributeValue: '10 years Linux kernel development',
      evidenceExcerpt: 'Built distributed TypeScript microservices and Cloudflare Workers handling 45,000 req/s',
      rawDocumentText: resumeText,
    });
    assert.equal(bogusEntailment.claimEntailedByExcerpt, false);

    assert.throws(
      () =>
        budget.reserveBudget({
          providerId: 'PAID_UNVERIFIED_GPU_CLUSTER',
          userId: 'usr_test',
          unitsToReserve: 10,
        }),
      /BLOCKED_COST_UNVERIFIED/
    );
  });

  await t.test('Section K: Complete 12-Stage End-to-End Autonomous Career Journey', async () => {
    const reg = await api.handle({
      method: 'POST',
      path: '/api/auth/register',
      headers: {},
      body: {
        email: 'journey.candidate@apex-genesis.io',
        displayName: 'Rohan Mehta',
        password: 'JourneyStrongPassword#2026',
      },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.verificationChallengeToken, undefined);

    const oob = await api.handle({
      method: 'POST',
      path: '/api/dev/out-of-band-mailbox',
      headers: {},
      body: { email: 'journey.candidate@apex-genesis.io' },
    });
    assert.equal(oob.status, 200);

    const ver = await api.handle({
      method: 'POST',
      path: '/api/auth/verify-email',
      headers: {},
      body: {
        email: 'journey.candidate@apex-genesis.io',
        verificationToken: oob.body.outOfBandMessage.secretToken,
      },
    });
    assert.equal(ver.status, 200);

    const login = await api.handle({
      method: 'POST',
      path: '/api/auth/session',
      headers: {},
      body: {
        email: 'journey.candidate@apex-genesis.io',
        password: 'JourneyStrongPassword#2026',
      },
    });
    assert.equal(login.status, 200);
    const authHeaders = {
      authorization: `Bearer ${login.body.sessionToken}`,
      'x-csrf-token': login.body.csrfToken,
    };

    const rejectedIngest = await api.handle({
      method: 'POST',
      path: '/api/documents/ingest-resume',
      headers: authHeaders,
      body: {
        title: 'Rohan Mehta Resume 2026',
        format: 'PLAIN_TEXT',
        rawText: 'Architected TypeScript and React distributed systems with SQLite and Cloudflare Workers.',
        verifiedExtractions: [
          {
            category: 'SKILL',
            attributeKey: 'Quantum Hardware Fabrication',
            attributeValue: 'Superconducting Qubits',
            evidenceExcerpt: 'Architected TypeScript and React distributed systems',
          },
        ],
      },
    });
    assert.equal(rejectedIngest.status, 400);
    assert.match(rejectedIngest.body.error, /RESUME_CLAIM_ENTAILMENT_FAILED/);

    const validIngest = await api.handle({
      method: 'POST',
      path: '/api/documents/ingest-resume',
      headers: authHeaders,
      body: {
        title: 'Rohan Mehta Resume 2026',
        format: 'PLAIN_TEXT',
        rawText: 'Architected TypeScript and React distributed systems with SQLite and Cloudflare Workers.',
        verifiedExtractions: [
          {
            category: 'SKILL',
            attributeKey: 'Core Stack',
            attributeValue: 'TypeScript',
            evidenceExcerpt: 'Architected TypeScript and React distributed systems',
            provenanceTier: 'DOCUMENT_EVIDENCE',
          },
          {
            category: 'SKILL',
            attributeKey: 'Architecture',
            attributeValue: 'Distributed Systems',
            evidenceExcerpt: 'Architected TypeScript and React distributed systems',
            provenanceTier: 'USER_CONFIRMED',
          },
        ],
      },
    });
    assert.equal(validIngest.status, 201);
    assert.equal(validIngest.body.extractedFacts.length, 2);

    const campRes = await api.handle({
      method: 'POST',
      path: '/api/campaigns',
      headers: authHeaders,
      body: {
        name: 'Principal TypeScript Architect Campaign',
        targetRoles: ['Staff Distributed Systems Engineer'],
        remoteOnly: true,
        minMatchScore: 70,
        excludedCompanies: ['ExcludedCorp'],
        dailySubmissionCap: 10,
      },
    });
    assert.equal(campRes.status, 201);

    const officialJobs = await api.handle({
      method: 'POST',
      path: '/api/jobs/discover-official',
      headers: authHeaders,
      body: { boardSource: 'GREENHOUSE_PUBLIC', boardToken: 'cloudflare' },
    });
    assert.equal(officialJobs.status, 200);
    assert.equal(officialJobs.body.verificationStatuses[0], 'SOURCE_RETRIEVED');
    const officialJobId = officialJobs.body.insertedJobIds[0];

    const browserJob = await api.handle({
      method: 'POST',
      path: '/api/jobs/discover',
      headers: authHeaders,
      body: {
        vacancies: [
          {
            externalId: 'spoof_gh_1',
            sourceFeed: 'Browser Client',
            sourceUrl: 'https://boards.greenhouse.io/spoof/jobs/1',
            title: 'Spoofed Engineer <script>window.evil=1</script>',
            companyName: 'SpoofCo',
            location: 'Remote',
            remoteStatus: 'REMOTE',
            requiredSkills: ['TypeScript'],
            descriptionText: 'Browser supplied role',
            submissionMethod: 'GREENHOUSE_API',
            postedAt: new Date().toISOString(),
            verifiedByEmployerFeed: true,
          },
        ],
      },
    });
    assert.equal(browserJob.status, 200);
    assert.equal(browserJob.body.verificationStatuses[0], 'USER_SUPPLIED_UNVERIFIED');

    const matchRes = await api.handle({
      method: 'POST',
      path: '/api/jobs/match',
      headers: authHeaders,
      body: { jobId: officialJobId },
    });
    assert.equal(matchRes.status, 200);
    assert.equal(matchRes.body.match.scoreBreakdown.technicalSkillsScore, 100);

    const planRes = await api.handle({
      method: 'POST',
      path: '/api/planner/execute',
      headers: authHeaders,
      body: { objective: 'Discover matching remote roles and tailor truthful resume' },
    });
    assert.equal(planRes.status, 200);
    assert.equal(planRes.body.report.completionEvidenceVerified, true);
    assert.ok(planRes.body.report.completedTaskIds.length >= 4);

    const factId0 = validIngest.body.extractedFacts[0].id;
    const tailored = await api.handle({
      method: 'POST',
      path: '/api/documents/tailor-resume',
      headers: authHeaders,
      body: {
        jobId: officialJobId,
        proposedClaims: [
          { claimText: 'Verified TypeScript & Distributed Systems', factId: factId0, provenanceTier: 'USER_CONFIRMED' },
          { claimText: 'Unconfirmed raw OCR line', factId: factId0, provenanceTier: 'TEXT_EXTRACTION' },
        ],
      },
    });
    assert.equal(tailored.status, 201);
    assert.equal(tailored.body.document.fullyGrounded, false);
    assert.equal(tailored.body.document.rejectedUnverifiedClaims.length, 1);

    const cleanTailored = await api.handle({
      method: 'POST',
      path: '/api/documents/tailor-resume',
      headers: authHeaders,
      body: {
        jobId: officialJobId,
        proposedClaims: [
          { claimText: 'Verified TypeScript & Distributed Systems Architecture', factId: factId0, provenanceTier: 'USER_CONFIRMED' },
        ],
      },
    });
    assert.equal(cleanTailored.status, 201);
    assert.equal(cleanTailored.body.document.fullyGrounded, true);
    const resumeDocId = cleanTailored.body.document.documentId;

    const capRes = await api.handle({
      method: 'POST',
      path: '/api/applications/capability',
      headers: authHeaders,
      body: { sourceUrl: 'https://boards.greenhouse.io/cloudflare/jobs/904412', hasEmployerIssuedApiKey: false },
    });
    assert.equal(capRes.status, 200);
    assert.equal(capRes.body.capabilityState, 'PREPARE_AND_HANDOFF');

    // Stage 10: Submit without employer API key -> AWAITING_HUMAN_APPROVAL;
    // then verify unsigned caller confirmation stays USER_REPORTED, while signed provider webhook sets SUBMITTED_VERIFIED
    const subHandoff = await api.handle({
      method: 'POST',
      path: '/api/applications/submit',
      headers: authHeaders,
      body: {
        campaignId: campRes.body.campaignId,
        jobId: officialJobId,
        resumeDocId,
      },
    });
    assert.equal(subHandoff.status, 200);
    assert.equal(subHandoff.body.outcome.status, 'AWAITING_HUMAN_APPROVAL');

    const unsignedReconcile = await api.handle({
      method: 'POST',
      path: '/api/applications/reconcile',
      headers: authHeaders,
      body: {
        applicationId: subHandoff.body.outcome.applicationId,
        externalConfirmationId: 'confirmation123',
        verificationSource: 'USER_TYPED',
      },
    });
    assert.equal(unsignedReconcile.status, 200);
    assert.equal(unsignedReconcile.body.reconciled.newStatus, 'USER_REPORTED');
    assert.equal(unsignedReconcile.body.reconciled.verified, false);

    const validWebhookSig = nexus.signEmployerWebhookReceipt({
      applicationId: subHandoff.body.outcome.applicationId,
      externalConfirmationId: 'gh_conf_receipt_998877',
      verificationSource: 'GREENHOUSE_CONFIRMATION_WEBHOOK',
    });

    const reconciled = await api.handle({
      method: 'POST',
      path: '/api/applications/reconcile',
      headers: {
        ...authHeaders,
        'x-employer-webhook-signature': validWebhookSig,
      },
      body: {
        applicationId: subHandoff.body.outcome.applicationId,
        externalConfirmationId: 'gh_conf_receipt_998877',
        verificationSource: 'GREENHOUSE_CONFIRMATION_WEBHOOK',
      },
    });
    assert.equal(reconciled.status, 200);
    assert.equal(reconciled.body.reconciled.newStatus, 'SUBMITTED_VERIFIED');
    assert.equal(reconciled.body.reconciled.evidenceLevel, 'PROVIDER_CONFIRMED');
    assert.equal(reconciled.body.reconciled.verified, true);

    const auditCheck = await api.handle({
      method: 'GET',
      path: '/api/security/audit-verify',
      headers: authHeaders,
    });
    assert.equal(auditCheck.status, 200);
    assert.equal(auditCheck.body.valid, true);
  });

  if (fs.existsSync(V8_TEST_DB_PATH)) fs.unlinkSync(V8_TEST_DB_PATH);
});
