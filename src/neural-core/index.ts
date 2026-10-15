import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';

export type ProviderConnectionStatus =
  | 'CONNECTED_VERIFIED'
  | 'UNVERIFIED_CONFIG'
  | 'DISCONNECTED'
  | 'QUOTA_EXHAUSTED'
  | 'NOT_IMPLEMENTED'
  | 'ERROR';

export type InferenceExecutionCategory =
  | 'REAL_INFERENCE'
  | 'MOCK_INFERENCE'
  | 'DETERMINISTIC_FALLBACK';

export type UsageAccountingMode =
  | 'PROVIDER_MEASURED'
  | 'UNREPORTED_BY_PROVIDER'
  | 'DETERMINISTIC_ZERO_LLM';

export type FailureCategory =
  | 'NONE'
  | 'AUTH_ERROR'
  | 'QUOTA_EXHAUSTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_UNREACHABLE'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'PROVIDER_INTERNAL_ERROR';

export interface ModelCapability {
  providerId: string;
  modelId: string;
  version: string;
  officialDocUrl?: string;
  isTrainedFoundationModel: boolean;
  executionCategory: InferenceExecutionCategory;
  supportsStructuredJson: boolean;
  supportsToolCalling: boolean;
  supportsEmbeddings: boolean;
  maxContextTokens: number;
  zeroCostEligible: boolean;
}

export interface ToolCallSpec {
  name: string;
  description: string;
  parametersSchema: Record<string, any>;
}

export interface InferenceRequest {
  userId: string;
  taskType: 'PLANNING' | 'JOB_MATCHING' | 'RESUME_TAILORING' | 'COVER_LETTER' | 'AGENT_REASONING' | 'HEALTH_PROBE';
  prompt: string;
  systemInstruction?: string;
  expectedJsonKeys?: string[];
  availableTools?: ToolCallSpec[];
  timeoutMs?: number;
  signal?: AbortSignal;
  preferredProviderId?: string;
  contextData?: Record<string, any>;
}

export interface InferenceResponse {
  providerId: string;
  modelId: string;
  modelVersion: string;
  executionCategory: InferenceExecutionCategory;
  usageAccountingMode: UsageAccountingMode;
  outputText: string;
  structuredData?: Record<string, any>;
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
  promptTokens: number | null;
  completionTokens: number | null;
  neuronsConsumed: number | null;
  latencyMs: number;
  fallbackUsed: boolean;
  failureCategory: FailureCategory;
}

export interface ProviderHealthReport {
  providerId: string;
  status: ProviderConnectionStatus;
  executionCategory: InferenceExecutionCategory;
  latencyMs: number;
  verifiedAt: string;
  detail: string;
  failureCategory: FailureCategory;
}

export interface ModelProvider {
  readonly providerId: string;
  readonly displayName: string;
  getCapabilities(): ModelCapability[];
  hasCredentialsConfigured(): boolean;
  runLiveHealthProbe(timeoutMs?: number): Promise<ProviderHealthReport>;
  generate(req: InferenceRequest): Promise<InferenceResponse>;
}

/**
 * Provider 1: Cloudflare Workers AI Provider
 * Supports `@cf/google/gemma-4-26b-a4b-it` (https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
 * and `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
 * Explicitly distinguishes REAL_INFERENCE (authenticated Cloudflare edge binding/REST) from MOCK_INFERENCE (test harness).
 */
export class CloudflareWorkersAIProvider implements ModelProvider {
  public readonly providerId = 'cloudflare-workers-ai';
  public readonly displayName = 'Cloudflare Workers AI (@cf/google/gemma-4-26b-a4b-it)';
  public readonly primaryModelId = '@cf/google/gemma-4-26b-a4b-it';
  private accountId?: string;
  private apiToken?: string;
  private aiBinding?: {
    run: (model: string, input: any) => Promise<any>;
    __isTestMock?: boolean;
  };
  private isMockAdapter: boolean;
  private currentStatus: ProviderConnectionStatus;

