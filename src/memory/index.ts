import * as crypto from 'crypto';
import { ApexD1Database } from '../db/d1-sqlite-engine';

export type MemoryDomain = 'CANDIDATE' | 'CAMPAIGN' | 'AGENT' | 'EMPLOYER' | 'SYSTEM';
export type MemorySourceType = 'VERIFIED_EVIDENCE' | 'TOOL_EXECUTION' | 'USER_CONFIRMED' | 'AI_HYPOTHESIS';
export type FactCategory =
  | 'EMPLOYMENT'
  | 'EDUCATION'
  | 'SKILL'
  | 'PROJECT'
  | 'CERTIFICATION'
  | 'EXPERIENCE'
  | 'PREFERENCE'
  | 'CONFIRMED_ANSWER';

export interface CandidateFactRecord {
  id: string;
  userId: string;
  candidateId: string;
  category: FactCategory;
  attributeKey: string;
  attributeValue: string;
  verified: boolean;
  evidenceSource: string;
  evidenceExcerpt: string;
  confidenceScore: number;
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  userId: string;
  domain: MemoryDomain;
  memoryKey: string;
  value: any;
  sourceType: MemorySourceType;
  isVerifiedTruth: boolean;
  evidenceRef: string;
  updatedAt: string;
}

export class MemoryEngine {
  private db: ApexD1Database;

  constructor(db: ApexD1Database) {
    this.db = db;
  }

  public getCandidateIdForUser(userId: string): string {
    const row = this.db
      .prepare(`SELECT id FROM candidates WHERE user_id = ?`)
      .bind(userId)
      .first<{ id: string }>();
    if (!row) {
      throw new Error(`CANDIDATE_NOT_FOUND: No candidate profile for user ${userId}`);
    }
    return row.id;
  }

