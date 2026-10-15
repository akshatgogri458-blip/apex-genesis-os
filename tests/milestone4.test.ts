import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../src/db/d1-sqlite-engine';
import { SecurityGuard } from '../src/security/auth';
import { DurableExecutionEngine } from '../src/autonomy/queue-engine';

const TEST_DB_PATH = path.resolve(__dirname, '../../.tmp_m4_test.sqlite');
const SCHEMA_PATH = path.resolve(__dirname, '../../migrations/0001_genesis_schema.sql');

test('Milestone 4 — Persistence & Autonomy: Idempotency, Leases, Checkpoints, Backoff, Dead-Letter Queue, and Emergency Stop', async (t) => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new ApexD1Database(TEST_DB_PATH);
  db.migrateFromFile(SCHEMA_PATH);
  const security = new SecurityGuard(db, 'apex_genesis_super_secret_signing_key_2026_verified_32bytes');
  const user = security.registerUser({
    email: 'autonomy.user@example.com',
    displayName: 'Autonomy User',
    password: 'StrongPassword!2026',
    emailVerified: true,
  });

  const queue = new DurableExecutionEngine(db, { maxConcurrentLeases: 2 });

  await t.test('1. Prevents duplicate task creation via idempotency keys and enforces DAG dependencies', () => {
    const first = queue.enqueueTask({
      userId: user.id,
      agentId: 'job-discovery',
      toolId: 'jobs.search_stored',
      idempotencyKey: 'idem_discover_batch_1',
      payload: { page: 1 },
    });
    const dup = queue.enqueueTask({
      userId: user.id,
      agentId: 'job-discovery',
      toolId: 'jobs.search_stored',
      idempotencyKey: 'idem_discover_batch_1',
      payload: { page: 1 },
    });

    assert.equal(first.deduplicated, false);
    assert.equal(dup.deduplicated, true);
    assert.equal(first.task.id, dup.task.id);

    const child = queue.enqueueTask({
      userId: user.id,
      agentId: 'job-matching',
      toolId: 'jobs.evaluate_eligibility',
      idempotencyKey: 'idem_match_batch_1',
      payload: {},
      dependsOnTaskIds: [first.task.id],
    });
    assert.equal(child.task.status, 'PENDING');

    const leased = queue.acquireLease('worker-alpha', 5000);
    assert.equal(leased?.id, first.task.id);
    queue.saveCheckpoint(first.task.id, 'worker-alpha', { cursor: 'item_50' });
    queue.completeTask(first.task.id, 'worker-alpha', { discovered: 50 });

    const promotedChild = queue.getTaskById(child.task.id)!;
    assert.equal(promotedChild.status, 'READY', 'Dependent child task must auto-promote to READY when parent completes');
  });

  await t.test('2. Recovers expired worker leases after simulated crash and moves exhausted retries to Dead-Letter Queue', () => {
    const flaky = queue.enqueueTask({
      userId: user.id,
      agentId: 'authorized-application-execution',
      toolId: 'applications.prepare_authorized_submission',
      idempotencyKey: 'idem_flaky_task',
      priority: 1,
      payload: {},
      maxAttempts: 2,
    });

    const now = new Date();
    const lease1 = queue.acquireLease('worker-crashed', 1000, now.toISOString());
    assert.equal(lease1?.id, flaky.task.id);

    // Simulate 5 seconds later: worker-crashed lease expired
    const afterExpiry = new Date(now.getTime() + 5000).toISOString();
    const reclaimReport = queue.refreshQueueState(afterExpiry);
    assert.ok(reclaimReport.reclaimedLeases >= 1);

    // Lease again on attempt 2 and fail permanently
    const lease2 = queue.acquireLease('worker-healthy', 5000, afterExpiry);
    assert.equal(lease2?.id, flaky.task.id);
    assert.equal(lease2?.attemptCount, 2);

    const failedTask = queue.failTask(flaky.task.id, 'worker-healthy', 'UPSTREAM_502_BAD_GATEWAY', true, 100);
    assert.equal(failedTask.status, 'DEAD_LETTER');

    const dlt = queue.listDeadLetterTasks(user.id);
    assert.equal(dlt.length, 1);
    assert.equal(dlt[0].task_id, flaky.task.id);
  });

  await t.test('3. Halts all task leasing immediately when Emergency Stop is triggered', () => {
    queue.setEmergencyStop(true, 'Manual operator safety test');
    assert.equal(queue.isEmergencyStopped(), true);
    const blockedLease = queue.acquireLease('worker-healthy');
    assert.equal(blockedLease, null);
    queue.setEmergencyStop(false, 'Resumed after test');
  });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