  constructor(opts: {
    accountId?: string;
    apiToken?: string;
    isMockAdapter?: boolean;
    aiBinding?: { run: (model: string, input: any) => Promise<any>; __isTestMock?: boolean };
  }) {
    this.accountId = opts.accountId;
    this.apiToken = opts.apiToken;
    this.aiBinding = opts.aiBinding;
    this.isMockAdapter = Boolean(opts.isMockAdapter || opts.aiBinding?.__isTestMock);
    this.currentStatus = this.hasCredentialsConfigured() ? 'UNVERIFIED_CONFIG' : 'DISCONNECTED';
  }

  public hasCredentialsConfigured(): boolean {
    return Boolean(this.aiBinding || (this.accountId && this.apiToken));
  }

  public getStatus(): ProviderConnectionStatus {
    return this.currentStatus;
  }

  public getExecutionCategory(): InferenceExecutionCategory {
    return this.isMockAdapter ? 'MOCK_INFERENCE' : 'REAL_INFERENCE';
  }

  public getCapabilities(): ModelCapability[] {
    return [
      {
        providerId: this.providerId,
        modelId: '@cf/google/gemma-4-26b-a4b-it',
        version: '4-26b-a4b-it',
        officialDocUrl: 'https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/',
        isTrainedFoundationModel: true,
        executionCategory: this.getExecutionCategory(),
        supportsStructuredJson: true,
        supportsToolCalling: true,
        supportsEmbeddings: false,
        maxContextTokens: 256000,
        zeroCostEligible: true,
      },
      {
        providerId: this.providerId,
        modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        version: '3.3-fp8-fast',
        isTrainedFoundationModel: true,
        executionCategory: this.getExecutionCategory(),
        supportsStructuredJson: true,
        supportsToolCalling: true,
        supportsEmbeddings: false,
        maxContextTokens: 32768,
        zeroCostEligible: true,
      },
      {
        providerId: this.providerId,
        modelId: '@cf/baai/bge-base-en-v1.5',
        version: '1.5',
        isTrainedFoundationModel: true,
        executionCategory: this.getExecutionCategory(),
        supportsStructuredJson: false,
        supportsToolCalling: false,
        supportsEmbeddings: true,
        maxContextTokens: 512,
        zeroCostEligible: true,
      },
    ];
  }

  public async runLiveHealthProbe(timeoutMs = 3000): Promise<ProviderHealthReport> {
    const start = Date.now();
    if (!this.hasCredentialsConfigured()) {
      this.currentStatus = 'DISCONNECTED';
      return {
        providerId: this.providerId,
        status: 'DISCONNECTED',
        executionCategory: this.getExecutionCategory(),
        latencyMs: 0,
        verifiedAt: new Date().toISOString(),
        detail: 'No Workers AI binding or CF_ACCOUNT_ID/CF_API_TOKEN configured.',
        failureCategory: 'AUTH_ERROR',
      };
    }

    try {
      if (this.aiBinding) {
        const res = await Promise.race([
          this.aiBinding.run(this.primaryModelId, {
            messages: [{ role: 'user', content: 'Respond with {"status":"OK"}' }],
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)),
        ]);
        if (res && (res.response || res.result || res.choices)) {
          this.currentStatus = 'CONNECTED_VERIFIED';
          return {
            providerId: this.providerId,
            status: 'CONNECTED_VERIFIED',
            executionCategory: this.getExecutionCategory(),
            latencyMs: Date.now() - start,
            verifiedAt: new Date().toISOString(),
            detail: `Workers AI binding verified on ${this.primaryModelId} (${this.getExecutionCategory()}).`,
            failureCategory: 'NONE',
          };
        }
      }
      this.currentStatus = 'ERROR';
      return {
        providerId: this.providerId,
        status: 'ERROR',
        executionCategory: this.getExecutionCategory(),
        latencyMs: Date.now() - start,
        verifiedAt: new Date().toISOString(),
        detail: 'Credentials present (UNVERIFIED_CONFIG), but live network endpoint is unreachable in current environment.',
        failureCategory: 'NETWORK_UNREACHABLE',
      };
    } catch (err: any) {
      const isTimeout = String(err?.message).includes('TIMEOUT');
      this.currentStatus = 'ERROR';
      return {
        providerId: this.providerId,
        status: 'ERROR',
        executionCategory: this.getExecutionCategory(),
        latencyMs: Date.now() - start,
        verifiedAt: new Date().toISOString(),
        detail: `Live health probe failed: ${err?.message}`,
        failureCategory: isTimeout ? 'TIMEOUT' : 'NETWORK_UNREACHABLE',
      };
    }
  }

