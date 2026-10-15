import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import { MemoryEngine } from '../src/memory/index';
import { RecruitmentWorkflowEngine } from '../src/recruitment/engine';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m5_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 5 — Recruitment Workflows: Discovery Deduplication, Explainable Matching with Unknown-Fact Preservation, and Truthful Resume Grounding', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const user = security.registerUser({
    email: 'recruitment.user@example.com',
    displayName: 'Recruitment User',
    password: 'StrongPassword!2026',
    emailVerified: true,
  });

  const memory = new MemoryEngine(db);
  const recruitment = new RecruitmentWorkflowEngine(db, memory);

  let primaryJobId = '';

  await t.test('1. Ingests resume with excerpt verification and rejects fabricated evidence excerpts', () => {
    const rawResume = `
      Arjun Mehta — Staff Distributed Systems Engineer
      Experience: Senior Software Engineer at CloudScale (2022–2026), architected TypeScript & PostgreSQL microservices handling 45,000 req/s.
      Education: B.Tech in Computer Science, IIT Bombay (2018–2022).
      Skills: TypeScript, React, Node.js, SQLite, Cloudflare Workers, Distributed Systems.
    `;

    assert.throws(
      () =>
        recruitment.ingestResumeDocument({
          userId: user.id,
          title: 'Arjun_Master_Resume.pdf',
          format: 'PDF_TEXT',
          rawText: rawResume,
          verifiedExtractions: [
            {
              category: 'DEGREE' as any,
              attributeKey: 'PhD at MIT',
              attributeValue: 'PhD Computer Science',
              evidenceExcerpt: 'PhD in Quantum Computing at MIT', // Does not exist in rawResume!
            },
          ],
        }),
      /RESUME_INGESTION_EVIDENCE_MISMATCH/
    );

    const ingested = recruitment.ingestResumeDocument({
      userId: user.id,
      title: 'Arjun_Master_Resume.pdf',
      format: 'PDF_TEXT',
      rawText: rawResume,
      verifiedExtractions: [
        {
          category: 'SKILL',
          attributeKey: 'Language',
          attributeValue: 'TypeScript',
          evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, Cloudflare Workers',
        },
        {
          category: 'SKILL',
          attributeKey: 'Frontend',
          attributeValue: 'React',
          evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, Cloudflare Workers',
        },
        {
          category: 'SKILL',
          attributeKey: 'Runtime',
          attributeValue: 'Node.js',
          evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, Cloudflare Workers',
        },
        {
          category: 'EMPLOYMENT',
          attributeKey: 'Senior Software Engineer at CloudScale',
          attributeValue: 'Architected TypeScript & PostgreSQL microservices handling 45,000 req/s (2022–2026)',
          evidenceExcerpt: 'Senior Software Engineer at CloudScale (2022–2026), architected TypeScript & PostgreSQL microservices handling 45,000 req/s.',
        },
      ],
    });

    assert.equal(ingested.extractedFacts.length, 4);
  });

  await t.test('2. Normalizes and deduplicates job feeds, filters stale listings, and enforces source attribution', () => {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

    const batch = recruitment.ingestVacancies(user.id, [
      {
        externalId: 'gh_1001',
        sourceFeed: 'Greenhouse Public API',
        sourceUrl: 'https://boards.greenhouse.io/stripe/jobs/1001',
        title: 'Senior Full-Stack Engineer (AI Platform)',
        companyName: 'Stripe',
        location: 'Remote (Global)',
        remoteStatus: 'REMOTE',
        minYearsRequired: 4,
        salaryMinUsd: 165000,
        salaryMaxUsd: 210000,
        workAuthRequired: 'US_OR_REMOTE_CONTRACTOR',
        requiredSkills: ['TypeScript', 'React', 'Node.js', 'Go'],
        descriptionText: 'Build resilient autonomous payment and AI infrastructure.',
        submissionMethod: 'GREENHOUSE_API',
        postedAt: nowIso,
      },
      // Exact duplicate of gh_1001
      {
        externalId: 'gh_1001',
        sourceFeed: 'Greenhouse Public API',
        sourceUrl: 'https://boards.greenhouse.io/stripe/jobs/1001',
        title: 'Senior Full-Stack Engineer (AI Platform)',
        companyName: 'Stripe',
        location: 'Remote (Global)',
        remoteStatus: 'REMOTE',
        requiredSkills: ['TypeScript', 'React', 'Node.js', 'Go'],
        descriptionText: 'Duplicate listing test',
        submissionMethod: 'GREENHOUSE_API',
        postedAt: nowIso,
      },
      // Stale listing (90 days old)
      {
        externalId: 'lv_old_99',
        sourceFeed: 'Lever Postings API',
        sourceUrl: 'https://jobs.lever.co/example/old-99',
        title: 'Legacy Engineer',
        companyName: 'OldCorp',
        location: 'Onsite',
        remoteStatus: 'ONSITE',
        requiredSkills: ['Java'],
        descriptionText: 'Stale job test',
        submissionMethod: 'LEVER_API',
        postedAt: staleIso,
      },
    ]);

    assert.equal(batch.inserted, 1);
    assert.equal(batch.deduplicated, 1);
    assert.equal(batch.staleSkipped, 1);
    primaryJobId = batch.jobIds[0];
  });

  await t.test('3. Computes explainable match score and preserves unknown candidate facts without guessing', () => {
    const match = recruitment.evaluateJobMatch(user.id, primaryJobId);
    assert.equal(match.matchedSkills.length, 3); // TypeScript, React, Node.js
    assert.deepEqual(match.missingSkills, ['Go']);
    assert.ok(match.unknownFacts.includes('CANDIDATE_YEARS_OF_EXPERIENCE'), 'Unknown years of experience must remain UNKNOWN');
    assert.ok(match.unknownFacts.includes('WORK_AUTHORIZATION_FOR_US_OR_REMOTE_CONTRACTOR'), 'Unknown work authorization must remain UNKNOWN');
    assert.equal(match.eligibilityStatus, 'PARTIAL_UNKNOWN');
  });

  await t.test('4. Generates truthful tailored resume and rejects any unverified/invented claim', () => {
    const verifiedFacts = memory.getVerifiedCandidateFacts(user.id, user.id);
    const tailored = recruitment.generateTruthfulTailoredResume({
      userId: user.id,
      jobId: primaryJobId,
      proposedClaims: [
        {
          claimText: 'Expert in TypeScript, React, and Node.js production architectures.',
          factId: verifiedFacts[0].id,
        },
        {
          claimText: 'Invented claim: Led 50-person Go kernel team at Google.',
          factId: 'fact_nonexistent_hallucinated_id', // Must be rejected!
        },
      ],
    });

    assert.equal(tailored.truthfulnessVerified, true);
    assert.equal(tailored.linkedClaims.length, 1);
    assert.equal(tailored.rejectedUnverifiedClaims.length, 1);
    assert.ok(tailored.rejectedUnverifiedClaims[0].includes('Invented claim'));
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
