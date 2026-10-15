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

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m3_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 3 — Intelligence: 5-Domain Memory, Universal Tool Registry, 24 Agents, and 18-Step Planner', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const user = security.registerUser({
    email: 'planner.user@example.com',
    displayName: 'Planner User',
    password: 'StrongPassword!2026',
    emailVerified: true,
  });

  const neural = new ApexNeuralCore(db);
  neural.registerProvider(new DeterministicStructuredEngine());
  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });

  await t.test('1. Separates AI-generated hypotheses from verified truth and enforces per-user memory isolation', () => {
    memory.addCandidateFact({
      userId: user.id,
      category: 'SKILL',
      attributeKey: 'Primary Language',
      attributeValue: 'TypeScript',
      verified: true,
      evidenceSource: 'Master_Resume_2026.pdf',
      evidenceExcerpt: '5+ years building production TypeScript & Node.js distributed services.',
    });
    memory.addCandidateFact({
      userId: user.id,
      category: 'EMPLOYMENT',
      attributeKey: 'Senior Software Engineer at CloudScale',
      attributeValue: '2022-2026',
      verified: true,
      evidenceSource: 'Master_Resume_2026.pdf',
      evidenceExcerpt: 'Senior Software Engineer, CloudScale Inc. (2022–2026)',
    });

    // Store an AI hypothesis in memory — must NEVER be returned when verifiedTruthOnly = true
    memory.storeMemory({
      userId: user.id,
      domain: 'CANDIDATE',
      memoryKey: 'hypothesis:kubernetes_cert',
      value: { claim: 'Candidate might have CKA certification' },
      sourceType: 'AI_HYPOTHESIS',
      evidenceRef: 'inferred-by-model',
    });

    const verifiedEntries = memory.retrieveDomainMemory({
      actorUserId: user.id,
      targetUserId: user.id,
      domain: 'CANDIDATE',
      verifiedTruthOnly: true,
    });
    assert.equal(verifiedEntries.some((e) => e.memoryKey === 'hypothesis:kubernetes_cert'), false, 'AI hypothesis must never be returned as verified truth');

    assert.throws(
      () =>
        memory.retrieveDomainMemory({
          actorUserId: 'usr_foreign_attacker',
          targetUserId: user.id,
          domain: 'CANDIDATE',
        }),
      /MEMORY_ACCESS_DENIED/
    );
  });

  await t.test('2. Enforces Tool Registry permission boundaries (READ/WRITE/EXTERNAL/DESTRUCTIVE)', async () => {
    const denied = await tools.invoke(
      'account.purge_all_data',
      { confirmPurge: true },
      {
        userId: user.id,
        actorId: 'agent:job-discovery',
        grantedPermissions: ['READ'],
        remainingCostBudgetUnits: 50,
      }
    );
    assert.equal(denied.status, 'DENIED_PERMISSION');

    await assert.rejects(
      async () =>
        tools.invoke('shell.exec_arbitrary_code', {}, {
          userId: user.id,
          actorId: 'agent:rogue',
          grantedPermissions: ['READ', 'WRITE', 'EXTERNAL', 'SENSITIVE', 'DESTRUCTIVE'],
          remainingCostBudgetUnits: 100,
        }),
      /UNREGISTERED_TOOL_BLOCKED/
    );
  });

  await t.test('3. Verifies all 24 specialized agents have executable handlers and marks any handler-less agent NOT_IMPLEMENTED', async () => {
    const fleet = agents.listAgents();
    assert.equal(fleet.length, 24);
    for (const a of fleet) {
      assert.equal(a.implementationStatus, 'IMPLEMENTED_AND_TESTED');
      const res = await agents.executeAgent(a.agentId, { userId: user.id, payload: {} });
      assert.equal(res.status, 'COMPLETED');
    }

    agents.registerAgent({
      agentId: 'future-quantum-adapter',
      displayName: 'Future Quantum Adapter',
      roleDescription: 'Placeholder agent without handler',
      implementationStatus: 'IMPLEMENTED_AND_TESTED', // Should be automatically downgraded to NOT_IMPLEMENTED
      allowedPermissions: ['READ'],
      requiredInputKeys: [],
      outputSchemaKeys: [],
    });
    const unimp = agents.getAgent('future-quantum-adapter')!;
    assert.equal(unimp.implementationStatus, 'NOT_IMPLEMENTED');
  });

  await t.test('4. Executes the 18-step planner, prevents self-permission escalation, retries transient failure, and continues independent tasks', async () => {
    // User only grants READ and WRITE (NOT EXTERNAL). Steps 6 and 7 require EXTERNAL so planner must escalate them to HUMAN_ATTENTION without self-granting!
    const report = await planner.planAndExecuteObjective({
      userId: user.id,
      objective:
        'Find 500 software engineering positions matching my verified skills, prioritize remote roles, prepare tailored resumes, use authorized application methods, and monitor employer responses.',
      userGrantedPermissions: ['READ', 'WRITE'],
      customStepOverrides: {
        step_2_discover: { simulateRecoverableFailureOnce: true },
      },
    });

    assert.equal(report.stepsTrace.length, 18);
    assert.equal(report.completedTaskIds.length, 5, 'Steps 1-5 (READ/WRITE) should complete including Step 5 independent of Step 6');
    assert.equal(report.retriedTaskIds.length, 1, 'Step 2 should have failed once and succeeded on retry');
    assert.equal(report.escalatedBlockerTaskIds.length, 2, 'Steps 6 & 7 requiring EXTERNAL permission must be escalated, never self-granted');
    assert.equal(report.completionEvidenceVerified, true);
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