  public async generate(req: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now();
    if (req.signal?.aborted) {
      throw new Error('INFERENCE_CANCELLED: Request was aborted before invocation.');
    }
    if (!this.aiBinding) {
      throw new Error('PROVIDER_UNREACHABLE: Cloudflare Workers AI binding is not active.');
    }

    const timeoutMs = req.timeoutMs ?? 5000;
    const abortPromise = new Promise<never>((_, rej) => {
      if (req.signal) {
        req.signal.addEventListener('abort', () => rej(new Error('INFERENCE_CANCELLED')), { once: true });
      }
    });

    const inputPayload: Record<string, any> = {
      messages: [
        ...(req.systemInstruction ? [{ role: 'system', content: req.systemInstruction }] : []),
        { role: 'user', content: req.prompt },
      ],
    };
    if (req.availableTools && req.availableTools.length > 0) {
      inputPayload.tools = req.availableTools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parametersSchema },
      }));
    }

    const raw = await Promise.race([
      this.aiBinding.run(this.primaryModelId, inputPayload),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('INFERENCE_TIMEOUT')), timeoutMs)),
      ...(req.signal ? [abortPromise] : []),
    ]);

    const outputText =
      typeof raw?.response === 'string'
        ? raw.response
        : typeof raw?.choices?.[0]?.message?.content === 'string'
        ? raw.choices[0].message.content
        : JSON.stringify(raw);

    // PHASE 4 TRUTHFULNESS RULE: Do not calculate fictional neuron usage from a character multiplier and label it provider-measured!
    const hasMeasuredUsage = Boolean(raw?.usage && (typeof raw.usage.prompt_tokens === 'number' || typeof raw.usage.neurons === 'number'));
    const promptTokens = typeof raw?.usage?.prompt_tokens === 'number' ? raw.usage.prompt_tokens : null;
    const completionTokens = typeof raw?.usage?.completion_tokens === 'number' ? raw.usage.completion_tokens : null;
    const neuronsConsumed = typeof raw?.usage?.neurons === 'number' ? raw.usage.neurons : null;

    return {
      providerId: this.providerId,
      modelId: this.primaryModelId,
      modelVersion: '4-26b-a4b-it',
      executionCategory: this.getExecutionCategory(),
      usageAccountingMode: hasMeasuredUsage ? 'PROVIDER_MEASURED' : 'UNREPORTED_BY_PROVIDER',
      outputText,
      toolCalls: raw?.tool_calls ?? raw?.choices?.[0]?.message?.tool_calls,
      promptTokens,
      completionTokens,
      neuronsConsumed,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      failureCategory: 'NONE',
    };
  }
}

/**
 * Provider 2: Google Gemini API Provider
 */
