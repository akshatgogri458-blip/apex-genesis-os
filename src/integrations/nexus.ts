import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';
import { DurableExecutionEngine } from '../autonomy/queue-engine';
import { MemoryEngine } from '../memory/index';

export type ApplicationEvidenceLevel =
  | 'PREPARED'
  | 'AWAITING_APPROVAL'
  | 'SUBMITTING'
  | 'SUBMISSION_UNCERTAIN'
  | 'USER_REPORTED'
  | 'PROVIDER_CONFIRMED'
  | 'MANUAL_ONLY'
  | 'BLOCKED';

export interface SubmissionAttemptRequest {
  userId: string;
  campaignId?: string;
  jobId: string;
  resumeDocId: string;
  coverLetterDocId?: string;
  encounteredCaptchaChallenge?: boolean;
  userReportedConfirmationId?: string;
  authorizedAdapterCallback?: (payload: {
    jobId: string;
    externalId: string;
    resumeContent: string;
  }) => Promise<{ confirmed: boolean; externalConfirmationId?: string; receipt?: Record<string, any> }>;
}

export interface SubmissionAttemptOutcome {
  applicationId: string;
  status:
    | 'DRAFT_READY'
    | 'AWAITING_HUMAN_APPROVAL'
    | 'BLOCKED_CAPTCHA'
    | 'SUBMITTED_VERIFIED'
    | 'SUBMITTED_UNCONFIRMED'
    | 'USER_REPORTED'
    | 'PROVIDER_CONFIRMED';
  evidenceLevel: ApplicationEvidenceLevel;
  verified: boolean;
  externalConfirmationId: string | null;
  humanAttentionTaskId?: string;
  detail: string;
}

export class AuthorizedIntegrationNexus {
  private db: ApexD1Database;
  private queue: DurableExecutionEngine;
  private memory: MemoryEngine;
  private webhookSigningSecret: string;

  constructor(
    db: ApexD1Database,
    queue: DurableExecutionEngine,
    memory: MemoryEngine,
    webhookSigningSecret?: string
  ) {
    this.db = db;
    this.queue = queue;
    this.memory = memory;
    this.webhookSigningSecret =
      webhookSigningSecret ||
      process.env.EMPLOYER_WEBHOOK_SECRET ||
      'apex_v9_employer_provider_webhook_hmac_secret_32bytes!!';
  }

  /**
   * Generates a cryptographic HMAC-SHA256 provider webhook signature for an external confirmation receipt.
   * Only signed provider webhooks or server-executed authorized adapter responses can transition an
   * application to `SUBMITTED_VERIFIED` / `PROVIDER_CONFIRMED`.
   */
  public signEmployerWebhookReceipt(params: {
    applicationId: string;
    externalConfirmationId: string;
    verificationSource: string;
  }): string {
    const canonical = `${params.applicationId}|${params.externalConfirmationId}|${params.verificationSource}`;
    return crypto.createHmac('sha256', this.webhookSigningSecret).update(canonical).digest('hex');
  }

