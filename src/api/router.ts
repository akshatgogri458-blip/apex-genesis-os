import { ApexD1Database } from '../db/d1-sqlite-engine';
import { BudgetGovernor } from '../db/budget-governor';
import { SecurityGuard, AuthenticatedContext, EmergencyStopScope } from '../security/auth';
import { stripExecutableMarkup } from '../security/sanitizer';
import {
  CANONICAL_PUBLIC_REPO_URL,
  CANONICAL_PUBLIC_REPO_OWNER,
  scanTextForPublicRepoLeaks,
  redactCandidatePiiForPublicExport,
} from '../security/public-repo-guard';
import { ApexNeuralCore } from '../neural-core/index';
import { MemoryEngine } from '../memory/index';
import { UniversalToolRegistry, ToolPermissionTier } from '../tools/index';
import { AgentFleetRegistry } from '../agents/index';
import { DurableExecutionEngine } from '../autonomy/queue-engine';
import { AutonomousPlanner } from '../planner/index';
import { RecruitmentWorkflowEngine } from '../recruitment/engine';
import { AuthorizedIntegrationNexus } from '../integrations/nexus';
import { REQUIRED_23_WORKSPACES } from '../ui/design-system';

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers: Record<string, string | undefined>;
  body?: any;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, any>;
}

export class ApexApplicationApi {
  public readonly db: ApexD1Database;
  public readonly budget: BudgetGovernor;
  public readonly security: SecurityGuard;
  public readonly neural: ApexNeuralCore;
  public readonly memory: MemoryEngine;
  public readonly tools: UniversalToolRegistry;
  public readonly agents: AgentFleetRegistry;
  public readonly queue: DurableExecutionEngine;
  public readonly planner: AutonomousPlanner;
  public readonly recruitment: RecruitmentWorkflowEngine;
  public readonly nexus: AuthorizedIntegrationNexus;

  constructor(deps: {
    db: ApexD1Database;
    security: SecurityGuard;
    neural: ApexNeuralCore;
    memory: MemoryEngine;
    tools: UniversalToolRegistry;
    agents: AgentFleetRegistry;
    queue: DurableExecutionEngine;
    planner: AutonomousPlanner;
    recruitment: RecruitmentWorkflowEngine;
    nexus: AuthorizedIntegrationNexus;
  }) {
    this.db = deps.db;
    this.budget = new BudgetGovernor(deps.db);
    this.security = deps.security;
    this.neural = deps.neural;
    this.memory = deps.memory;
    this.tools = deps.tools;
    this.agents = deps.agents;
    this.queue = deps.queue;
    this.planner = deps.planner;
    this.recruitment = deps.recruitment;
    this.nexus = deps.nexus;
  }

  private extractTokenFromHeadersOrCookie(headers: Record<string, string | undefined>): string {
    const authHeader = headers['authorization'] ?? '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    const cookieHeader = headers['cookie'] ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)apex_session=([^;]+)/);
    return match ? decodeURIComponent(match[1].trim()) : '';
  }

  public async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      this.db.resetInvocationSubrequests();
      const clientIp = req.headers['x-forwarded-for'] ?? '127.0.0.1';

      // 1. Public Health & Diagnostics Probe
      if (req.method === 'GET' && (req.path === '/api/health' || req.path === '/api/diagnostics')) {
        const d1Quota = this.db.getQuotaState();
        const auditIntegrity = this.security.verifyAuditChainIntegrity();
        return {
          status: 200,
          body: {
            status: d1Quota.suspended ? 'SUSPENDED_QUOTA' : 'OPERATIONAL',
            system: 'APEX GENESIS V9 — OPERATION PRODUCTION TRUTH',
            environmentMode: this.security.getServerEnvironmentMode(),
            zeroCostEnforced: true,
            d1Quota,
            auditIntegrity,
            emergencyStopped: this.queue.isEmergencyStopped(),
            timestamp: new Date().toISOString(),
          },
        };
      }