export class GoogleGeminiProvider implements ModelProvider {
  public readonly providerId = 'google-gemini';
  public readonly displayName = 'Google Gemini 2.5 Flash (Free Tier API)';
  private apiKey?: string;
  private customTransport?: (prompt: string, system?: string) => Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number }; isMock?: boolean } | string>;
  private isMockAdapter: boolean;
  private currentStatus: ProviderConnectionStatus;

  constructor(opts: {
    apiKey?: string;
    isMockAdapter?: boolean;
    customTransport?: (prompt: string, system?: string) => Promise<any>;
  }) {
    this.apiKey = opts.apiKey;
    this.customTransport = opts.customTransport;
    this.isMockAdapter = Boolean(opts.isMockAdapter);
    this.currentStatus = this.hasCredentialsConfigured() ? 'UNVERIFIED_CONFIG' : 'DISCONNECTED';
  }

  public hasCredentialsConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  public getStatus(): ProviderConnectionStatus {
    return this.currentStatus;
  }

  public getExecutionCategory(): InferenceExecutionCategory {
    return this.isMockAdapter ? 'MOCK_INFERENCE' : 'REAL_INFERENCE';
  }

  public getCapabilities(): ModelCapability[] {
    return [
      {
        providerId: this.providerId,
        modelId: 'gemini-2.5-flash',
        version: '2.5-flash-001',
        officialDocUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
        isTrainedFoundationModel: true,
        executionCategory: this.getExecutionCategory(),
        supportsStructuredJson: true,
        supportsToolCalling: true,
        supportsEmbeddings: false,
        maxContextTokens: 1_000_000,
        zeroCostEligible: true,
      },
    ];
  }

  public async runLiveHealthProbe(timeoutMs = 3000): Promise<ProviderHealthReport> {
    const start = Date.now();
    if (!this.hasCredentialsConfigured()) {
      this.currentStatus = 'DISCONNECTED';
      return {
        providerId: this.providerId,
        status: 'DISCONNECTED',
        executionCategory: this.getExecutionCategory(),
        latencyMs: 0,
        verifiedAt: new Date().toISOString(),
        detail: 'GEMINI_API_KEY not configured.',
        failureCategory: 'AUTH_ERROR',
      };
    }
    if (this.customTransport) {
      try {
        const res = await Promise.race([
          this.customTransport('{"probe":"ping"}', 'Respond with valid JSON'),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)),
        ]);
        if (res) {
          this.currentStatus = 'CONNECTED_VERIFIED';
          return {
            providerId: this.providerId,
            status: 'CONNECTED_VERIFIED',
            executionCategory: this.getExecutionCategory(),
            latencyMs: Date.now() - start,
            verifiedAt: new Date().toISOString(),
            detail: `Gemini API transport verified (${this.getExecutionCategory()}).`,
            failureCategory: 'NONE',
          };
        }
      } catch (e: any) {
        this.currentStatus = 'ERROR';
        return {
          providerId: this.providerId,
          status: 'ERROR',
          executionCategory: this.getExecutionCategory(),
          latencyMs: Date.now() - start,
          verifiedAt: new Date().toISOString(),
          detail: `Gemini probe error: ${e?.message}`,
          failureCategory: String(e?.message).includes('TIMEOUT') ? 'TIMEOUT' : 'PROVIDER_INTERNAL_ERROR',
        };
      }
    }
    this.currentStatus = 'UNVERIFIED_CONFIG';
    return {
      providerId: this.providerId,
      status: 'UNVERIFIED_CONFIG',
      executionCategory: this.getExecutionCategory(),
      latencyMs: Date.now() - start,
      verifiedAt: new Date().toISOString(),
      detail: 'API key present, but live external network endpoint was not reached; remains UNVERIFIED_CONFIG.',
      failureCategory: 'NETWORK_UNREACHABLE',
    };
  }

  public async generate(req: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now();
    if (req.signal?.aborted) {
      throw new Error('INFERENCE_CANCELLED');
    }
    if (!this.hasCredentialsConfigured() || !this.customTransport) {
      throw new Error('GEMINI_UNAVAILABLE: Provider not verified or transport offline.');
    }
    const timeoutMs = req.timeoutMs ?? 5000;
    const raw = await Promise.race([
      this.customTransport(req.prompt, req.systemInstruction),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('INFERENCE_TIMEOUT')), timeoutMs)),
    ]);
    const outputText = typeof raw === 'string' ? raw : raw.text;
    const hasMeasured = typeof raw === 'object' && raw !== null && Boolean(raw.usage);
    return {
      providerId: this.providerId,
      modelId: 'gemini-2.5-flash',
      modelVersion: '2.5-flash-001',
      executionCategory: this.getExecutionCategory(),
      usageAccountingMode: hasMeasured ? 'PROVIDER_MEASURED' : 'UNREPORTED_BY_PROVIDER',
      outputText,
      promptTokens: hasMeasured ? raw.usage.promptTokens : null,
      completionTokens: hasMeasured ? raw.usage.completionTokens : null,
      neuronsConsumed: null,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      failureCategory: 'NONE',
    };
  }
}

/**
 * Provider 3: APEX Deterministic Fallback Engine (`apex-local-deterministic-v1`)
 * PHASE 4 TRUTHFULNESS MANDATE:
 * - Explicitly labeled `DETERMINISTIC_FALLBACK` (NEVER `REAL_INFERENCE`).
 * - `isTrainedFoundationModel: false`
 * - `supportsEmbeddings: false`
 * - `maxContextTokens: 0` (does not advertise a fake neural context window)
 * - `usageAccountingMode: 'DETERMINISTIC_ZERO_LLM'`
 */