  public addCandidateFact(params: {
    userId: string;
    category: FactCategory;
    attributeKey: string;
    attributeValue: string;
    verified: boolean;
    evidenceSource: string;
    evidenceExcerpt: string;
    confidenceScore?: number;
  }): CandidateFactRecord {
    if (!params.evidenceSource || !params.evidenceExcerpt) {
      throw new Error('FACT_EVIDENCE_REQUIRED: Every candidate fact requires an evidence source and excerpt.');
    }
    const candidateId = this.getCandidateIdForUser(params.userId);
    const id = 'fact_' + crypto.randomBytes(10).toString('hex');
    const createdAt = new Date().toISOString();
    const conf = params.confidenceScore ?? (params.verified ? 1.0 : 0.5);

    this.db
      .prepare(
        `INSERT INTO candidate_facts (id, user_id, candidate_id, category, attribute_key, attribute_value, verified, evidence_source, evidence_excerpt, confidence_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.userId,
        candidateId,
        params.category,
        params.attributeKey,
        params.attributeValue,
        params.verified ? 1 : 0,
        params.evidenceSource,
        params.evidenceExcerpt,
        conf,
        createdAt
      )
      .run();

    // Mirror verified facts into CANDIDATE memory domain
    this.storeMemory({
      userId: params.userId,
      domain: 'CANDIDATE',
      memoryKey: `fact:${params.category}:${params.attributeKey}:${id}`,
      value: {
        factId: id,
        category: params.category,
        key: params.attributeKey,
        value: params.attributeValue,
      },
      sourceType: params.verified ? 'VERIFIED_EVIDENCE' : 'AI_HYPOTHESIS',
      evidenceRef: `${params.evidenceSource} (${params.evidenceExcerpt})`,
    });

    return {
      id,
      userId: params.userId,
      candidateId,
      category: params.category,
      attributeKey: params.attributeKey,
      attributeValue: params.attributeValue,
      verified: params.verified,
      evidenceSource: params.evidenceSource,
      evidenceExcerpt: params.evidenceExcerpt,
      confidenceScore: conf,
      createdAt,
    };
  }

  public getVerifiedCandidateFacts(actorUserId: string, targetUserId: string, category?: FactCategory): CandidateFactRecord[] {
    if (actorUserId !== targetUserId) {
      throw new Error('MEMORY_ISOLATION_VIOLATION: Cross-user candidate fact access denied.');
    }
    const sql = category
      ? `SELECT * FROM candidate_facts WHERE user_id = ? AND verified = 1 AND category = ? ORDER BY created_at ASC`
      : `SELECT * FROM candidate_facts WHERE user_id = ? AND verified = 1 ORDER BY created_at ASC`;
    const rows = (category
      ? this.db.prepare(sql).bind(targetUserId, category)
      : this.db.prepare(sql).bind(targetUserId)
    ).all<any>().results;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      candidateId: r.candidate_id,
      category: r.category as FactCategory,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      verified: Number(r.verified) === 1,
      evidenceSource: r.evidence_source,
      evidenceExcerpt: r.evidence_excerpt,
      confidenceScore: Number(r.confidence_score),
      createdAt: r.created_at,
    }));
  }

  public storeMemory(params: {
    userId: string;
    domain: MemoryDomain;
    memoryKey: string;
    value: any;
    sourceType: MemorySourceType;
    evidenceRef: string;
  }): MemoryEntry {
    // CRITICAL RULE: Do not confuse AI-generated text with verified truth.
    // AI_HYPOTHESIS can NEVER be marked as verified truth (`is_verified_truth = 1`).
    const isVerifiedTruth =
      params.sourceType === 'VERIFIED_EVIDENCE' ||
      params.sourceType === 'USER_CONFIRMED' ||
      params.sourceType === 'TOOL_EXECUTION';

    const id = 'mem_' + crypto.createHash('sha256').update(`${params.userId}:${params.domain}:${params.memoryKey}`).digest('hex').slice(0, 20);
    const now = new Date().toISOString();
    const jsonVal = JSON.stringify(params.value);

    this.db
      .prepare(
        `INSERT INTO memories (id, user_id, domain, memory_key, memory_value_json, source_type, is_verified_truth, evidence_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, domain, memory_key) DO UPDATE SET
           memory_value_json = excluded.memory_value_json,
           source_type = excluded.source_type,
           is_verified_truth = excluded.is_verified_truth,
           evidence_ref = excluded.evidence_ref,
           updated_at = excluded.updated_at`
      )
      .bind(id, params.userId, params.domain, params.memoryKey, jsonVal, params.sourceType, isVerifiedTruth ? 1 : 0, params.evidenceRef, now, now)
      .run();

    return {
      id,
      userId: params.userId,
      domain: params.domain,
      memoryKey: params.memoryKey,
      value: params.value,
      sourceType: params.sourceType,
      isVerifiedTruth,
      evidenceRef: params.evidenceRef,
      updatedAt: now,
    };
  }

  public retrieveDomainMemory(params: {
    actorUserId: string;
    targetUserId: string;
    domain: MemoryDomain;
    verifiedTruthOnly?: boolean;
  }): MemoryEntry[] {
    if (params.actorUserId !== params.targetUserId) {
      throw new Error(`MEMORY_ACCESS_DENIED: User ${params.actorUserId} cannot read ${params.domain} memory of ${params.targetUserId}`);
    }
    const verifiedOnly = params.verifiedTruthOnly ?? true;
    const sql = verifiedOnly
      ? `SELECT * FROM memories WHERE user_id = ? AND domain = ? AND is_verified_truth = 1 ORDER BY updated_at DESC`
      : `SELECT * FROM memories WHERE user_id = ? AND domain = ? ORDER BY updated_at DESC`;
    const rows = this.db.prepare(sql).bind(params.targetUserId, params.domain).all<any>().results;
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      domain: r.domain as MemoryDomain,
      memoryKey: r.memory_key,
      value: JSON.parse(r.memory_value_json),
      sourceType: r.source_type as MemorySourceType,
      isVerifiedTruth: Number(r.is_verified_truth) === 1,
      evidenceRef: r.evidence_ref,
      updatedAt: r.updated_at,
    }));
  }
}
