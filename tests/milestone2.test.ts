import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import {
  ApexNeuralCore,
  CloudflareWorkersAIProvider,
  GoogleGeminiProvider,
  DeterministicStructuredEngine,
} from '../src/neural-core/index';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m2_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 2 & Phase 4 — Real AI (APEX Neural Core): @cf/google/gemma-4-26b-a4b-it, REAL vs MOCK vs DETERMINISTIC_FALLBACK Truthfulness, and Request Cancellation', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const user = security.registerUser({
    email: 'neural.tester@example.com',
    displayName: 'Neural Tester',
    password: 'StrongPassword!2026',
  });

  await t.test('1. Never marks a provider CONNECTED_VERIFIED merely because configuration variables exist and advertises honest capabilities for DeterministicStructuredEngine', async () => {
    const cfWithEnvOnly = new CloudflareWorkersAIProvider({
      accountId: 'cf_acc_12345',
      apiToken: 'cf_tok_secret',
    });
    assert.equal(cfWithEnvOnly.getStatus(), 'UNVERIFIED_CONFIG', 'Must start as UNVERIFIED_CONFIG, never CONNECTED');

    const probe = await cfWithEnvOnly.runLiveHealthProbe(500);
    assert.notEqual(probe.status, 'CONNECTED_VERIFIED');

    const detEngine = new DeterministicStructuredEngine();
    const detCaps = detEngine.getCapabilities()[0];
    assert.equal(detCaps.isTrainedFoundationModel, false, 'Deterministic engine must never claim to be a trained foundation model');
    assert.equal(detCaps.supportsEmbeddings, false, 'Deterministic engine must not advertise embedding capabilities');
    assert.equal(detCaps.maxContextTokens, 0, 'Deterministic engine must not advertise a fictional LLM context window');
    assert.equal(detCaps.executionCategory, 'DETERMINISTIC_FALLBACK');
  });

  await t.test('2. Distinguishes REAL_INFERENCE from MOCK_INFERENCE and only records PROVIDER_MEASURED usage when returned by provider', async () => {
    const mockBindingProvider = new CloudflareWorkersAIProvider({
      isMockAdapter: true,
      aiBinding: {
        __isTestMock: true,
        run: async (model: string, input: any) => {
          assert.equal(model, '@cf/google/gemma-4-26b-a4b-it', 'Must route to official @cf/google/gemma-4-26b-a4b-it model');
          const userMsg = input.messages[input.messages.length - 1].content;
          if (userMsg.includes('status')) {
            return { response: JSON.stringify({ status: 'OK', verified: true }) };
          }
          return {
            response: JSON.stringify({
              interpretedObjective: userMsg,
              steps: [{ stepId: 's1', agentId: 'job-discovery', toolId: 'jobs.search_stored' }],
            }),
            usage: { prompt_tokens: 48, completion_tokens: 32, neurons: 2.1 },
          };
        },
      },
    });

    const probe = await mockBindingProvider.runLiveHealthProbe();
    assert.equal(probe.status, 'CONNECTED_VERIFIED');
    assert.equal(probe.executionCategory, 'MOCK_INFERENCE', 'Test harness binding must be transparently categorized as MOCK_INFERENCE');

    const core = new ApexNeuralCore(db, { maxDailyNeurons: 50 });
    core.registerProvider(mockBindingProvider);
    core.registerProvider(new DeterministicStructuredEngine());

    const res = await core.infer({
      userId: user.id,
      taskType: 'PLANNING',
      prompt: 'Find 25 remote TypeScript backend roles and prepare tailored resumes.',
      expectedJsonKeys: ['interpretedObjective', 'steps'],
    });

    assert.equal(res.providerId, 'cloudflare-workers-ai');
    assert.equal(res.modelId, '@cf/google/gemma-4-26b-a4b-it');
    assert.equal(res.executionCategory, 'MOCK_INFERENCE');
    assert.equal(res.usageAccountingMode, 'PROVIDER_MEASURED');
    assert.equal(res.neuronsConsumed, 2.1);
  });

  await t.test('3. Routes to DETERMINISTIC_FALLBACK when primary fails schema validation and supports AbortSignal cancellation', async () => {
    const malformedProvider = new CloudflareWorkersAIProvider({
      isMockAdapter: true,
      aiBinding: {
        run: async () => ({ response: 'NOT_VALID_JSON_OUTPUT' }),
      },
    });
    const core = new ApexNeuralCore(db, { maxDailyNeurons: 9000 });
    core.registerProvider(malformedProvider);
    core.registerProvider(new DeterministicStructuredEngine());

    const res = await core.infer({
      userId: user.id,
      taskType: 'PLANNING',
      prompt: 'Find 500 software engineering positions matching my verified skills, prioritize remote roles, prepare tailored resumes, use authorized application methods, and monitor employer responses.',
      expectedJsonKeys: ['interpretedObjective', 'constraints', 'steps'],
    });

    assert.equal(res.providerId, 'apex-local-deterministic-v1');
    assert.equal(res.executionCategory, 'DETERMINISTIC_FALLBACK', 'Fallback must never be presented as REAL_INFERENCE');
    assert.equal(res.usageAccountingMode, 'DETERMINISTIC_ZERO_LLM');
    assert.equal(res.neuronsConsumed, null, 'Must not fabricate neuron numbers for deterministic fallback');
    assert.equal(res.fallbackUsed, true);

    // Test AbortSignal cancellation
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    await assert.rejects(
      async () =>
        core.infer({
          userId: user.id,
          taskType: 'PLANNING',
          prompt: 'Cancelled request',
          signal: abortCtrl.signal,
        }),
      /INFERENCE_CANCELLED/
    );
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