export class DeterministicStructuredEngine implements ModelProvider {
  public readonly providerId = 'apex-local-deterministic-v1';
  public readonly displayName = 'APEX Deterministic Rule-Based Fallback (Non-LLM Local Engine)';

  public hasCredentialsConfigured(): boolean {
    return true;
  }

  public getCapabilities(): ModelCapability[] {
    return [
      {
        providerId: this.providerId,
        modelId: 'apex-rule-fallback-v1',
        version: '2.0.0',
        isTrainedFoundationModel: false,
        executionCategory: 'DETERMINISTIC_FALLBACK',
        supportsStructuredJson: true,
        supportsToolCalling: false,
        supportsEmbeddings: false,
        maxContextTokens: 0,
        zeroCostEligible: true,
      },
    ];
  }

  public async runLiveHealthProbe(): Promise<ProviderHealthReport> {
    const start = Date.now();
    return {
      providerId: this.providerId,
      status: 'CONNECTED_VERIFIED',
      executionCategory: 'DETERMINISTIC_FALLBACK',
      latencyMs: Date.now() - start,
      verifiedAt: new Date().toISOString(),
      detail: 'DETERMINISTIC_FALLBACK: Local rule-based fallback engine active (Non-LLM; used only when external AI providers are offline or out of quota).',
      failureCategory: 'NONE',
    };
  }

