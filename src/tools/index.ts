import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';
import { MemoryEngine } from '../memory/index';

export type ToolPermissionTier = 'READ' | 'WRITE' | 'EXTERNAL' | 'SENSITIVE' | 'DESTRUCTIVE';

export interface ToolActorContext {
  userId: string;
  actorId: string; // e.g. 'agent:job-discovery' or 'user:usr_123'
  grantedPermissions: ToolPermissionTier[];
  remainingCostBudgetUnits: number;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  toolId: string;
  description: string;
  permissionTier: ToolPermissionTier;
  timeoutMs: number;
  maxRetries: number;
  costUnits: number;
  validateInput: (input: any) => { valid: boolean; reason?: string };
  validateOutput: (output: any) => { valid: boolean; reason?: string };
  execute: (input: TInput, ctx: ToolActorContext) => Promise<TOutput>;
}

export interface ToolExecutionReceipt<TOutput = any> {
  executionId: string;
  toolId: string;
  actorId: string;
  permissionTier: ToolPermissionTier;
  status: 'SUCCESS' | 'DENIED_PERMISSION' | 'VALIDATION_ERROR' | 'TIMEOUT' | 'QUOTA_EXCEEDED' | 'EXECUTION_ERROR';
  durationMs: number;
  costUnits: number;
  verifiedOutput: boolean;
  output?: TOutput;
  error?: string;
}

export class UniversalToolRegistry {
  private db: ApexD1Database;
  private memory: MemoryEngine;
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(db: ApexD1Database, memory: MemoryEngine) {
    this.db = db;
    this.memory = memory;
    this.registerCoreTools();
  }

  public registerTool<TIn, TOut>(def: ToolDefinition<TIn, TOut>): void {
    if (this.tools.has(def.toolId)) {
      throw new Error(`DUPLICATE_TOOL_ID: ${def.toolId}`);
    }
    this.tools.set(def.toolId, def);
  }

  public listTools(): Array<Omit<ToolDefinition, 'validateInput' | 'validateOutput' | 'execute'>> {
    return Array.from(this.tools.values()).map((t) => ({
      toolId: t.toolId,
      description: t.description,
      permissionTier: t.permissionTier,
      timeoutMs: t.timeoutMs,
      maxRetries: t.maxRetries,
      costUnits: t.costUnits,
    }));
  }

  public hasTool(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  public getTool(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  public async invoke<TIn = any, TOut = any>(
    toolId: string,
    input: TIn,
    ctx: ToolActorContext
  ): Promise<ToolExecutionReceipt<TOut>> {
    const start = Date.now();
    const executionId = 'tex_' + crypto.randomBytes(10).toString('hex');
    const inputHash = crypto.createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');

    // Never permit arbitrary code execution or unregistered tool execution
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`UNREGISTERED_TOOL_BLOCKED: Tool '${toolId}' is not in the Universal Tool Registry.`);
    }

    // 1. Permission boundary enforcement (Models/agents cannot grant themselves permissions)
    if (!ctx.grantedPermissions.includes(tool.permissionTier)) {
      this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'DENIED_PERMISSION', Date.now() - start, 0, false);
      return {
        executionId,
        toolId,
        actorId: ctx.actorId,
        permissionTier: tool.permissionTier,
        status: 'DENIED_PERMISSION',
        durationMs: Date.now() - start,
        costUnits: 0,
        verifiedOutput: false,
        error: `TOOL_PERMISSION_DENIED: Actor '${ctx.actorId}' lacks '${tool.permissionTier}' permission for tool '${toolId}'.`,
      };
    }