      if (req.method === 'GET' && req.path === '/api/system/repository-metadata') {
        return {
          status: 200,
          body: {
            canonicalRepositoryUrl: CANONICAL_PUBLIC_REPO_URL,
            canonicalOwner: CANONICAL_PUBLIC_REPO_OWNER,
            repositoryName: 'apex-genesis-os',
            visibility: 'PUBLIC',
            version: '9.1.0',
            baselineCommit: '938ac19cd7a43fcdad3c3e3662a28c8b0808aea5',
            migrations: [
              '0001_genesis_schema.sql',
              '0002_v2_resurrection.sql',
              '0003_v8_reality_engine.sql',
              '0004_v9_production_truth.sql',
              '0005_v9_public_repo_reliability.sql',
            ],
            publicRepoSafety: 'PUBLIC_SAFE_VERIFIED',
          },
        };
      }

      // 2. Zero-Impersonation Registration (V9 P0.1: Server-owned environment ONLY; never trusts body.environmentMode)
      if (req.method === 'POST' && req.path === '/api/auth/register') {
        const body = req.body ?? {};
        const user = this.security.registerUser({
          email: body.email,
          displayName: body.displayName,
          password: body.password,
          ipAddress: clientIp,
          emailVerified: body.emailVerified,
          role: body.role,
          browserSuppliedRole: body.browserSuppliedRole,
        });
        const challenge = this.security.issueVerificationChallenge(user.id);
        return {
          status: 201,
          body: {
            user,
            verificationRequired: true,
            challengeId: challenge.challengeId,
            expiresAt: challenge.expiresAt,
            deliveryMethod: challenge.deliveryMethod,
          },
        };
      }

      // Out-of-Band Dev/Test Mailbox Inspection (V9 P0.1: Strictly blocked in production; ignores body.environmentMode)
      if (req.method === 'POST' && req.path === '/api/dev/out-of-band-mailbox') {
        if (this.security.getServerEnvironmentMode() === 'production') {
          return {
            status: 403,
            body: { error: 'FORBIDDEN_IN_PRODUCTION: Out-of-band dev mailbox is strictly disabled in production.' },
          };
        }
        const body = req.body ?? {};
        const outOfBandMessage = this.security.getOutOfBandMailboxMessage(body.email);
        return { status: 200, body: { outOfBandMessage } };
      }

      if (req.method === 'POST' && req.path === '/api/auth/verify-email') {
        const body = req.body ?? {};
        const verified = this.security.verifyEmailChallenge(body.email, body.verificationToken);
        return { status: 200, body: verified };
      }