  public async generate(req: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now();
    if (req.signal?.aborted) {
      throw new Error('INFERENCE_CANCELLED');
    }
    const ctx = req.contextData ?? {};
    let payload: Record<string, any>;

    if (req.taskType === 'PLANNING') {
      const obj = req.prompt;
      const numMatch = obj.match(/\b(\d+)\b/);
      const targetCount = numMatch ? Number(numMatch[1]) : 50;
      const remotePrioritized = /remote/i.test(obj);
      const wantsResumes = /resume/i.test(obj);
      const wantsApply = /application|apply|submit/i.test(obj);
      const wantsMonitor = /monitor|response|inbox|recruiter/i.test(obj);

      // Section C4 Fix: Distinct goal-variant DAG structures across 8 career objective archetypes
      let planArchetype = 'DISCOVER_AND_FULL_PIPELINE';
      let steps: Array<{ stepId: string; agentId: string; toolId: string; dependsOn: string[] }> = [];

      if (/^shortlist\b|rank\s+shortlist/i.test(obj) && !wantsResumes && !wantsApply) {
        planArchetype = 'SHORTLIST_ROLES';
        steps = [
          { stepId: 'step_shortlist_1_facts', agentId: 'candidate-intelligence', toolId: 'candidate.get_verified_facts', dependsOn: [] },
          { stepId: 'step_shortlist_2_search', agentId: 'job-discovery', toolId: 'jobs.search_stored', dependsOn: ['step_shortlist_1_facts'] },
          { stepId: 'step_shortlist_3_rank', agentId: 'job-matching', toolId: 'jobs.evaluate_eligibility', dependsOn: ['step_shortlist_1_facts', 'step_shortlist_2_search'] },
        ];
      } else if (/^(tailor|rewrite|compile)\s+(truthful\s+)?resume/i.test(obj) && !/discover|find/i.test(obj)) {
        planArchetype = 'TAILOR_TRUTHFUL_RESUME';
        steps = [
          { stepId: 'step_resume_1_facts', agentId: 'candidate-intelligence', toolId: 'candidate.get_verified_facts', dependsOn: [] },
          { stepId: 'step_resume_2_compile', agentId: 'resume-generation', toolId: 'documents.create_truthful_package', dependsOn: ['step_resume_1_facts'] },
        ];
      } else if (/draft\s+recruiter\s+follow[-\s]?up|recruiter\s+outreach/i.test(obj)) {
        planArchetype = 'DRAFT_RECRUITER_FOLLOWUP';
        steps = [
          { stepId: 'step_followup_1_facts', agentId: 'candidate-intelligence', toolId: 'candidate.get_verified_facts', dependsOn: [] },
          { stepId: 'step_followup_2_inbox', agentId: 'gmail-intelligence', toolId: 'inbox.scan_employer_responses', dependsOn: ['step_followup_1_facts'] },
        ];
      } else if (/prepare\s+interview|interview\s+prep|star\s+stor/i.test(obj)) {
        planArchetype = 'PREPARE_INTERVIEW';
        steps = [
          { stepId: 'step_prep_1_facts', agentId: 'candidate-intelligence', toolId: 'candidate.get_verified_facts', dependsOn: [] },
          { stepId: 'step_prep_2_company', agentId: 'employer-research', toolId: 'jobs.verify_freshness', dependsOn: ['step_prep_1_facts'] },
          { stepId: 'step_prep_3_questions', agentId: 'interview-preparation', toolId: 'jobs.evaluate_eligibility', dependsOn: ['step_prep_2_company'] },
        ];
      } else if (/schedule\s+interview|propose\s+interview\s+slot|calendar\s+conflict/i.test(obj)) {
        planArchetype = 'SCHEDULE_INTERVIEW';
        steps = [
          { stepId: 'step_sched_1_inbox', agentId: 'gmail-intelligence', toolId: 'inbox.scan_employer_responses', dependsOn: [] },
          { stepId: 'step_sched_2_profile', agentId: 'calendar-scheduling', toolId: 'candidate.get_verified_facts', dependsOn: ['step_sched_1_inbox'] },
        ];
      } else if (/reconcile.*application|uncertain\s+submission|verify\s+receipt/i.test(obj)) {
        planArchetype = 'RECONCILE_UNCERTAIN_APPLICATION';
        steps = [
          { stepId: 'step_recon_1_inbox', agentId: 'gmail-intelligence', toolId: 'inbox.scan_employer_responses', dependsOn: [] },
          { stepId: 'step_recon_2_status', agentId: 'application-Preparation', toolId: 'applications.prepare_authorized_submission', dependsOn: ['step_recon_1_inbox'] },
        ];
      } else if (/research\s+company|employer\s+dossier|company\s+intelligence/i.test(obj)) {
        planArchetype = 'RESEARCH_COMPANY';
        steps = [
          { stepId: 'step_research_1_jobs', agentId: 'job-discovery', toolId: 'jobs.search_stored', dependsOn: [] },
          { stepId: 'step_research_2_dossier', agentId: 'employer-research', toolId: 'jobs.verify_freshness', dependsOn: ['step_research_1_jobs'] },
        ];
      } else {
        planArchetype = 'DISCOVER_ROLES_AND_EXECUTE';
        steps = [
          { stepId: 'step_1_facts', agentId: 'candidate-intelligence', toolId: 'candidate.get_verified_facts', dependsOn: [] },
          { stepId: 'step_2_discover', agentId: 'job-discovery', toolId: 'jobs.search_stored', dependsOn: ['step_1_facts'] },
          { stepId: 'step_3_verify', agentId: 'job-verification', toolId: 'jobs.verify_freshness', dependsOn: ['step_2_discover'] },
          { stepId: 'step_4_match', agentId: 'job-matching', toolId: 'jobs.evaluate_eligibility', dependsOn: ['step_1_facts', 'step_3_verify'] },
          ...(wantsResumes
            ? [{ stepId: 'step_5_tailor', agentId: 'resume-generation', toolId: 'documents.create_truthful_package', dependsOn: ['step_4_match'] }]
            : []),
          ...(wantsApply
            ? [{ stepId: 'step_6_submit', agentId: 'authorized-application-execution', toolId: 'applications.prepare_authorized_submission', dependsOn: wantsResumes ? ['step_5_tailor'] : ['step_4_match'] }]
            : []),
          ...(wantsMonitor
            ? [{ stepId: 'step_7_monitor', agentId: 'gmail-intelligence', toolId: 'inbox.scan_employer_responses', dependsOn: ['step_4_match'] }]
            : []),
        ];
      }

      payload = {
        interpretedObjective: obj,
        planArchetype,
        executionCategory: 'DETERMINISTIC_FALLBACK',
        targetPositionCount: targetCount,
        constraints: {
          remotePrioritized,
          truthfulGroundingOnly: true,
          authorizedMethodsOnly: true,
          zeroCostBudget: true,
        },
        steps,
      };
    } else if (req.taskType === 'RESUME_TAILORING') {
      const verifiedFacts: Array<{ id: string; category: string; attribute_key: string; attribute_value: string }> = ctx.verifiedFacts ?? [];
      const jobTitle = ctx.jobTitle ?? 'Software Engineer';
      const companyName = ctx.companyName ?? 'Target Employer';
      const relevantClaims = verifiedFacts.map((f) => ({
        factId: f.id,
        category: f.category,
        claimText: `${f.attribute_key}: ${f.attribute_value}`,
      }));
      payload = {
        executionCategory: 'DETERMINISTIC_FALLBACK',
        tailoredSummary: `Verified candidate profile tailored for ${jobTitle} at ${companyName} using ${relevantClaims.length} evidence-backed claims.`,
        claims: relevantClaims,
        unverifiedClaimsAdded: 0,
      };
    } else {
      payload = {
        taskType: req.taskType,
        executionCategory: 'DETERMINISTIC_FALLBACK',
        status: 'COMPLETED',
        summary: `Executed ${req.taskType} via local deterministic rule fallback (Non-LLM).`,
        contextKeys: Object.keys(ctx),
      };
    }

    const outputText = JSON.stringify(payload);
    return {
      providerId: this.providerId,
      modelId: 'apex-rule-fallback-v1',
      modelVersion: '2.0.0',
      executionCategory: 'DETERMINISTIC_FALLBACK',
      usageAccountingMode: 'DETERMINISTIC_ZERO_LLM',
      outputText,
      structuredData: payload,
      promptTokens: null,
      completionTokens: null,
      neuronsConsumed: null,
      latencyMs: Date.now() - start,
      fallbackUsed: false,
      failureCategory: 'NONE',
    };
  }
}

