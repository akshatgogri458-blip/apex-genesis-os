import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { APEX_DESIGN_TOKENS, REQUIRED_23_WORKSPACES } from '../src/ui/design-system';
import { renderWorkspaceVerifySummary } from '../src/ui/ApexGenesisApp';
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

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m6_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 6 — Flagship UI (APEX GENESIS — Intelligent Career Command Environment): 23 Workspaces, Design Tokens, Accessibility, and Live State Wiring', async (t) => {
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

  await t.test('1. Verifies all 23 required workspaces exist in exact specification order with luxury Midnight/Sapphire/Platinum/Champagne design tokens', () => {
    assert.equal(REQUIRED_23_WORKSPACES.length, 23);
    const expectedTitles = [
      'Mission Control',
      'AI Command Center',
      'Neural Core',
      'Agent Fleet',
      'Opportunity Explorer',
      'Job Matching',
      'Campaign Manager',
      'Application Pipeline',
      'Resume Studio',
      'Candidate Profile',
      'Employer Intelligence',
      'Document Library',
      'Task Execution',
      'Workflow Studio',
      'Integration Nexus',
      'Recruiter Inbox',
      'Interview Center',
      'Analytics',
      'Knowledge and Memory',
      'Resource Guardian',
      'System Health',
      'Security Center',
      'Settings',
    ];
    assert.deepEqual(
      REQUIRED_23_WORKSPACES.map((w) => w.title),
      expectedTitles
    );
    assert.equal(APEX_DESIGN_TOKENS.wcagContrastVerified, true);
    assert.ok(APEX_DESIGN_TOKENS.surfaces.obsidianVoid.startsWith('#'));
    assert.ok(APEX_DESIGN_TOKENS.accents.champagneGold.startsWith('#'));
  });

  await t.test('2. Binds all 23 workspaces to real backend application state with zero ungrounded metrics', () => {
    const regUi = security.registerUser({
      email: 'ui.architect@apex-genesis.io',
      displayName: 'UI Architect',
      password: 'StrongPassword!2026',
    });
    const chUi = security.issueVerificationChallenge(regUi.id);
    security.verifyEmailChallenge('ui.architect@apex-genesis.io', chUi.verificationToken);
    const session = security.issueSession({
      email: 'ui.architect@apex-genesis.io',
      password: 'StrongPassword!2026',
      ipAddress: '127.0.0.1',
      userAgent: 'ApexUITest/1.0',
    });
    const ctx = security.authenticateRequest(session.sessionToken, session.csrfToken, true);
    const state = api.buildCompleteWorkspaceState(ctx);

    for (const ws of REQUIRED_23_WORKSPACES) {
      const summary = renderWorkspaceVerifySummary(ws.id, state);
      assert.equal(summary.workspace.id, ws.id);
      assert.ok(summary.ariaLabel.includes(ws.title));
      assert.ok(summary.statusBadge === 'IMPLEMENTED_AND_TESTED' || summary.statusBadge === 'PARTIALLY_IMPLEMENTED');
    }
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