  public verifyEmployerWebhookSignature(params: {
    applicationId: string;
    externalConfirmationId: string;
    verificationSource: string;
    signatureHex?: string;
  }): boolean {
    if (!params.signatureHex || typeof params.signatureHex !== 'string') return false;
    const expected = this.signEmployerWebhookReceipt({
      applicationId: params.applicationId,
      externalConfirmationId: params.externalConfirmationId,
      verificationSource: params.verificationSource,
    });
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(params.signatureHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  public getBoardSubmissionCapability(params: {
    sourceUrl: string;
    submissionMethod?: string;
    hasEmployerIssuedApiKey?: boolean;
    supportsBrowserAssist?: boolean;
  }): {
    capabilityState:
      | 'READ_ONLY'
      | 'PREPARE_AND_HANDOFF'
      | 'USER_APPROVED_BROWSER_ASSIST'
      | 'EMPLOYER_API_AUTHORIZED'
      | 'MANUAL_ONLY'
      | 'BLOCKED'
      | 'UNSUPPORTED';
    requiresEmployerApiKey: boolean;
    supportsPublicRead: boolean;
    explanation: string;
  } {
    if (params.hasEmployerIssuedApiKey) {
      return {
        capabilityState: 'EMPLOYER_API_AUTHORIZED',
        requiresEmployerApiKey: true,
        supportsPublicRead: true,
        explanation: 'Employer-issued API key verified; direct authorized ATS submission is permitted.',
      };
    }
    if (params.supportsBrowserAssist) {
      return {
        capabilityState: 'USER_APPROVED_BROWSER_ASSIST',
        requiresEmployerApiKey: false,
        supportsPublicRead: true,
        explanation: 'Public job listing; user-approved browser-assisted field prefill and human submission handoff enabled.',
      };
    }
    if (/greenhouse\.io|lever\.co|ashbyhq\.com/i.test(params.sourceUrl || '')) {
      return {
        capabilityState: 'PREPARE_AND_HANDOFF',
        requiresEmployerApiKey: true,
        supportsPublicRead: true,
        explanation:
          'Publicly readable job board (GET); POST submission requires employer API key. Prepared grounded application package for candidate handoff.',
      };
    }
    return {
      capabilityState: 'MANUAL_ONLY',
      requiresEmployerApiKey: true,
      supportsPublicRead: false,
      explanation: 'External portal requires direct candidate submission; prepared grounded resume and deep-link handoff.',
    };
  }

  public async verifyIntegrationConnection(params: {
    userId: string;
    providerKey: 'google-gmail' | 'google-calendar' | 'greenhouse-api' | 'lever-api';
    displayName: string;
    category: 'GOOGLE_WORKSPACE' | 'RECRUITMENT_API';
    scopes: string[];
    liveVerifier?: () => Promise<{ ok: boolean; detail: string }>;
  }): Promise<{ providerKey: string; status: string; detail: string }> {
    let status = 'UNVERIFIED_CONFIG';
    let detail = 'Configuration saved; awaiting live OAuth/API verification probe.';

    if (params.liveVerifier) {
      try {
        const res = await params.liveVerifier();
        status = res.ok ? 'CONNECTED_VERIFIED' : 'ERROR';
        detail = res.detail;
      } catch (e: any) {
        status = 'ERROR';
        detail = `Verification failed: ${e?.message}`;
      }
    }

    const id = 'int_' + crypto.createHash('md5').update(`${params.userId}:${params.providerKey}`).digest('hex').slice(0, 16);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO integrations (id, user_id, provider_key, display_name, category, connection_status, scopes_json, last_health_check_at, health_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider_key) DO UPDATE SET
           connection_status = excluded.connection_status,
           scopes_json = excluded.scopes_json,
           last_health_check_at = excluded.last_health_check_at,
           health_detail = excluded.health_detail`
      )
      .bind(
        id,
        params.userId,
        params.providerKey,
        params.displayName,
        params.category,
        status,
        JSON.stringify(params.scopes),
        now,
        detail
      )
      .run();

    return { providerKey: params.providerKey, status, detail };
  }

  /**
   * V9 P0.5 FIX (C4):
   * - Never bypasses CAPTCHA: halts and escalates to HUMAN_ATTENTION (`BLOCKED_CAPTCHA` / `BLOCKED`).
   * - Never accepts caller-supplied `externalConfirmationId` as proof of submission (`USER_REPORTED`, `verified: false`).
   * - Only sets `SUBMITTED_VERIFIED` (`evidenceLevel: 'PROVIDER_CONFIRMED'`) when an authorized server-side
   *   employer adapter callback returns a real provider confirmation receipt.
   */
  public async executeAuthorizedSubmission(req: SubmissionAttemptRequest): Promise<SubmissionAttemptOutcome> {
    if (this.queue.isEmergencyStopped()) {
      throw new Error('EMERGENCY_STOP_ACTIVE: External application submissions are halted by global emergency stop.');
    }
    const job = this.db.prepare(`SELECT * FROM jobs WHERE id = ? AND user_id = ?`).bind(req.jobId, req.userId).first<any>();
    if (!job) throw new Error(`JOB_NOT_FOUND: ${req.jobId}`);

    const resumeDoc = this.db
      .prepare(`SELECT * FROM documents WHERE id = ? AND user_id = ?`)
      .bind(req.resumeDocId, req.userId)
      .first<any>();
    if (!resumeDoc || Number(resumeDoc.truthfulness_verified) !== 1) {
      throw new Error('SUBMISSION_GROUNDING_REJECTED: Cannot submit an unverified resume document.');
    }

    if (req.campaignId) {
      const camp = this.db
        .prepare(`SELECT * FROM campaigns WHERE id = ? AND user_id = ?`)
        .bind(req.campaignId, req.userId)
        .first<any>();
      if (camp) {
        const excluded: string[] = JSON.parse(camp.excluded_companies_json || '[]');
        if (excluded.some((c) => c.toLowerCase() === job.company_name.toLowerCase())) {
          throw new Error(`CAMPAIGN_EXCLUSION_BLOCKED: Company '${job.company_name}' is on the campaign exclusion list.`);
        }
      }
    }

    const appId = 'app_' + crypto.createHash('md5').update(`${req.userId}:${req.jobId}`).digest('hex').slice(0, 16);
    const now = new Date().toISOString();

    if (req.encounteredCaptchaChallenge) {
      this.db
        .prepare(
          `INSERT INTO applications (id, user_id, campaign_id, job_id, resume_doc_id, cover_letter_doc_id, status, evidence_level, submission_adapter, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'BLOCKED_CAPTCHA', 'BLOCKED', ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET status = 'BLOCKED_CAPTCHA', evidence_level = 'BLOCKED', updated_at = excluded.updated_at`
        )
        .bind(
          appId,
          req.userId,
          req.campaignId ?? null,
          req.jobId,
          req.resumeDocId,
          req.coverLetterDocId ?? null,
          job.submission_method,
          now
        )
        .run();

      const enq = this.queue.enqueueTask({
        userId: req.userId,
        agentId: 'authorized-application-execution',
        toolId: 'applications.prepare_authorized_submission',
        idempotencyKey: `captcha_review:${appId}`,
        priority: 1,
        payload: { applicationId: appId, jobId: req.jobId, companyName: job.company_name },
      });
      this.queue.escalateToHumanAttention(
        enq.task.id,
        `CAPTCHA_CHALLENGE_DETECTED on ${job.company_name} (${job.title}). Autonomous bypass is strictly prohibited; awaiting candidate completion.`
      );

      return {
        applicationId: appId,
        status: 'BLOCKED_CAPTCHA',
        evidenceLevel: 'BLOCKED',
        verified: false,
        externalConfirmationId: null,
        humanAttentionTaskId: enq.task.id,
        detail: 'Halted safely on CAPTCHA challenge and escalated to Human Attention Queue.',
      };
    }

    // If caller supplied a confirmation ID directly in the HTTP body without an authorized adapter,
    // record it strictly as USER_REPORTED / AWAITING_HUMAN_APPROVAL (never SUBMITTED_VERIFIED).
    if (req.userReportedConfirmationId && !req.authorizedAdapterCallback) {
      const unverifiedLog = JSON.stringify({
        userReportedConfirmationId: req.userReportedConfirmationId,
        verified: false,
        evidenceLevel: 'USER_REPORTED',
        recordedAt: now,
      });
      this.db
        .prepare(
          `INSERT INTO applications (id, user_id, campaign_id, job_id, resume_doc_id, cover_letter_doc_id, status, evidence_level, submission_adapter, external_confirmation_id, external_receipt_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'AWAITING_HUMAN_APPROVAL', 'USER_REPORTED', ?, NULL, ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET
             status = 'AWAITING_HUMAN_APPROVAL',
             evidence_level = 'USER_REPORTED',
             external_confirmation_id = NULL,
             external_receipt_json = excluded.external_receipt_json,
             updated_at = excluded.updated_at`
        )
        .bind(
          appId,
          req.userId,
          req.campaignId ?? null,
          req.jobId,
          req.resumeDocId,
          req.coverLetterDocId ?? null,
          job.submission_method,
          unverifiedLog,
          now
        )
        .run();

      return {
        applicationId: appId,
        status: 'AWAITING_HUMAN_APPROVAL',
        evidenceLevel: 'USER_REPORTED',
        verified: false,
        externalConfirmationId: null,
        detail:
          'Caller-supplied confirmation ID recorded as USER_REPORTED; external provider receipt verification is required before SUBMITTED_VERIFIED.',
      };
    }

    if (job.submission_method === 'MANUAL_ONLY' || !req.authorizedAdapterCallback) {
      const evidenceLevel: ApplicationEvidenceLevel =
        job.submission_method === 'MANUAL_ONLY' ? 'MANUAL_ONLY' : 'AWAITING_APPROVAL';
      this.db
        .prepare(
          `INSERT INTO applications (id, user_id, campaign_id, job_id, resume_doc_id, cover_letter_doc_id, status, evidence_level, submission_adapter, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'AWAITING_HUMAN_APPROVAL', ?, ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET status = 'AWAITING_HUMAN_APPROVAL', evidence_level = excluded.evidence_level, updated_at = excluded.updated_at`
        )
        .bind(
          appId,
          req.userId,
          req.campaignId ?? null,
          req.jobId,
          req.resumeDocId,
          req.coverLetterDocId ?? null,
          evidenceLevel,
          job.submission_method,
          now
        )
        .run();

      return {
        applicationId: appId,
        status: 'AWAITING_HUMAN_APPROVAL',
        evidenceLevel,
        verified: false,
        externalConfirmationId: null,
        detail: 'Application package prepared; awaiting candidate sign-off or authorized adapter confirmation.',
      };
    }

    const apiResult = await req.authorizedAdapterCallback({
      jobId: job.id,
      externalId: job.external_id,
      resumeContent: resumeDoc.content,
    });

    if (apiResult.confirmed && apiResult.externalConfirmationId && apiResult.externalConfirmationId.trim().length > 0) {
      const receiptJson = JSON.stringify({
        ...(apiResult.receipt ?? {}),
        confirmationId: apiResult.externalConfirmationId,
        evidenceLevel: 'PROVIDER_CONFIRMED',
        verifiedAt: now,
      });
      this.db
        .prepare(
          `INSERT INTO applications (
             id, user_id, campaign_id, job_id, resume_doc_id, cover_letter_doc_id,
             status, evidence_level, submission_adapter, external_confirmation_id, external_receipt_json, submitted_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED_VERIFIED', 'PROVIDER_CONFIRMED', ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET
             status = 'SUBMITTED_VERIFIED',
             evidence_level = 'PROVIDER_CONFIRMED',
             external_confirmation_id = excluded.external_confirmation_id,
             external_receipt_json = excluded.external_receipt_json,
             submitted_at = excluded.submitted_at,
             updated_at = excluded.updated_at`
        )
        .bind(
          appId,
          req.userId,
          req.campaignId ?? null,
          req.jobId,
          req.resumeDocId,
          req.coverLetterDocId ?? null,
          job.submission_method,
          apiResult.externalConfirmationId,
          receiptJson,
          now,
          now
        )
        .run();

      this.memory.storeMemory({
        userId: req.userId,
        domain: 'EMPLOYER',
        memoryKey: `submission_receipt:${appId}`,
        value: {
          applicationId: appId,
          companyName: job.company_name,
          externalConfirmationId: apiResult.externalConfirmationId,
          evidenceLevel: 'PROVIDER_CONFIRMED',
          submittedAt: now,
        },
        sourceType: 'VERIFIED_EVIDENCE',
        evidenceRef: `confirmation:${apiResult.externalConfirmationId}`,
      });

      return {
        applicationId: appId,
        status: 'SUBMITTED_VERIFIED',
        evidenceLevel: 'PROVIDER_CONFIRMED',
        verified: true,
        externalConfirmationId: apiResult.externalConfirmationId,
        detail: `Verified external submission receipt: ${apiResult.externalConfirmationId}`,
      };
    } else {
      this.db
        .prepare(
          `INSERT INTO applications (id, user_id, campaign_id, job_id, resume_doc_id, cover_letter_doc_id, status, evidence_level, submission_adapter, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED_UNCONFIRMED', 'SUBMISSION_UNCERTAIN', ?, ?)
           ON CONFLICT(user_id, job_id) DO UPDATE SET status = 'SUBMITTED_UNCONFIRMED', evidence_level = 'SUBMISSION_UNCERTAIN', updated_at = excluded.updated_at`
        )
        .bind(
          appId,
          req.userId,
          req.campaignId ?? null,
          req.jobId,
          req.resumeDocId,
          req.coverLetterDocId ?? null,
          job.submission_method,
          now
        )
        .run();

      return {
        applicationId: appId,
        status: 'SUBMITTED_UNCONFIRMED',
        evidenceLevel: 'SUBMISSION_UNCERTAIN',
        verified: false,
        externalConfirmationId: null,
        detail: 'Employer endpoint responded without an attributable confirmation ID; marked SUBMITTED_UNCONFIRMED.',
      };
    }
  }

  public ingestRecruiterEmail(params: {
    userId: string;
    applicationId?: string;
    externalThreadId: string;
    senderEmail: string;
    companyName: string;
    subject: string;
    snippet: string;
  }): { messageId: string; classification: string; requiresResponse: boolean } {
    const text = `${params.subject} ${params.snippet}`.toLowerCase();
    let classification:
      | 'INTERVIEW_INVITE'
      | 'ASSESSMENT'
      | 'RECRUITER_OUTREACH'
      | 'REJECTION'
      | 'OFFER'
      | 'CONFIRMATION' = 'RECRUITER_OUTREACH';
    let requiresResponse = true;

    if (text.includes('interview') || text.includes('schedule a call') || text.includes('availability')) {
      classification = 'INTERVIEW_INVITE';
      requiresResponse = true;
    } else if (text.includes('assessment') || text.includes('coding challenge') || text.includes('take-home')) {
      classification = 'ASSESSMENT';
      requiresResponse = true;
    } else if (text.includes('offer') || text.includes('compensation package')) {
      classification = 'OFFER';
      requiresResponse = true;
    } else if (text.includes('unfortunately') || text.includes('not moving forward') || text.includes('other candidates')) {
      classification = 'REJECTION';
      requiresResponse = false;
    } else if (text.includes('received your application') || text.includes('thank you for applying')) {
      classification = 'CONFIRMATION';
      requiresResponse = false;
    }

    const id = 'msg_' + crypto.randomBytes(10).toString('hex');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO recruiter_messages (id, user_id, application_id, external_thread_id, sender_email, company_name, subject, snippet, classification, requires_response, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.userId,
        params.applicationId ?? null,
        params.externalThreadId,
        params.senderEmail,
        params.companyName,
        params.subject,
        params.snippet,
        classification,
        requiresResponse ? 1 : 0,
        now
      )
      .run();

    return { messageId: id, classification, requiresResponse };
  }

  public scheduleInterviewSlot(params: {
    userId: string;
    applicationId?: string;
    companyName: string;
    roleTitle: string;
    stageName: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    calendarEventId?: string;
  }): { interviewId: string; conflictDetected: boolean } {
    const startMs = new Date(params.scheduledStartAt).getTime();
    const endMs = new Date(params.scheduledEndAt).getTime();
    if (endMs <= startMs) {
      throw new Error('INVALID_INTERVIEW_WINDOW: End time must be after start time.');
    }

    const existing = this.db
      .prepare(`SELECT * FROM interviews WHERE user_id = ? AND status = 'SCHEDULED'`)
      .bind(params.userId)
      .all<any>().results;

    for (const ev of existing) {
      const evStart = new Date(ev.scheduled_start_at).getTime();
      const evEnd = new Date(ev.scheduled_end_at).getTime();
      if (startMs < evEnd && endMs > evStart) {
        throw new Error(
          `CALENDAR_CONFLICT_DETECTED: Overlaps with existing interview for ${ev.company_name} (${ev.scheduled_start_at})`
        );
      }
    }

    const id = 'intv_' + crypto.randomBytes(10).toString('hex');
    this.db
      .prepare(
        `INSERT INTO interviews (id, user_id, application_id, company_name, role_title, stage_name, scheduled_start_at, scheduled_end_at, calendar_event_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED')`
      )
      .bind(
        id,
        params.userId,
        params.applicationId ?? null,
        params.companyName,
        params.roleTitle,
        params.stageName,
        params.scheduledStartAt,
        params.scheduledEndAt,
        params.calendarEventId ?? null
      )
      .run();

    return { interviewId: id, conflictDetected: false };
  }

  /**
   * V9 P0.5 FIX (C4):
   * Uncertain Submission Reconciliation:
   * - If `webhookSignature` is missing or invalid (e.g., an untrusted caller submitting `'confirmation123'`),
   *   records the claim as `USER_REPORTED` (`verified: false`) and NEVER transitions to `SUBMITTED_VERIFIED`.
   * - Only transitions to `SUBMITTED_VERIFIED` (`evidenceLevel: 'PROVIDER_CONFIRMED'`) when `webhookSignature`
   *   is cryptographically verified against the server's `EMPLOYER_WEBHOOK_SECRET`.
   */
  public reconcileUncertainSubmission(params: {
    userId: string;
    applicationId: string;
    externalConfirmationId: string;
    verificationSource: string;
    webhookSignature?: string;
    webhookTimestamp?: string | number;
  }): {
    applicationId: string;
    previousStatus: string;
    newStatus: string;
    evidenceLevel: ApplicationEvidenceLevel;
    verified: boolean;
    externalConfirmationId: string | null;
  } {
    if (!params.externalConfirmationId || params.externalConfirmationId.trim().length < 4) {
      throw new Error('RECONCILIATION_EVIDENCE_MISSING: A valid externalConfirmationId is required.');
    }
    const app = this.db
      .prepare(`SELECT * FROM applications WHERE id = ? AND user_id = ?`)
      .bind(params.applicationId, params.userId)
      .first<any>();
    if (!app) {
      throw new Error(`APPLICATION_NOT_FOUND: ${params.applicationId}`);
    }
    const prevStatus = app.status;
    const now = new Date().toISOString();

    if (params.webhookTimestamp !== undefined && params.webhookTimestamp !== null && String(params.webhookTimestamp).trim() !== '') {
      const tsNum = typeof params.webhookTimestamp === 'number'
        ? params.webhookTimestamp
        : /^\d+$/.test(String(params.webhookTimestamp).trim())
        ? Number(String(params.webhookTimestamp).trim())
        : Date.parse(String(params.webhookTimestamp));
      const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
      if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 300_000) {
        throw new Error('WEBHOOK_TIMESTAMP_EXPIRED: Signed webhook timestamp is outside the 300-second replay window.');
      }
    }

    const sigValid = this.verifyEmployerWebhookSignature({
      applicationId: params.applicationId,
      externalConfirmationId: params.externalConfirmationId,
      verificationSource: params.verificationSource,
      signatureHex: params.webhookSignature,
    });

    if (!sigValid) {
      const userReportedLog = JSON.stringify({
        reconciledFrom: prevStatus,
        userReportedConfirmationId: params.externalConfirmationId,
        verificationSource: params.verificationSource,
        evidenceLevel: 'USER_REPORTED',
        verified: false,
        recordedAt: now,
      });

      this.db
        .prepare(
          `UPDATE applications
           SET status = 'USER_REPORTED',
               evidence_level = 'USER_REPORTED',
               external_confirmation_id = NULL,
               external_receipt_json = ?,
               updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(userReportedLog, now, params.applicationId, params.userId)
        .run();

      return {
        applicationId: params.applicationId,
        previousStatus: prevStatus,
        newStatus: 'USER_REPORTED',
        evidenceLevel: 'USER_REPORTED',
        verified: false,
        externalConfirmationId: null,
      };
    }

    this.db.exec(`CREATE TABLE IF NOT EXISTS webhook_receipt_nonces (
      receipt_hash TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      confirmation_id TEXT NOT NULL,
      webhook_timestamp TEXT,
      verified_at TEXT NOT NULL
    );`);
    const receiptHash = crypto
      .createHash('sha256')
      .update(`${params.applicationId}|${params.externalConfirmationId}|${params.webhookSignature || ''}`)
      .digest('hex');
    const existingNonce = this.db
      .prepare(`SELECT receipt_hash FROM webhook_receipt_nonces WHERE receipt_hash = ?`)
      .bind(receiptHash)
      .first<any>();
    if (existingNonce) {
      throw new Error('WEBHOOK_REPLAY_DETECTED: Signed employer webhook receipt has already been consumed.');
    }
    this.db
      .prepare(
        `INSERT INTO webhook_receipt_nonces (receipt_hash, application_id, confirmation_id, webhook_timestamp, verified_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(receiptHash, params.applicationId, params.externalConfirmationId, params.webhookTimestamp ? String(params.webhookTimestamp) : null, now)
      .run();

    const receipt = JSON.stringify({
      reconciledFrom: prevStatus,
      externalConfirmationId: params.externalConfirmationId,
      verificationSource: params.verificationSource,
      evidenceLevel: 'PROVIDER_CONFIRMED',
      webhookSignatureVerified: true,
      receiptNonceHash: receiptHash,
      reconciledAt: now,
    });

    this.db
      .prepare(
        `UPDATE applications
         SET status = 'SUBMITTED_VERIFIED',
             evidence_level = 'PROVIDER_CONFIRMED',
             external_confirmation_id = ?,
             external_receipt_json = ?,
             submitted_at = COALESCE(submitted_at, ?),
             updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(params.externalConfirmationId, receipt, now, now, params.applicationId, params.userId)
      .run();

    return {
      applicationId: params.applicationId,
      previousStatus: prevStatus,
      newStatus: 'SUBMITTED_VERIFIED',
      evidenceLevel: 'PROVIDER_CONFIRMED',
      verified: true,
      externalConfirmationId: params.externalConfirmationId,
    };
  }
}