export class ApexNeuralCore {
  private db: ApexD1Database;
  private providers: Map<string, ModelProvider> = new Map();
  private providerOrder: string[] = [];
  private maxDailyNeurons: number;
  private maxDailyGeminiRequests: number;

  constructor(
    db: ApexD1Database,
    opts?: { maxDailyNeurons?: number; maxDailyGeminiRequests?: number }
  ) {
    this.db = db;
    this.maxDailyNeurons = opts?.maxDailyNeurons ?? 9000;
    this.maxDailyGeminiRequests = opts?.maxDailyGeminiRequests ?? 1400;
  }

  public registerProvider(provider: ModelProvider, priorityOrder = false): void {
    this.providers.set(provider.providerId, provider);
    if (priorityOrder) {
      this.providerOrder.unshift(provider.providerId);
    } else if (!this.providerOrder.includes(provider.providerId)) {
      this.providerOrder.push(provider.providerId);
    }
  }

  public listCapabilities(): ModelCapability[] {
    const out: ModelCapability[] = [];
    for (const p of this.providers.values()) {
      out.push(...p.getCapabilities());
    }
    return out;
  }

  public async runAllHealthChecks(userId: string): Promise<ProviderHealthReport[]> {
    const reports: ProviderHealthReport[] = [];
    for (const p of this.providers.values()) {
      const report = await p.runLiveHealthProbe();
      reports.push(report);

      const id = 'int_' + crypto.createHash('md5').update(`${userId}:${p.providerId}`).digest('hex').slice(0, 16);
      this.db
        .prepare(
          `INSERT INTO integrations (id, user_id, provider_key, display_name, category, connection_status, scopes_json, last_health_check_at, health_detail)
           VALUES (?, ?, ?, ?, 'AI_PROVIDER', ?, ?, ?, ?)
           ON CONFLICT(user_id, provider_key) DO UPDATE SET
             connection_status = excluded.connection_status,
             scopes_json = excluded.scopes_json,
             last_health_check_at = excluded.last_health_check_at,
             health_detail = excluded.health_detail`
        )
        .bind(
          id,
          userId,
          p.providerId,
          p.displayName,
          report.status,
          JSON.stringify([report.executionCategory]),
          report.verifiedAt,
          report.detail
        )
        .run();
    }
    return reports;
  }

