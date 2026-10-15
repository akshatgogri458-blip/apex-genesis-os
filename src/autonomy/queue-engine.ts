import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'LEASED'
  | 'COMPLETED'
  | 'RETRY_WAIT'
  | 'DEAD_LETTER'
  | 'HUMAN_ATTENTION'
  | 'CANCELLED';

export interface DurableTask {
  id: string;
  userId: string;
  planId: string | null;
  agentId: string;
  toolId: string;
  idempotencyKey: string;
  status: TaskStatus;
  priority: number;
  payload: Record<string, any>;
  result: Record<string, any> | null;
  checkpoint: Record<string, any>;
  attemptCount: number;
  maxAttempts: number;
  nextEligibleAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
}

export class DurableExecutionEngine {
  private db: ApexD1Database;
  private maxConcurrentLeases: number;

  constructor(db: ApexD1Database, opts?: { maxConcurrentLeases?: number }) {
    this.db = db;
    this.maxConcurrentLeases = opts?.maxConcurrentLeases ?? 5;
  }

  public isEmergencyStopped(): boolean {
    const row = this.db
      .prepare(`SELECT value_json FROM system_settings WHERE key = 'EMERGENCY_STOP'`)
      .first<{ value_json: string }>();
    if (!row) return false;
    return JSON.parse(row.value_json).stopped === true;
  }

  public setEmergencyStop(stopped: boolean, reason: string, triggeredByUserId = 'SYSTEM_ADMIN'): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO system_settings (key, value_json, updated_at)
         VALUES ('EMERGENCY_STOP', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .bind(JSON.stringify({ stopped, reason, triggeredByUserId, updatedAt: now }), now)
      .run();
  }