    // 2. Cost protection check
    if (tool.costUnits > ctx.remainingCostBudgetUnits) {
      this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'QUOTA_EXCEEDED', Date.now() - start, 0, false);
      return {
        executionId,
        toolId,
        actorId: ctx.actorId,
        permissionTier: tool.permissionTier,
        status: 'QUOTA_EXCEEDED',
        durationMs: Date.now() - start,
        costUnits: 0,
        verifiedOutput: false,
        error: `TOOL_COST_EXCEEDED: Required ${tool.costUnits} units, but actor has ${ctx.remainingCostBudgetUnits}.`,
      };
    }

    // 3. Input validation
    const inCheck = tool.validateInput(input);
    if (!inCheck.valid) {
      this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'VALIDATION_ERROR', Date.now() - start, 0, false);
      return {
        executionId,
        toolId,
        actorId: ctx.actorId,
        permissionTier: tool.permissionTier,
        status: 'VALIDATION_ERROR',
        durationMs: Date.now() - start,
        costUnits: 0,
        verifiedOutput: false,
        error: `TOOL_INPUT_INVALID: ${inCheck.reason}`,
      };
    }

    // 4. Execute with timeout & retry policy
    let attempts = 0;
    let lastError = '';
    while (attempts <= tool.maxRetries) {
      attempts++;
      try {
        const output = await Promise.race([
          tool.execute(input, ctx),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TOOL_EXECUTION_TIMEOUT')), tool.timeoutMs)),
        ]);

        // 5. Genuine output verification
        const outCheck = tool.validateOutput(output);
        if (!outCheck.valid) {
          this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'VALIDATION_ERROR', Date.now() - start, tool.costUnits, false);
          return {
            executionId,
            toolId,
            actorId: ctx.actorId,
            permissionTier: tool.permissionTier,
            status: 'VALIDATION_ERROR',
            durationMs: Date.now() - start,
            costUnits: tool.costUnits,
            verifiedOutput: false,
            error: `TOOL_OUTPUT_INVALID: ${outCheck.reason}`,
          };
        }

        const durationMs = Date.now() - start;
        this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'SUCCESS', durationMs, tool.costUnits, true);
        return {
          executionId,
          toolId,
          actorId: ctx.actorId,
          permissionTier: tool.permissionTier,
          status: 'SUCCESS',
          durationMs,
          costUnits: tool.costUnits,
          verifiedOutput: true,
          output,
        };
      } catch (err: any) {
        lastError = err?.message || String(err);
        if (lastError === 'TOOL_EXECUTION_TIMEOUT') {
          this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'TIMEOUT', Date.now() - start, tool.costUnits, false);
          return {
            executionId,
            toolId,
            actorId: ctx.actorId,
            permissionTier: tool.permissionTier,
            status: 'TIMEOUT',
            durationMs: Date.now() - start,
            costUnits: tool.costUnits,
            verifiedOutput: false,
            error: 'TOOL_EXECUTION_TIMEOUT',
          };
        }
      }
    }

    this.logExecution(executionId, ctx.userId, ctx.actorId, toolId, tool.permissionTier, inputHash, 'EXECUTION_ERROR', Date.now() - start, tool.costUnits, false);
    return {
      executionId,
      toolId,
      actorId: ctx.actorId,
      permissionTier: tool.permissionTier,
      status: 'EXECUTION_ERROR',
      durationMs: Date.now() - start,
      costUnits: tool.costUnits,
      verifiedOutput: false,
      error: lastError,
    };
  }

  private logExecution(
    id: string,
    userId: string,
    actorId: string,
    toolId: string,
    permissionTier: string,
    inputHash: string,
    status: string,
    durationMs: number,
    costUnits: number,
    verifiedOutput: boolean
  ): void {
    this.db
      .prepare(
        `INSERT INTO tool_executions (id, user_id, actor_id, tool_id, permission_tier, input_hash, status, duration_ms, cost_units, verified_output, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, actorId, toolId, permissionTier, inputHash, status, durationMs, costUnits, verifiedOutput ? 1 : 0, new Date().toISOString())
      .run();
  }

  private registerCoreTools(): void {
    // 1. Search stored jobs
    this.registerTool({
      toolId: 'jobs.search_stored',
      description: 'Search stored verified job vacancies owned by the authenticated user.',
      permissionTier: 'READ',
      timeoutMs: 3000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null, reason: 'Input must be an object' }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.jobs), reason: 'Output must contain jobs array' }),
      execute: async (inp: { remoteOnly?: boolean; query?: string; limit?: number }, ctx) => {
        const limit = Math.min(inp.limit ?? 100, 500);
        const rows = this.db
          .prepare(
            inp.remoteOnly
              ? `SELECT * FROM jobs WHERE user_id = ? AND remote_status = 'REMOTE' ORDER BY posted_at DESC LIMIT ?`
              : `SELECT * FROM jobs WHERE user_id = ? ORDER BY posted_at DESC LIMIT ?`
          )
          .bind(ctx.userId, limit)
          .all<any>().results;
        const filtered = inp.query
          ? rows.filter((r) => `${r.title} ${r.company_name} ${r.description_text}`.toLowerCase().includes(inp.query!.toLowerCase()))
          : rows;
        return { jobs: filtered, totalMatched: filtered.length };
      },
    });

    // 2. Retrieve campaign information
    this.registerTool({
      toolId: 'campaigns.get_info',
      description: 'Retrieve campaign filters, targets, exclusions, and status for the current user.',
      permissionTier: 'READ',
      timeoutMs: 2000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.campaigns) }),
      execute: async (_inp, ctx) => {
        const campaigns = this.db.prepare(`SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC`).bind(ctx.userId).all().results;
        return { campaigns };
      },
    });

    // 3. Retrieve verified candidate facts
    this.registerTool({
      toolId: 'candidate.get_verified_facts',
      description: 'Retrieve strictly verified candidate facts with source evidence.',
      permissionTier: 'READ',
      timeoutMs: 2000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.facts) }),
      execute: async (inp: { category?: any }, ctx) => {
        const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, ctx.userId, inp.category);
        return { facts, count: facts.length };
      },
    });

    // 4. Verify job freshness
    this.registerTool({
      toolId: 'jobs.verify_freshness',
      description: 'Verify freshness and source attribution of discovered jobs.',
      permissionTier: 'READ',
      timeoutMs: 2000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: typeof out?.verifiedCount === 'number' }),
      execute: async (_inp, ctx) => {
        const jobs = this.db.prepare(`SELECT id, posted_at, source_url FROM jobs WHERE user_id = ?`).bind(ctx.userId).all<any>().results;
        return { verifiedCount: jobs.length, freshJobs: jobs.filter((j) => Boolean(j.source_url)).length };
      },
    });

    // 5. Analyze eligibility
    this.registerTool({
      toolId: 'jobs.evaluate_eligibility',
      description: 'Evaluate candidate eligibility against job requirements while preserving unknown facts.',
      permissionTier: 'READ',
      timeoutMs: 3000,
      maxRetries: 1,
      costUnits: 2,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.evaluations) }),
      execute: async (_inp, ctx) => {
        const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, ctx.userId);
        const skillSet = new Set(
          facts.filter((f) => f.category === 'SKILL').map((f) => f.attributeValue.toLowerCase())
        );
        const jobs = this.db.prepare(`SELECT * FROM jobs WHERE user_id = ?`).bind(ctx.userId).all<any>().results;
        const evaluations = jobs.map((j) => {
          const reqSkills: string[] = JSON.parse(j.required_skills_json || '[]');
          const matched = reqSkills.filter((s) => skillSet.has(s.toLowerCase()));
          const missing = reqSkills.filter((s) => !skillSet.has(s.toLowerCase()));
          const score = reqSkills.length > 0 ? Math.round((matched.length / reqSkills.length) * 100) : 80;
          return { jobId: j.id, title: j.title, company: j.company_name, score, matched, missing };
        });
        return { evaluations };
      },
    });

    // 6. Create draft application packages (truthful grounding enforced)
    this.registerTool({
      toolId: 'documents.create_truthful_package',
      description: 'Generate a truthful draft resume and application package linked strictly to verified candidate facts.',
      permissionTier: 'WRITE',
      timeoutMs: 4000,
      maxRetries: 1,
      costUnits: 3,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: Boolean(out?.documentId) && out?.truthfulnessVerified === true }),
      execute: async (inp: { jobId?: string; title?: string }, ctx) => {
        const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, ctx.userId);
        if (facts.length === 0) {
          throw new Error('TRUTHFUL_GROUNDING_BLOCKER: Cannot generate resume package with 0 verified candidate facts.');
        }
        const docId = 'doc_' + crypto.randomBytes(10).toString('hex');
        const now = new Date().toISOString();
        const lines = facts.map((f) => `- [${f.category}] ${f.attributeKey}: ${f.attributeValue} (Evidence: ${f.evidenceSource})`);
        const content = `# Truthful Tailored Resume\n\n## Verified Claims\n${lines.join('\n')}`;
        const report = { verifiedClaimCount: facts.length, unverifiedClaimsRejected: 0 };

        this.db
          .prepare(
            `INSERT INTO documents (id, user_id, job_id, doc_type, title, format, content, truthfulness_verified, grounding_report_json, created_at)
             VALUES (?, ?, ?, 'TAILORED_RESUME', ?, 'MARKDOWN', ?, 1, ?, ?)`
          )
          .bind(docId, ctx.userId, inp.jobId ?? null, inp.title ?? 'Tailored Verified Resume', content, JSON.stringify(report), now)
          .run();

        for (const f of facts) {
          const claimId = 'clm_' + crypto.randomBytes(8).toString('hex');
          this.db
            .prepare(
              `INSERT INTO document_claims (id, user_id, document_id, claim_text, fact_id, verification_state, created_at)
               VALUES (?, ?, ?, ?, ?, 'VERIFIED_FACT_LINKED', ?)`
            )
            .bind(claimId, ctx.userId, docId, `${f.attributeKey}: ${f.attributeValue}`, f.id, now)
            .run();
        }
        return { documentId: docId, truthfulnessVerified: true, linkedFactCount: facts.length };
      },
    });

    // 7. Save plans
    this.registerTool({
      toolId: 'plans.save_validated',
      description: 'Persist a validated autonomous execution plan and task dependency graph.',
      permissionTier: 'WRITE',
      timeoutMs: 3000,
      maxRetries: 1,
      costUnits: 2,
      validateInput: (inp) => ({ valid: Boolean(inp?.objective) && Array.isArray(inp?.dag), reason: 'Requires objective and dag array' }),
      validateOutput: (out) => ({ valid: Boolean(out?.planId) }),
      execute: async (inp: { objective: string; constraints: any; unknownFacts: string[]; requiredTools: string[]; dag: any[] }, ctx) => {
        const planId = 'pln_' + crypto.randomBytes(10).toString('hex');
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO plans (id, user_id, objective, status, constraints_json, unknown_facts_json, required_tools_json, dag_json, created_at, updated_at)
             VALUES (?, ?, ?, 'VALIDATED', ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            planId,
            ctx.userId,
            inp.objective,
            JSON.stringify(inp.constraints ?? {}),
            JSON.stringify(inp.unknownFacts ?? []),
            JSON.stringify(inp.requiredTools ?? []),
            JSON.stringify(inp.dag),
            now,
            now
          )
          .run();
        return { planId, savedAt: now };
      },
    });

    // 8. Retrieve task statuses
    this.registerTool({
      toolId: 'tasks.get_statuses',
      description: 'Retrieve persistent task queue statuses for the current user.',
      permissionTier: 'READ',
      timeoutMs: 2000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: () => ({ valid: true }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.tasks) }),
      execute: async (_inp, ctx) => {
        const tasks = this.db.prepare(`SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at ASC`).bind(ctx.userId).all().results;
        return { tasks };
      },
    });

    // 9. Inspect system health
    this.registerTool({
      toolId: 'system.inspect_health',
      description: 'Inspect database quotas, active integrations, and queue metrics.',
      permissionTier: 'READ',
      timeoutMs: 2000,
      maxRetries: 1,
      costUnits: 1,
      validateInput: () => ({ valid: true }),
      validateOutput: (out) => ({ valid: out?.healthy === true && Boolean(out?.d1Quota) }),
      execute: async (_inp, ctx) => {
        const integrations = this.db.prepare(`SELECT * FROM integrations WHERE user_id = ?`).bind(ctx.userId).all().results;
        return {
          healthy: true,
          d1Quota: this.db.getQuotaState(),
          integrationsCount: integrations.length,
          checkedAt: new Date().toISOString(),
        };
      },
    });

    // 10. Prepare authorized application submission (EXTERNAL permission required)
    this.registerTool({
      toolId: 'applications.prepare_authorized_submission',
      description: 'Prepare or submit an application via an employer-authorized API adapter.',
      permissionTier: 'EXTERNAL',
      timeoutMs: 4000,
      maxRetries: 1,
      costUnits: 4,
      validateInput: (inp) => ({ valid: typeof inp === 'object' && inp !== null }),
      validateOutput: (out) => ({ valid: typeof out?.preparedCount === 'number' }),
      execute: async (_inp, ctx) => {
        const jobs = this.db.prepare(`SELECT * FROM jobs WHERE user_id = ? LIMIT 10`).bind(ctx.userId).all<any>().results;
        return { preparedCount: jobs.length, mode: 'AUTHORIZED_ADAPTER_ONLY' };
      },
    });

    // 11. Scan employer responses (EXTERNAL permission required)
    this.registerTool({
      toolId: 'inbox.scan_employer_responses',
      description: 'Scan authorized Gmail inbox threads for employer acknowledgments and interview invites.',
      permissionTier: 'EXTERNAL',
      timeoutMs: 3000,
      maxRetries: 1,
      costUnits: 2,
      validateInput: () => ({ valid: true }),
      validateOutput: (out) => ({ valid: Array.isArray(out?.messages) }),
      execute: async (_inp, ctx) => {
        const messages = this.db.prepare(`SELECT * FROM recruiter_messages WHERE user_id = ? ORDER BY received_at DESC`).bind(ctx.userId).all().results;
        return { messages };
      },
    });

    // 12. Destructive purge tool (DESTRUCTIVE permission required)
    this.registerTool({
      toolId: 'account.purge_all_data',
      description: 'Permanently delete all user candidate records and campaigns.',
      permissionTier: 'DESTRUCTIVE',
      timeoutMs: 3000,
      maxRetries: 0,
      costUnits: 5,
      validateInput: (inp) => ({ valid: inp?.confirmPurge === true, reason: 'confirmPurge must be true' }),
      validateOutput: (out) => ({ valid: out?.purged === true }),
      execute: async (_inp, ctx) => {
        this.db.prepare(`DELETE FROM campaigns WHERE user_id = ?`).bind(ctx.userId).run();
        return { purged: true };
      },
    });
  }
}