  public getDailyUsage(_userId?: string): {
    providerMeasuredNeurons: number;
    geminiRequests: number;
    providerMeasuredTokens: number;
    remainingNeurons: number;
  } {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(neurons_consumed), 0) as total_neurons,
           COALESCE(SUM(CASE WHEN provider_id = 'google-gemini' THEN 1 ELSE 0 END), 0) as gemini_reqs,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens
         FROM model_usage_ledger
         WHERE recorded_at LIKE ?`
      )
      .bind(`${todayPrefix}%`)
      .first<any>();

    const providerMeasuredNeurons = Number(row?.total_neurons ?? 0);
    const geminiRequests = Number(row?.gemini_reqs ?? 0);
    const providerMeasuredTokens = Number(row?.total_tokens ?? 0);
    return {
      providerMeasuredNeurons,
      geminiRequests,
      providerMeasuredTokens,
      remainingNeurons: Math.max(0, this.maxDailyNeurons - providerMeasuredNeurons),
    };
  }

  public validateStructuredResponse(rawText: string, expectedKeys?: string[]): { valid: boolean; parsed?: Record<string, any>; error?: string } {
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { valid: false, error: 'Response is not a JSON object.' };
      }
      if (expectedKeys && expectedKeys.length > 0) {
        for (const k of expectedKeys) {
          if (!(k in parsed)) {
            return { valid: false, error: `Missing required structured key: ${k}` };
          }
        }
      }
      return { valid: true, parsed };
    } catch (e: any) {
      return { valid: false, error: `Invalid JSON: ${e?.message}` };
    }
  }

  public async infer(req: InferenceRequest): Promise<InferenceResponse> {
    if (req.signal?.aborted) {
      throw new Error('INFERENCE_CANCELLED');
    }
    const usage = this.getDailyUsage(req.userId);
    const candidateOrder = req.preferredProviderId
      ? [req.preferredProviderId, ...this.providerOrder.filter((id) => id !== req.preferredProviderId)]
      : [...this.providerOrder];

    let attemptIndex = 0;
    let lastError = 'No providers registered';

    for (const providerId of candidateOrder) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      if (providerId === 'cloudflare-workers-ai' && usage.providerMeasuredNeurons >= this.maxDailyNeurons) {
        lastError = 'CLOUDFLARE_NEURON_QUOTA_EXHAUSTED';
        continue;
      }
      if (providerId === 'google-gemini' && usage.geminiRequests >= this.maxDailyGeminiRequests) {
        lastError = 'GEMINI_DAILY_QUOTA_EXHAUSTED';
        continue;
      }

      try {
        const res = await provider.generate(req);
        if (req.expectedJsonKeys && req.expectedJsonKeys.length > 0) {
          const check = this.validateStructuredResponse(res.outputText, req.expectedJsonKeys);
          if (!check.valid) {
            lastError = `SCHEMA_VALIDATION_FAILED: ${check.error}`;
            this.recordLedger(
              req.userId,
              providerId,
              res.modelId,
              res.promptTokens ?? 0,
              res.completionTokens ?? 0,
              res.neuronsConsumed ?? 0,
              res.latencyMs,
              `SCHEMA_ERROR:${res.executionCategory}`
            );
            attemptIndex++;
            continue;
          }
          res.structuredData = check.parsed;
        }

        res.fallbackUsed = attemptIndex > 0;
        this.recordLedger(
          req.userId,
          providerId,
          res.modelId,
          res.promptTokens ?? 0,
          res.completionTokens ?? 0,
          res.neuronsConsumed ?? 0,
          res.latencyMs,
          `SUCCESS:${res.executionCategory}:${res.usageAccountingMode}`
        );
        return res;
      } catch (err: any) {
        lastError = err?.message || String(err);
        if (lastError.includes('INFERENCE_CANCELLED')) {
          throw new Error('INFERENCE_CANCELLED');
        }
        attemptIndex++;
      }
    }

    throw new Error(`NEURAL_CORE_ROUTING_EXHAUSTED: All eligible providers failed. Last error: ${lastError}`);
  }

  private recordLedger(
    userId: string,
    providerId: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    neuronsConsumed: number,
    latencyMs: number,
    status: string
  ): void {
    const id = 'mul_' + crypto.randomBytes(10).toString('hex');
    this.db
      .prepare(
        `INSERT INTO model_usage_ledger (id, user_id, provider_id, model_id, prompt_tokens, completion_tokens, neurons_consumed, latency_ms, status, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, providerId, modelId, promptTokens, completionTokens, neuronsConsumed, latencyMs, status, new Date().toISOString())
      .run();
  }
}