  public setScopedEmergencyStop(params: {
    scopeId: string;
    scopeType: 'GLOBAL' | 'CANDIDATE' | 'CAMPAIGN' | 'AGENT';
    ownerUserId: string;
    targetResourceId: string | null;
    stopped: boolean;
    reason: string;
    triggeredByUserId: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scoped_emergency_stops (scope_id, scope_type, owner_user_id, target_resource_id, stopped, reason, triggered_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           stopped = excluded.stopped,
           reason = excluded.reason,
           triggered_by_user_id = excluded.triggered_by_user_id,
           updated_at = excluded.updated_at`
      )
      .bind(
        params.scopeId,
        params.scopeType,
        params.ownerUserId,
        params.targetResourceId,
        params.stopped ? 1 : 0,
        params.reason,
        params.triggeredByUserId,
        now
      )
      .run();
  }

  public isScopeStopped(scopeId: string): boolean {
    const row = this.db
      .prepare(`SELECT stopped FROM scoped_emergency_stops WHERE scope_id = ?`)
      .bind(scopeId)
      .first<{ stopped: number }>();
    return Boolean(row && Number(row.stopped) === 1);
  }

  public listActiveEmergencyStops(userId: string): any[] {
    return this.db
      .prepare(`SELECT * FROM scoped_emergency_stops WHERE stopped = 1 AND (owner_user_id = ? OR scope_type = 'GLOBAL')`)
      .bind(userId)
      .all()
      .results;
  }

  public isTaskBlockedByEmergencyStop(task: { userId: string; agentId?: string; payload?: Record<string, any> }): boolean {
    if (this.isEmergencyStopped()) return true;
    if (this.isScopeStopped(`CANDIDATE:${task.userId}`)) return true;
    if (task.agentId && this.isScopeStopped(`AGENT:${task.userId}:${task.agentId}`)) return true;
    const campId = task.payload?.campaignId;
    if (campId && this.isScopeStopped(`CAMPAIGN:${campId}`)) return true;
    return false;
  }

  public enqueueTask(params: {
    userId: string;
    planId?: string | null;
    agentId: string;
    toolId: string;
    idempotencyKey: string;
    priority?: number;
    payload: Record<string, any>;
    dependsOnTaskIds?: string[];
    maxAttempts?: number;
  }): { task: DurableTask; deduplicated: boolean } {
    const existing = this.db
      .prepare(`SELECT * FROM tasks WHERE idempotency_key = ?`)
      .bind(params.idempotencyKey)
      .first<any>();

    if (existing) {
      return { task: this.mapRow(existing), deduplicated: true };
    }

    const id = 'tsk_' + crypto.randomBytes(10).toString('hex');
    const now = new Date().toISOString();
    const deps = params.dependsOnTaskIds ?? [];
    const initialStatus: TaskStatus = deps.length === 0 ? 'READY' : 'PENDING';

    this.db
      .prepare(
        `INSERT INTO tasks (id, user_id, plan_id, agent_id, tool_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempt_count, max_attempts, next_eligible_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.userId,
        params.planId ?? null,
        params.agentId,
        params.toolId,
        params.idempotencyKey,
        initialStatus,
        params.priority ?? 5,
        JSON.stringify(params.payload),
        params.maxAttempts ?? 3,
        now,
        now,
        now
      )
      .run();

    for (const depId of deps) {
      this.db
        .prepare(`INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`)
        .bind(id, depId)
        .run();
    }

    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first<any>();
    return { task: this.mapRow(row), deduplicated: false };
  }

  /**
   * Reclaims expired worker leases (crash recovery), promotes PENDING tasks whose dependencies
   * are all COMPLETED, and propagates DEAD_LETTER/CANCELLED dependencies to downstream tasks.
   */
  public refreshQueueState(nowIso = new Date().toISOString()): { reclaimedLeases: number; promotedTasks: number } {
    const expiredRes = this.db
      .prepare(
        `UPDATE tasks
         SET status = 'READY', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
      )
      .bind(nowIso, nowIso)
      .run();

    this.db
      .prepare(
        `UPDATE tasks
         SET status = 'READY', updated_at = ?
         WHERE status = 'RETRY_WAIT' AND next_eligible_at <= ?`
      )
      .bind(nowIso, nowIso)
      .run();

    const pendingRows = this.db
      .prepare(`SELECT id, user_id FROM tasks WHERE status = 'PENDING'`)
      .all<{ id: string; user_id: string }>().results;

    let promoted = 0;
    for (const p of pendingRows) {
      const deps = this.db
        .prepare(
          `SELECT t.id, t.status
           FROM task_dependencies td
           JOIN tasks t ON t.id = td.depends_on_task_id
           WHERE td.task_id = ?`
        )
        .bind(p.id)
        .all<{ id: string; status: string }>().results;

      if (deps.some((d) => d.status === 'DEAD_LETTER' || d.status === 'CANCELLED')) {
        this.db
          .prepare(`UPDATE tasks SET status = 'DEAD_LETTER', last_error = 'BLOCKED_BY_FAILED_DEPENDENCY', updated_at = ? WHERE id = ?`)
          .bind(nowIso, p.id)
          .run();
        continue;
      }

      if (deps.length === 0 || deps.every((d) => d.status === 'COMPLETED')) {
        this.db
          .prepare(`UPDATE tasks SET status = 'READY', updated_at = ? WHERE id = ?`)
          .bind(nowIso, p.id)
          .run();
        promoted++;
      }
    }

    return { reclaimedLeases: expiredRes.meta.changes, promotedTasks: promoted };
  }

  /**
   * Audit Finding #5 Fix:
   * - Generates an invocation-unique lease owner ID (`${workerId}::lease_${hex}`)
   * - Performs a conditional UPDATE (`WHERE id = ? AND status = 'READY'`) and checks
   *   `claimRes.meta.changes === 1` so concurrent workers can never double-claim a task.
   * - Respects both GLOBAL and per-candidate/per-campaign/per-agent emergency stops.
   */
  public acquireLease(workerId: string, leaseDurationMs = 30_000, nowIso = new Date().toISOString()): DurableTask | null {
    if (this.isEmergencyStopped()) {
      return null;
    }

    this.refreshQueueState(nowIso);

    const activeLeases =
      this.db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'LEASED'`).first<number>('c') ?? 0;
    if (Number(activeLeases) >= this.maxConcurrentLeases) {
      return null;
    }

    const candidates = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'READY' AND next_eligible_at <= ?
         ORDER BY priority ASC, created_at ASC
         LIMIT 10`
      )
      .bind(nowIso)
      .all<any>().results;

    for (const candidate of candidates) {
      const parsedPayload = JSON.parse(candidate.payload_json || '{}');
      if (
        this.isTaskBlockedByEmergencyStop({
          userId: candidate.user_id,
          agentId: candidate.agent_id,
          payload: parsedPayload,
        })
      ) {
        continue;
      }

      const uniqueLeaseOwner = workerId.includes('::lease_')
        ? workerId
        : `${workerId}::lease_${crypto.randomBytes(6).toString('hex')}`;
      const leaseExpiresAt = new Date(new Date(nowIso).getTime() + leaseDurationMs).toISOString();

      const claimRes = this.db
        .prepare(
          `UPDATE tasks
           SET status = 'LEASED', lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND status = 'READY'`
        )
        .bind(uniqueLeaseOwner, leaseExpiresAt, nowIso, candidate.id)
        .run();

      if (claimRes.meta.changes !== 1) {
        continue;
      }

      const updated = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(candidate.id).first<any>();
      return updated ? this.mapRow(updated) : null;
    }

    return null;
  }

  public saveCheckpoint(taskId: string, workerId: string, checkpointData: Record<string, any>): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET checkpoint_json = ?, updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND (lease_owner = ? OR lease_owner LIKE ?)`
      )
      .bind(JSON.stringify(checkpointData), now, taskId, workerId, `${workerId}::lease_%`)
      .run();
  }

  public completeTask(taskId: string, workerId: string, result: Record<string, any>): DurableTask {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET status = 'COMPLETED', result_json = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND (lease_owner = ? OR lease_owner LIKE ?)`
      )
      .bind(JSON.stringify(result), now, taskId, workerId, `${workerId}::lease_%`)
      .run();
    this.refreshQueueState(now);
    return this.getTaskById(taskId)!;
  }

  public failTask(
    taskId: string,
    workerId: string,
    errorReason: string,
    recoverable = true,
    baseBackoffMs = 1000
  ): DurableTask {
    const task = this.getTaskById(taskId);
    if (!task) throw new Error(`TASK_NOT_FOUND: ${taskId}`);
    const now = new Date();

    if (recoverable && task.attemptCount < task.maxAttempts) {
      const delayMs = baseBackoffMs * Math.pow(2, task.attemptCount - 1);
      const nextEligibleAt = new Date(now.getTime() + delayMs).toISOString();
      this.db
        .prepare(
          `UPDATE tasks
           SET status = 'RETRY_WAIT', last_error = ?, next_eligible_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .bind(errorReason, nextEligibleAt, now.toISOString(), taskId)
        .run();
    } else {
      this.db
        .prepare(
          `UPDATE tasks
           SET status = 'DEAD_LETTER', last_error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .bind(errorReason, now.toISOString(), taskId)
        .run();

      const dltId = 'dlt_' + crypto.randomBytes(8).toString('hex');
      this.db
        .prepare(
          `INSERT OR REPLACE INTO dead_letter_tasks (id, task_id, user_id, failure_category, reason, snapshot_json, failed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          dltId,
          taskId,
          task.userId,
          errorReason.includes('TOOL_NOT_IMPLEMENTED')
            ? 'TOOL_NOT_IMPLEMENTED'
            : recoverable
            ? 'MAX_RETRIES_EXCEEDED'
            : 'NON_RECOVERABLE_ERROR',
          errorReason,
          JSON.stringify(task),
          now.toISOString()
        )
        .run();
    }
    this.refreshQueueState(now.toISOString());
    return this.getTaskById(taskId)!;
  }

  public escalateToHumanAttention(taskId: string, blockerReason: string): DurableTask {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET status = 'HUMAN_ATTENTION', last_error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(blockerReason, now, taskId)
      .run();
    return this.getTaskById(taskId)!;
  }

  public cancelTask(taskId: string, userId: string): DurableTask {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks
         SET status = 'CANCELLED', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(now, taskId, userId)
      .run();
    this.refreshQueueState(now);
    return this.getTaskById(taskId)!;
  }

  public getTaskById(taskId: string): DurableTask | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first<any>();
    return row ? this.mapRow(row) : null;
  }