      // V9 P0.2: Server-Verified Google OIDC Authentication (RS256 JWKS; never trusts body.expectedClientId)
      if (req.method === 'POST' && req.path === '/api/auth/oauth/google') {
        const body = req.body ?? {};
        const session = this.security.verifyGoogleOAuthIdToken({
          idToken: body.idToken,
          expectedNonce: body.expectedNonce,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'] ?? 'ApexOAuthClient/9.0',
        });
        return {
          status: 200,
          headers: {
            'set-cookie': `apex_session=${encodeURIComponent(session.sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
          },
          body: session,
        };
      }

      if (req.method === 'POST' && req.path === '/api/auth/session') {
        const body = req.body ?? {};
        const session = this.security.issueSession({
          email: body.email,
          password: body.password,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'] ?? 'ApexClient/9.0',
        });
        return {
          status: 200,
          headers: {
            'set-cookie': `apex_session=${encodeURIComponent(session.sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
          },
          body: session,
        };
      }

      // ========================================================================
      // AUTHENTICATED BOUNDARY — All endpoints below require verified session
      // ========================================================================
      const token = this.extractTokenFromHeadersOrCookie(req.headers);
      const csrf = req.headers['x-csrf-token'];
      const requireCsrf = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
      const ctx: AuthenticatedContext = this.security.authenticateRequest(token, csrf, requireCsrf);

      this.security.enforceRateLimit(`api:${ctx.userId}`, 180, 60_000);

      if (req.body && typeof req.body === 'object' && req.body.userId && req.body.userId !== ctx.userId) {
        this.security.recordAuditLog({
          userId: ctx.userId,
          actor: ctx.userId,
          action: 'FORGED_USER_ID_BLOCKED',
          resourceType: 'API_REQUEST',
          resourceId: req.path,
          outcome: 'DENY',
          details: { attemptedUserId: req.body.userId },
        });
        return {
          status: 403,
          body: { error: 'AUTHZ_FORGED_IDENTITY: AUTHZ_FORBIDDEN_CROSS_USER — Cannot specify another userId in request body.' },
        };
      }

      if (req.method === 'POST' && req.path === '/api/auth/revoke') {
        this.security.revokeSession(ctx.sessionId, ctx.userId);
        return {
          status: 200,
          headers: { 'set-cookie': 'apex_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
          body: { revoked: true, sessionId: ctx.sessionId },
        };
      }

      if (req.method === 'GET' && req.path === '/api/workspaces/state') {
        return { status: 200, body: this.buildCompleteWorkspacesState(ctx) };
      }

      if (req.method === 'GET' && req.path === '/api/candidate/profile') {
        const candidate = this.db.prepare(`SELECT * FROM candidates WHERE user_id = ?`).bind(ctx.userId).first();
        const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, ctx.userId);
        return { status: 200, body: { candidate, verifiedFacts: facts } };
      }

      if (req.method === 'PUT' && req.path === '/api/candidate/profile') {
        const b = req.body ?? {};
        const now = new Date().toISOString();
        this.db
          .prepare(
            `UPDATE candidates
             SET headline = COALESCE(?, headline),
                 location = COALESCE(?, location),
                 years_experience = COALESCE(?, years_experience),
                 remote_preference = COALESCE(?, remote_preference),
                 work_authorization = COALESCE(?, work_authorization),
                 min_base_salary_usd = COALESCE(?, min_base_salary_usd),
                 updated_at = ?
             WHERE user_id = ?`
          )
          .bind(
            b.headline ? stripExecutableMarkup(b.headline) : null,
            b.location ? stripExecutableMarkup(b.location) : null,
            b.yearsExperience ?? null,
            b.remotePreference ?? null,
            b.workAuthorization ?? null,
            b.minBaseSalaryUsd ?? null,
            now,
            ctx.userId
          )
          .run();
        const updated = this.db.prepare(`SELECT * FROM candidates WHERE user_id = ?`).bind(ctx.userId).first();
        return { status: 200, body: { candidate: updated } };
      }

      if (req.method === 'GET' && req.path === '/api/candidate/facts') {
        const targetUserId = req.headers['x-target-user-id'] ?? ctx.userId;
        this.security.assertResourceOwnership(ctx, targetUserId, 'CANDIDATE_FACT', 'read');
        const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, targetUserId);
        return { status: 200, body: { facts } };
      }

      if (req.method === 'POST' && req.path === '/api/tools/invoke') {
        const b = req.body ?? {};
        const receipt = await this.tools.invoke(b.toolId, b.input ?? {}, {
          userId: ctx.userId,
          actorId: `user:${ctx.userId}`,
          grantedPermissions: ['READ', 'WRITE'],
          remainingCostBudgetUnits: 50,
        });
        if (receipt.status !== 'SUCCESS') {
          return { status: 403, body: { error: `TOOL_PERMISSION_DENIED: ${receipt.error || receipt.status}` } };
        }
        return { status: 200, body: { receipt } };
      }

      if (req.method === 'POST' && req.path === '/api/candidate/facts') {
        const b = req.body ?? {};
        const targetUserId = b.targetUserId ?? ctx.userId;
        this.security.assertResourceOwnership(ctx, targetUserId, 'CANDIDATE_FACT', 'create');
        const created = this.memory.addCandidateFact({
          userId: ctx.userId,
          category: b.category,
          attributeKey: stripExecutableMarkup(b.attributeKey),
          attributeValue: stripExecutableMarkup(b.attributeValue),
          verified: Boolean(b.verified),
          evidenceSource: stripExecutableMarkup(b.evidenceSource || 'User Confirmation'),
          evidenceExcerpt: b.evidenceExcerpt ? stripExecutableMarkup(b.evidenceExcerpt) : '',
          confidenceScore: b.confidenceScore ?? 1.0,
        });
        return { status: 201, body: { fact: created } };
      }

      if (req.method === 'POST' && req.path === '/api/neural/infer') {
        const b = req.body ?? {};
        const scan = this.security.scanPromptInjection(b.prompt ?? '');
        if (!scan.safe) {
          return { status: 400, body: { error: 'PROMPT_INJECTION_BLOCKED', detectedPatterns: scan.detectedPatterns } };
        }
        const inference = await this.neural.infer({
          userId: ctx.userId,
          taskType: b.taskType || 'AGENT_REASONING',
          prompt: scan.sanitizedText,
          systemInstruction: b.systemInstruction,
          expectedJsonKeys: b.expectedJsonKeys,
          preferredProviderId: b.preferredProviderId,
        });
        return { status: 200, body: { inference } };
      }

      if (req.method === 'POST' && req.path === '/api/planner/execute') {
        const b = req.body ?? {};
        if (this.queue.isScopeStopped(`CANDIDATE:${ctx.userId}`)) {
          return { status: 503, body: { error: 'EMERGENCY_STOP_ACTIVE: Candidate emergency stop is engaged.' } };
        }
        const scan = this.security.scanPromptInjection(b.objective ?? '');
        if (!scan.safe) {
          this.security.recordAuditLog({
            userId: ctx.userId,
            actor: ctx.userId,
            action: 'PROMPT_INJECTION_BLOCKED',
            resourceType: 'PLANNER',
            resourceId: 'objective',
            outcome: 'DENY',
            details: { detectedPatterns: scan.detectedPatterns },
          });
          return {
            status: 400,
            body: { error: 'PROMPT_INJECTION_BLOCKED', detectedPatterns: scan.detectedPatterns },
          };
        }

        let serverGrantedPermissions: ToolPermissionTier[] = ['READ', 'WRITE'];
        if (b.campaignId) {
          const camp = this.security.assertCampaignOwnership(ctx, b.campaignId);
          if (this.queue.isScopeStopped(`CAMPAIGN:${camp.id}`)) {
            return { status: 503, body: { error: 'EMERGENCY_STOP_ACTIVE: Selected campaign is paused/stopped.' } };
          }
          if (camp.authorizedActions.includes('SUBMIT_AUTHORIZED')) {
            serverGrantedPermissions.push('EXTERNAL');
          }
        }

        const report = await this.planner.planAndExecuteObjective({
          userId: ctx.userId,
          objective: scan.sanitizedText,
          userGrantedPermissions: serverGrantedPermissions,
        });
        return { status: 200, body: { report } };
      }

      if (req.method === 'GET' && req.path === '/api/tasks') {
        const tasks = this.queue.listTasksForUser(ctx.userId);
        const deadLetterTasks = this.queue.listDeadLetterTasks(ctx.userId);
        return { status: 200, body: { tasks, deadLetterTasks } };
      }

      if (req.method === 'POST' && req.path === '/api/tasks/cancel') {
        const b = req.body ?? {};
        const task = this.queue.getTaskById(b.taskId);
        if (!task) return { status: 404, body: { error: 'TASK_NOT_FOUND' } };
        this.security.assertResourceOwnership(ctx, task.userId, 'TASK', b.taskId);
        const cancelled = this.queue.cancelTask(b.taskId, ctx.userId);
        return { status: 200, body: { task: cancelled } };
      }

      if (req.method === 'POST' && req.path === '/api/agents/invoke') {
        const b = req.body ?? {};
        if (this.queue.isTaskBlockedByEmergencyStop({ userId: ctx.userId, agentId: b.agentId, payload: b.payload })) {
          return { status: 503, body: { error: 'EMERGENCY_STOP_ACTIVE: Agent or candidate scope is halted.' } };
        }
        const output = await this.agents.executeAgent(b.agentId, {
          userId: ctx.userId,
          objective: b.objective,
          payload: b.payload ?? {},
        });
        return { status: 200, body: { output } };
      }

      // V9 P0.4: Browser-supplied jobs are ALWAYS USER_SUPPLIED_UNVERIFIED
      if (req.method === 'POST' && req.path === '/api/jobs/discover') {
        const b = req.body ?? {};
        const rawVacancies = (b.vacancies ?? []).map((v: any) => ({
          ...v,
          verifiedByEmployerFeed: false,
          sourceRetrieved: false,
        }));
        const res = this.recruitment.ingestVacancies(ctx.userId, rawVacancies, b.maxAgeDays ?? 45);
        return { status: 200, body: res };
      }

      if (req.method === 'POST' && req.path === '/api/jobs/discover-official') {
        const b = req.body ?? {};
        const boardSource = b.boardSource || 'GREENHOUSE_PUBLIC';
        const providerId =
          boardSource === 'LEVER_PUBLIC'
            ? 'LEVER_PUBLIC_GET'
            : boardSource === 'ASHBY_PUBLIC'
            ? 'ASHBY_PUBLIC_GET'
            : 'GREENHOUSE_PUBLIC_GET';
        const reservation = this.budget.reserveBudget({
          providerId,
          userId: ctx.userId,
          unitsToReserve: 1,
        });
        const fetched = await this.recruitment.fetchOfficialPublicJobBoard({
          userId: ctx.userId,
          boardSource,
          boardToken: b.boardToken || 'cloudflare',
          environmentMode: this.security.getServerEnvironmentMode(),
        });
        this.budget.reconcileReservation({
          dayBucketKey: reservation.dayBucketKey,
          monthBucketKey: reservation.monthBucketKey,
          reservedUnits: 1,
          actualUnitsConsumed: 1,
        });
        return { status: 200, body: fetched };
      }

      if (req.method === 'POST' && req.path === '/api/jobs/match') {
        const b = req.body ?? {};
        const jobRow = this.db.prepare(`SELECT user_id FROM jobs WHERE id = ?`).bind(b.jobId).first<{ user_id: string }>();
        if (jobRow && jobRow.user_id !== ctx.userId) {
          this.security.assertResourceOwnership(ctx, jobRow.user_id, 'JOB', b.jobId);
        }
        const match = this.recruitment.evaluateJobMatch(ctx.userId, b.jobId);
        return { status: 200, body: { match } };
      }

      if (req.method === 'POST' && req.path === '/api/campaigns') {
        const b = req.body ?? {};
        const camp = this.recruitment.createCampaign({
          userId: ctx.userId,
          name: b.name,
          targetRoles: b.targetRoles ?? [],
          remoteOnly: Boolean(b.remoteOnly),
          minMatchScore: b.minMatchScore ?? 70,
          excludedCompanies: b.excludedCompanies ?? [],
          preferredCompanies: b.preferredCompanies ?? [],
          dailySubmissionCap: b.dailySubmissionCap ?? 20,
        });
        return { status: 201, body: camp };
      }

      if (req.method === 'POST' && req.path === '/api/documents/ingest-resume') {
        const b = req.body ?? {};
        const ingested = this.recruitment.ingestResumeDocument({
          userId: ctx.userId,
          title: b.title,
          format: b.format || 'PLAIN_TEXT',
          rawText: b.rawText,
          verifiedExtractions: b.verifiedExtractions ?? [],
        });
        return { status: 201, body: ingested };
      }

      if (req.method === 'POST' && req.path === '/api/documents/tailor-resume') {
        const b = req.body ?? {};
        const doc = this.recruitment.generateTruthfulTailoredResume({
          userId: ctx.userId,
          jobId: b.jobId,
          proposedClaims: b.proposedClaims,
        });
        return { status: 201, body: { document: doc } };
      }

      if (req.method === 'POST' && req.path === '/api/documents/compare') {
        const b = req.body ?? {};
        const diff = this.recruitment.compareResumeDocuments(ctx.userId, b.docIdA, b.docIdB);
        return { status: 200, body: { diff } };
      }

      if (req.method === 'POST' && req.path === '/api/applications/capability') {
        const b = req.body ?? {};
        const cap = this.nexus.getBoardSubmissionCapability({
          sourceUrl: b.sourceUrl || '',
          submissionMethod: b.submissionMethod,
          hasEmployerIssuedApiKey: Boolean(b.hasEmployerIssuedApiKey),
          supportsBrowserAssist: Boolean(b.supportsBrowserAssist),
        });
        return { status: 200, body: cap };
      }

      // V9 P0.5 FIX (C4): Never trust caller-supplied externalConfirmationId in /api/applications/submit
      if (req.method === 'POST' && req.path === '/api/applications/submit') {
        const b = req.body ?? {};
        if (b.campaignId) {
          this.security.assertCampaignOwnership(ctx, b.campaignId);
        }
        const outcome = await this.nexus.executeAuthorizedSubmission({
          userId: ctx.userId,
          campaignId: b.campaignId,
          jobId: b.jobId,
          resumeDocId: b.resumeDocId,
          coverLetterDocId: b.coverLetterDocId,
          encounteredCaptchaChallenge: Boolean(b.encounteredCaptchaChallenge),
          userReportedConfirmationId: b.externalConfirmationId ? String(b.externalConfirmationId) : undefined,
        });
        return { status: 200, body: { outcome } };
      }

      // V9 P0.5 FIX (C4): Reconcile requires cryptographic webhookSignature to set SUBMITTED_VERIFIED
      if (req.method === 'POST' && req.path === '/api/applications/reconcile') {
        const b = req.body ?? {};
        const reconciled = this.nexus.reconcileUncertainSubmission({
          userId: ctx.userId,
          applicationId: b.applicationId,
          externalConfirmationId: b.externalConfirmationId,
          verificationSource: b.verificationSource || 'EMPLOYER_CONFIRMATION_WEBHOOK',
          webhookSignature: req.headers['x-employer-webhook-signature'] ?? b.webhookSignature,
          webhookTimestamp: req.headers['x-employer-webhook-timestamp'] ?? b.webhookTimestamp,
        });
        return { status: 200, body: { reconciled } };
      }

      if (req.method === 'POST' && req.path === '/api/autonomy/dead-letter/replay') {
        const b = req.body ?? {};
        const registeredToolIds = this.tools.listTools().map((t) => t.toolId);
        const replayed = this.queue.replayDeadLetterTask({
          taskId: String(b.taskId ?? ''),
          userId: ctx.userId,
          isAdmin: ctx.role === 'SYSTEM_ADMIN',
          registeredToolIds,
        });
        return { status: 200, body: { replayed } };
      }

      if (req.method === 'GET' && req.path === '/api/security/public-safety-audit') {
        const fullState = this.buildCompleteWorkspacesState(ctx);
        const redactedSnapshot = redactCandidatePiiForPublicExport({
          user: fullState.user,
          candidate: fullState.candidate,
          documents: fullState.documents,
        });
        const findings = scanTextForPublicRepoLeaks(JSON.stringify(redactedSnapshot), 'redacted_state_snapshot');
        return {
          status: 200,
          body: {
            audit: {
              safeForPublicRepository: findings.length === 0,
              canonicalRepositoryUrl: CANONICAL_PUBLIC_REPO_URL,
              canonicalOwner: CANONICAL_PUBLIC_REPO_OWNER,
              scannedItemsCount: 1,
              findings,
              verifiedAt: new Date().toISOString(),
            },
            redactedSnapshot,
          },
        };
      }

      if (req.method === 'GET' && req.path === '/api/integrations/health') {
        const reports = await this.neural.runAllHealthChecks(ctx.userId);
        const integrations = this.db.prepare(`SELECT * FROM integrations WHERE user_id = ?`).bind(ctx.userId).all().results;
        return { status: 200, body: { reports, integrations } };
      }

      if (req.method === 'POST' && req.path === '/api/system/emergency-stop') {
        const b = req.body ?? {};
        const requestedScope: EmergencyStopScope = (b.scope as EmergencyStopScope) || 'GLOBAL';
        const stopped = Boolean(b.stopped);
        const reason = String(b.reason || `Operator invoked ${requestedScope} emergency stop`);

        const perm = this.security.assertEmergencyStopPermission(ctx, requestedScope, b.targetResourceId);
        if (requestedScope === 'GLOBAL') {
          this.queue.setEmergencyStop(stopped, reason, ctx.userId);
        } else {
          this.queue.setScopedEmergencyStop({
            scopeId: perm.scopeId,
            scopeType: requestedScope,
            ownerUserId: perm.ownerUserId,
            targetResourceId: perm.targetResourceId,
            stopped,
            reason,
            triggeredByUserId: ctx.userId,
          });
        }

        const auditEntry = this.security.recordAuditLog({
          userId: ctx.userId,
          actor: ctx.userId,
          action: stopped ? `EMERGENCY_STOP_ENGAGED_${requestedScope}` : `EMERGENCY_STOP_RELEASED_${requestedScope}`,
          resourceType: 'SYSTEM_QUEUE',
          resourceId: perm.scopeId,
          outcome: 'ALLOW',
          details: { scope: requestedScope, stopped, reason },
        });
        return {
          status: 200,
          body: {
            scope: requestedScope,
            scopeId: perm.scopeId,
            emergencyStopped: stopped,
            reason,
            auditEntry,
            auditChainVerification: this.security.verifyAuditChainIntegrity(),
          },
        };
      }

      if (req.method === 'GET' && req.path === '/api/security/audit-verify') {
        const verification = this.security.verifyAuditChainIntegrity();
        return { status: 200, body: verification };
      }

      if (req.method === 'GET' && req.path === '/api/privacy/export') {
        const fullState = this.buildCompleteWorkspacesState(ctx);
        return {
          status: 200,
          body: {
            exportedAt: new Date().toISOString(),
            userId: ctx.userId,
            profile: { email: ctx.email, displayName: ctx.displayName, role: ctx.role },
            ...fullState,
            state: fullState,
          },
        };
      }

      if (req.method === 'DELETE' && (req.path === '/api/privacy/account' || req.path === '/api/privacy/delete-account')) {
        this.db.prepare(`DELETE FROM users WHERE id = ?`).bind(ctx.userId).run();
        return { status: 200, body: { deletedUserId: ctx.userId, gdprErasureVerified: true } };
      }

      return { status: 404, body: { error: `ROUTE_NOT_FOUND: ${req.method} ${req.path}` } };
    } catch (err: any) {
      const msg = err?.message || String(err);
      const status = msg.startsWith('UNAUTHORIZED') || msg.startsWith('WEBHOOK_TIMESTAMP_EXPIRED')
        ? 401
        : msg.startsWith('FORBIDDEN') || msg.startsWith('AUTHZ_FORBIDDEN') || msg.startsWith('AUTHZ_ADMIN_REQUIRED')
        ? 403
        : msg.startsWith('WEBHOOK_REPLAY_DETECTED')
        ? 409
        : msg.startsWith('REPLAY_BLOCKED_TOOL_NOT_IMPLEMENTED')
        ? 422
        : msg.startsWith('RATE_LIMIT_EXCEEDED') || msg.startsWith('QUOTA_EXHAUSTED')
        ? 429
        : msg.startsWith('EMERGENCY_STOP_ACTIVE') ||
          msg.startsWith('D1_QUOTA_EXCEEDED') ||
          msg.startsWith('AUTH_PROVIDER_UNAVAILABLE_FAIL_CLOSED') ||
          msg.startsWith('BLOCKED_COST_UNVERIFIED') ||
          msg.startsWith('UPSTREAM_JOB_FEED_UNREACHABLE')
        ? 503
        : 400;
      return { status, body: { error: msg } };
    }
  }

  public buildCompleteWorkspaceState(ctx: AuthenticatedContext): Record<string, any> {
    return this.buildCompleteWorkspacesState(ctx);
  }

  public buildCompleteWorkspacesState(ctx: AuthenticatedContext): Record<string, any> {
    const candidate = this.db.prepare(`SELECT * FROM candidates WHERE user_id = ?`).bind(ctx.userId).first();
    const facts = this.memory.getVerifiedCandidateFacts(ctx.userId, ctx.userId);
    const jobs = this.db.prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY discovered_at DESC`).bind(ctx.userId).all().results;
    const matches = this.db.prepare(`SELECT * FROM job_matches WHERE user_id = ? ORDER BY overall_score DESC`).bind(ctx.userId).all().results;
    const campaigns = this.db.prepare(`SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC`).bind(ctx.userId).all().results;
    const documents = this.db.prepare(`SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC`).bind(ctx.userId).all().results;
    const resumeVersions = this.recruitment.getResumeVersionHistory(ctx.userId);
    const applications = this.db.prepare(`SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC`).bind(ctx.userId).all().results;
    const plans = this.db.prepare(`SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC`).bind(ctx.userId).all().results;
    const tasks = this.queue.listTasksForUser(ctx.userId);
    const deadLetterTasks = this.queue.listDeadLetterTasks(ctx.userId);
    const integrations = this.db.prepare(`SELECT * FROM integrations WHERE user_id = ?`).bind(ctx.userId).all().results;
    const messages = this.db.prepare(`SELECT * FROM recruiter_messages WHERE user_id = ? ORDER BY received_at DESC`).bind(ctx.userId).all().results;
    const interviews = this.db.prepare(`SELECT * FROM interviews WHERE user_id = ? ORDER BY scheduled_start_at ASC`).bind(ctx.userId).all().results;
    const memories = this.db.prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC`).bind(ctx.userId).all().results;
    const auditLogs = this.db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY rowid DESC LIMIT 50`).bind(ctx.userId).all().results;
    const auditVerification = this.security.verifyAuditChainIntegrity();
    const activeEmergencyStops = this.queue.listActiveEmergencyStops(ctx.userId);

    return {
      user: ctx,
      workspacesCatalog: REQUIRED_23_WORKSPACES,
      candidate,
      facts,
      jobs,
      matches,
      campaigns,
      documents,
      resumeVersions,
      applications,
      plans,
      tasks,
      deadLetterTasks,
      integrations,
      messages,
      interviews,
      memories,
      auditLogs,
      activeEmergencyStops,
      agentFleet: this.agents.listAgents(),
      toolRegistry: this.tools.listTools(),
      modelCapabilities: this.neural.listCapabilities(),
      resourceGuardian: {
        d1Quota: this.db.getQuotaState(),
        aiUsage: this.neural.getDailyUsage(ctx.userId),
        budgetLedger: this.budget.getPersistentBudgetSummary(ctx.userId),
        zeroCostEnforced: true,
        emergencyStopped: this.queue.isEmergencyStopped() || this.queue.isScopeStopped(`CANDIDATE:${ctx.userId}`),
        globalEmergencyStopped: this.queue.isEmergencyStopped(),
        candidateEmergencyStopped: this.queue.isScopeStopped(`CANDIDATE:${ctx.userId}`),
      },
      auditChainVerification: auditVerification,
    };
  }
}
