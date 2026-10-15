import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import { MemoryEngine } from '../src/memory/index';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';
import { AuthorizedIntegrationNexus } from '../src/integrations/nexus';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m78_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 7 & 8 — Authorized Integrations & Application Automation: CAPTCHA Halt, External Confirmation Proof, Gmail Classification, and Calendar Conflict Guard', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const user = security.registerUser({
    email: 'automation.user@example.com',
    displayName: 'Automation User',
    password: 'StrongPassword!2026',
    emailVerified: true,
  });

  const memory = new MemoryEngine(db);
  const queue = new DurableExecutionEngine(db);
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory);

  memory.addCandidateFact({
    userId: user.id,
    category: 'SKILL',
    attributeKey: 'Core Stack',
    attributeValue: 'TypeScript & Distributed Systems',
    verified: true,
    evidenceSource: 'Verified_CV.pdf',
    evidenceExcerpt: 'TypeScript & Distributed Systems',
  });

  const ingested = recruitment.ingestVacancies(user.id, [
    {
      externalId: 'gh_2001',
      sourceFeed: 'Greenhouse API',
      sourceUrl: 'https://boards.greenhouse.io/cloudflare/jobs/2001',
      title: 'Systems Engineer — Edge Workers',
      companyName: 'Cloudflare',
      location: 'Remote',
      remoteStatus: 'REMOTE',
      requiredSkills: ['TypeScript'],
      descriptionText: 'Edge Workers Platform',
      submissionMethod: 'GREENHOUSE_API',
      postedAt: new Date().toISOString(),
    },
    {
      externalId: 'lv_2002',
      sourceFeed: 'Lever API',
      sourceUrl: 'https://jobs.lever.co/vercel/2002',
      title: 'Staff Infrastructure Engineer',
      companyName: 'Vercel',
      location: 'Remote',
      remoteStatus: 'REMOTE',
      requiredSkills: ['TypeScript'],
      descriptionText: 'Cloud Platform',
      submissionMethod: 'LEVER_API',
      postedAt: new Date().toISOString(),
    },
  ]);

  const resume = recruitment.generateTruthfulTailoredResume({
    userId: user.id,
    jobId: ingested.jobIds[0],
  });

  await t.test('1. Halts safely on CAPTCHA challenge without attempting bypass and escalates to HUMAN_ATTENTION', async () => {
    const outcome = await nexus.executeAuthorizedSubmission({
      userId: user.id,
      jobId: ingested.jobIds[0],
      resumeDocId: resume.documentId,
      encounteredCaptchaChallenge: true,
    });

    assert.equal(outcome.status, 'BLOCKED_CAPTCHA');
    assert.equal(outcome.externalConfirmationId, null);
    assert.ok(outcome.humanAttentionTaskId);

    const task = queue.getTaskById(outcome.humanAttentionTaskId!)!;
    assert.equal(task.status, 'HUMAN_ATTENTION');
    assert.ok(task.lastError?.includes('CAPTCHA_CHALLENGE_DETECTED'));
  });

  await t.test('2. Refuses to mark application SUBMITTED_VERIFIED without an attributable external confirmation ID', async () => {
    const unconfirmed = await nexus.executeAuthorizedSubmission({
      userId: user.id,
      jobId: ingested.jobIds[1],
      resumeDocId: resume.documentId,
      authorizedAdapterCallback: async () => ({
        confirmed: true,
        externalConfirmationId: '', // Missing external confirmation ID!
      }),
    });

    assert.equal(unconfirmed.status, 'SUBMITTED_UNCONFIRMED');
    assert.equal(unconfirmed.externalConfirmationId, null);

    // Now test with a real attributable confirmation receipt from Greenhouse API
    const confirmed = await nexus.executeAuthorizedSubmission({
      userId: user.id,
      jobId: ingested.jobIds[1],
      resumeDocId: resume.documentId,
      authorizedAdapterCallback: async () => ({
        confirmed: true,
        externalConfirmationId: 'GH-CONF-2026-998877',
        receipt: { partner: 'Greenhouse', timestamp: new Date().toISOString() },
      }),
    });

    assert.equal(confirmed.status, 'SUBMITTED_VERIFIED');
    assert.equal(confirmed.externalConfirmationId, 'GH-CONF-2026-998877');
  });

  await t.test('3. Classifies recruiter emails accurately and prevents overlapping interview calendar slots', () => {
    const msg = nexus.ingestRecruiterEmail({
      userId: user.id,
      externalThreadId: 'thd_gmail_101',
      senderEmail: 'recruiting@cloudflare.com',
      companyName: 'Cloudflare',
      subject: 'Interview invitation: Systems Engineer — Edge Workers',
      snippet: 'We would love to schedule a call this week. Please share your availability.',
    });
    assert.equal(msg.classification, 'INTERVIEW_INVITE');
    assert.equal(msg.requiresResponse, true);

    nexus.scheduleInterviewSlot({
      userId: user.id,
      companyName: 'Cloudflare',
      roleTitle: 'Systems Engineer',
      stageName: 'Technical Architecture Round',
      scheduledStartAt: '2026-10-20T14:00:00.000Z',
      scheduledEndAt: '2026-10-20T15:00:00.000Z',
    });

    // Overlapping slot must throw CALENDAR_CONFLICT_DETECTED
    assert.throws(
      () =>
        nexus.scheduleInterviewSlot({
          userId: user.id,
          companyName: 'Vercel',
          roleTitle: 'Staff Infrastructure Engineer',
          stageName: 'System Design',
          scheduledStartAt: '2026-10-20T14:30:00.000Z',
          scheduledEndAt: '2026-10-20T15:30:00.000Z',
        }),
      /CALENDAR_CONFLICT_DETECTED/
    );
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