  public listTasksForUser(userId: string): DurableTask[] {
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at ASC`).bind(userId).all<any>().results;
    return rows.map((r) => this.mapRow(r));
  }

  public listDeadLetterTasks(userId: string): any[] {
    return this.db.prepare(`SELECT * FROM dead_letter_tasks WHERE user_id = ? ORDER BY failed_at DESC`).bind(userId).all().results;
  }

  /**
   * V9.1 AUTONOMY RELIABILITY:
   * Safely replays a DEAD_LETTER task back to READY with an immutable audit record,
   * strictly enforcing tenant ownership and registered tool handler verification.
   */
  public replayDeadLetterTask(params: {
    taskId: string;
    userId: string;
    isAdmin?: boolean;
    registeredToolIds: string[];
  }): { task: DurableTask; replayId: string; replayedAt: string } {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(params.taskId).first<any>();
    if (!row) {
      throw new Error(`TASK_NOT_FOUND: ${params.taskId}`);
    }
    if (row.user_id !== params.userId && !params.isAdmin) {
      throw new Error('AUTHZ_FORBIDDEN_CROSS_USER: Cannot replay a cross-tenant dead-letter task.');
    }
    if (row.status !== 'DEAD_LETTER') {
      throw new Error(`INVALID_TASK_STATE: Task '${params.taskId}' is in status '${row.status}', expected 'DEAD_LETTER'.`);
    }
    if (!params.registeredToolIds.includes(row.tool_id)) {
      throw new Error(`REPLAY_BLOCKED_TOOL_NOT_IMPLEMENTED: Tool '${row.tool_id}' has no registered executable handler.`);
    }

    const now = new Date().toISOString();
    const replayId = 'dlr_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
    this.db.exec(`CREATE TABLE IF NOT EXISTS dead_letter_replay_audit (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      previous_error TEXT,
      replayed_at TEXT NOT NULL
    );`);

    this.db.batch([
      this.db
        .prepare(
          `UPDATE tasks
           SET status = 'READY',
               attempt_count = 0,
               last_error = NULL,
               lease_owner = NULL,
               lease_expires_at = NULL,
               next_eligible_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .bind(now, now, params.taskId),
      this.db.prepare(`DELETE FROM dead_letter_tasks WHERE task_id = ?`).bind(params.taskId),
      this.db
        .prepare(
          `INSERT INTO dead_letter_replay_audit (id, task_id, user_id, tool_id, previous_error, replayed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(replayId, params.taskId, row.user_id, row.tool_id, row.last_error ?? null, now),
    ]);

    return {
      task: this.getTaskById(params.taskId)!,
      replayId,
      replayedAt: now,
    };
  }

  private mapRow(row: any): DurableTask {
    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      agentId: row.agent_id,
      toolId: row.tool_id,
      idempotencyKey: row.idempotency_key,
      status: row.status as TaskStatus,
      priority: Number(row.priority),
      payload: JSON.parse(row.payload_json || '{}'),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      checkpoint: JSON.parse(row.checkpoint_json || '{}'),
      attemptCount: Number(row.attempt_count),
      maxAttempts: Number(row.max_attempts),
      nextEligibleAt: row.next_eligible_at,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      lastError: row.last_error,
    };
  }
}
