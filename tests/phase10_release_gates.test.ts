import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { createApexRuntime } from '../src/server/local-server';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_phase10_gates.sqlite');

test('Phase 7, 8 & 10 — Resume Version Diffing, Uncertain Submission Reconciliation & Hard Release Gates Audit (Gates 13, 14)', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const { db, api } = createApexRuntime(TEST_DB_PATH);

  const user = api.security.registerUser({
    email: 'gates.verifier@apex-genesis.io',
    displayName: 'Gates Verifier',
    password: 'StrongPassword!2026',
  });
  const ch = api.security.issueVerificationChallenge(user.id);
  api.security.verifyEmailChallenge('gates.verifier@apex-genesis.io', ch.verificationToken);

  await t.test('Phase 7: Resume Studio tracks immutable version history and computes document diffs', () => {
    api.recruitment.ingestResumeDocument({
      userId: user.id,
      title: 'Master_CV.txt',
      format: 'PLAIN_TEXT',
      rawText: 'Experienced in TypeScript, Node.js, SQLite, and Cloudflare Workers.',
      verifiedExtractions: [
        { category: 'SKILL', attributeKey: 'Lang', attributeValue: 'TypeScript', evidenceExcerpt: 'TypeScript, Node.js' },
        { category: 'SKILL', attributeKey: 'Edge', attributeValue: 'Cloudflare Workers', evidenceExcerpt: 'SQLite, and Cloudflare Workers' },
      ],
    });

    const jobs = api.recruitment.ingestVacancies(user.id, [
      {
        externalId: 'gh_gate_1',
        sourceFeed: 'Greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/cloudflare/jobs/1',
        title: 'Edge Runtime Engineer',
        companyName: 'Cloudflare',
        location: 'Remote',
        remoteStatus: 'REMOTE',
        requiredSkills: ['TypeScript', 'Cloudflare Workers'],
        descriptionText: 'Edge Workers',
        submissionMethod: 'GREENHOUSE_API',
        postedAt: new Date().toISOString(),
      },
    ]);

    const facts = api.memory.getVerifiedCandidateFacts(user.id, user.id);
    const v1 = api.recruitment.generateTruthfulTailoredResume({
      userId: user.id,
      jobId: jobs.jobIds[0],
      proposedClaims: [{ claimText: 'Proficient in TypeScript', factId: facts[0].id }],
    });
    const v2 = api.recruitment.generateTruthfulTailoredResume({
      userId: user.id,
      jobId: jobs.jobIds[0],
      proposedClaims: [
        { claimText: 'Proficient in TypeScript', factId: facts[0].id },
        { claimText: 'Built Cloudflare Workers systems', factId: facts[1].id },
      ],
    });

    const history = api.recruitment.getResumeVersionHistory(user.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].versionNumber, 2);

    const diff = api.recruitment.compareResumeDocuments(user.id, v1.documentId, v2.documentId);
    assert.ok(diff.addedLines.some((l) => l.includes('Built Cloudflare Workers systems')));
    assert.equal(diff.sharedVerifiedClaimsCount, 1);
  });

  await t.test('Gate 13: Uncertain submission is marked SUBMITTED_UNCONFIRMED, rejects unsigned caller confirmation strings as USER_REPORTED, and reconciles to SUBMITTED_VERIFIED only with signed webhook receipt', async () => {
    const jobs = db.prepare(`SELECT id FROM jobs WHERE user_id = ?`).bind(user.id).all<{ id: string }>().results;
    const docs = db.prepare(`SELECT id FROM documents WHERE user_id = ? AND doc_type = 'TAILORED_RESUME'`).bind(user.id).all<{ id: string }>().results;

    const initialSub = await api.nexus.executeAuthorizedSubmission({
      userId: user.id,
      jobId: jobs[0].id,
      resumeDocId: docs[0].id,
      authorizedAdapterCallback: async () => ({
        confirmed: true,
        externalConfirmationId: '',
      }),
    });
    assert.equal(initialSub.status, 'SUBMITTED_UNCONFIRMED');
    assert.equal(initialSub.evidenceLevel, 'SUBMISSION_UNCERTAIN');

    // Unsigned caller confirmation string ('confirmation123') must NOT mark SUBMITTED_VERIFIED
    const unsignedAttempt = api.nexus.reconcileUncertainSubmission({
      userId: user.id,
      applicationId: initialSub.applicationId,
      externalConfirmationId: 'confirmation123',
      verificationSource: 'Caller Typed String',
    });
    assert.equal(unsignedAttempt.newStatus, 'USER_REPORTED');
    assert.equal(unsignedAttempt.evidenceLevel, 'USER_REPORTED');
    assert.equal(unsignedAttempt.verified, false);
    assert.equal(unsignedAttempt.externalConfirmationId, null);

    // Signed provider webhook receipt transitions to SUBMITTED_VERIFIED / PROVIDER_CONFIRMED
    const validSig = api.nexus.signEmployerWebhookReceipt({
      applicationId: initialSub.applicationId,
      externalConfirmationId: 'GH-RECONCILED-2026-7744',
      verificationSource: 'Greenhouse Confirmation Webhook',
    });

    const reconciled = api.nexus.reconcileUncertainSubmission({
      userId: user.id,
      applicationId: initialSub.applicationId,
      externalConfirmationId: 'GH-RECONCILED-2026-7744',
      verificationSource: 'Greenhouse Confirmation Webhook',
      webhookSignature: validSig,
    });
    assert.equal(reconciled.newStatus, 'SUBMITTED_VERIFIED');
    assert.equal(reconciled.evidenceLevel, 'PROVIDER_CONFIRMED');
    assert.equal(reconciled.verified, true);
    assert.equal(reconciled.externalConfirmationId, 'GH-RECONCILED-2026-7744');
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
