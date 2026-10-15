/**
 * APEX GENESIS V8 — PERSISTENT ZERO-CASH BUDGET GOVERNOR (Section J & Audit Finding #7)
 * Enforces durable UTC-day and UTC-month provider & user quotas in SQLite/D1.
 * Never resets daily counters on Worker invocation boundaries.
 * Fails closed with BLOCKED_COST_UNVERIFIED when a provider's cost model is unknown.
 */

import { ApexD1Database } from './d1-sqlite-engine';

export interface ProviderQuotaSpec {
  providerId: string;
  dailyHardLimit: number;
  monthlyHardLimit: number;
  costVerifiedFreeTier: boolean;
  unitName: string;
}

export const OFFICIAL_V8_FREE_TIER_SPECS: Record<string, ProviderQuotaSpec> = {
  CLOUDFLARE_D1_READS: {
    providerId: 'CLOUDFLARE_D1_READS',
    dailyHardLimit: 4_500_000, // Conservative guard below 5,000,000/day free limit
    monthlyHardLimit: 135_000_000,
    costVerifiedFreeTier: true,
    unitName: 'rows_read',
  },
  CLOUDFLARE_D1_WRITES: {
    providerId: 'CLOUDFLARE_D1_WRITES',
    dailyHardLimit: 90_000, // Conservative guard below 100,000/day free limit
    monthlyHardLimit: 2_700_000,
    costVerifiedFreeTier: true,
    unitName: 'rows_written',
  },
  WORKERS_AI_NEURONS: {
    providerId: 'WORKERS_AI_NEURONS',
    dailyHardLimit: 9_000, // Hard stop below 10,000 free Neurons/day
    monthlyHardLimit: 270_000,
    costVerifiedFreeTier: true,
    unitName: 'neurons',
  },
  GEMINI_FREE_RPD: {
    providerId: 'GEMINI_FREE_RPD',
    dailyHardLimit: 1_400, // Hard stop below 1,500 RPD free limit
    monthlyHardLimit: 42_000,
    costVerifiedFreeTier: true,
    unitName: 'requests',
  },
  GREENHOUSE_PUBLIC_GET: {
    providerId: 'GREENHOUSE_PUBLIC_GET',
    dailyHardLimit: 500,
    monthlyHardLimit: 15_000,
    costVerifiedFreeTier: true,
    unitName: 'http_get',
  },
  LEVER_PUBLIC_GET: {
    providerId: 'LEVER_PUBLIC_GET',
    dailyHardLimit: 500,
    monthlyHardLimit: 15_000,
    costVerifiedFreeTier: true,
    unitName: 'http_get',
  },
  ASHBY_PUBLIC_GET: {
    providerId: 'ASHBY_PUBLIC_GET',
    dailyHardLimit: 500,
    monthlyHardLimit: 15_000,
    costVerifiedFreeTier: true,
    unitName: 'http_get',
  },
};

export class BudgetGovernor {
  private db: ApexD1Database;

  constructor(db: ApexD1Database) {
    this.db = db;
  }

  public static currentUtcDayKey(now = new Date()): string {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  public static currentUtcMonthKey(now = new Date()): string {
    return now.toISOString().slice(0, 7); // YYYY-MM
  }

  /**
   * Reserves budget units in persistent D1/SQLite storage BEFORE an external call is made.
   * Throws BLOCKED_COST_UNVERIFIED if the provider is not verified free-tier.
   * Throws QUOTA_EXHAUSTED if either the UTC-day or UTC-month hard limit would be exceeded.
   */
  public reserveBudget(params: {
    providerId: string;
    userId: string;
    unitsToReserve: number;
    customDailyLimit?: number;
  }): {
    reserved: boolean;
    dayBucketKey: string;
    monthBucketKey: string;
    dailyConsumedAfter: number;
    dailyHardLimit: number;
  } {
    const spec = OFFICIAL_V8_FREE_TIER_SPECS[params.providerId];
    if (!spec || !spec.costVerifiedFreeTier) {
      throw new Error(`BLOCKED_COST_UNVERIFIED: Provider '${params.providerId}' does not have a verified $0 free-tier cost policy.`);
    }

    const units = Math.max(1, Math.ceil(params.unitsToReserve));
    const dayKey = BudgetGovernor.currentUtcDayKey();
    const monthKey = BudgetGovernor.currentUtcMonthKey();
    const dailyLimit = params.customDailyLimit ?? spec.dailyHardLimit;
    const monthlyLimit = spec.monthlyHardLimit;
    const nowIso = new Date().toISOString();

    const dayBucketKey = `${params.providerId}:USER_DAILY:${params.userId}:${dayKey}`;
    const monthBucketKey = `${params.providerId}:GLOBAL_MONTHLY:ALL:${monthKey}`;

    this.ensureBucketExists(dayBucketKey, params.providerId, 'USER_DAILY', params.userId, dayKey, dailyLimit, nowIso);
    this.ensureBucketExists(monthBucketKey, params.providerId, 'GLOBAL_MONTHLY', 'ALL', monthKey, monthlyLimit, nowIso);

    const dayRow = this.db.prepare(`SELECT * FROM provider_budget_ledger WHERE bucket_key = ?`).bind(dayBucketKey).first<any>();
    const monthRow = this.db.prepare(`SELECT * FROM provider_budget_ledger WHERE bucket_key = ?`).bind(monthBucketKey).first<any>();

    if (dayRow.suspended === 1 || dayRow.units_consumed + dayRow.units_reserved + units > dayRow.hard_limit) {
      this.db.prepare(`UPDATE provider_budget_ledger SET suspended = 1, updated_at = ? WHERE bucket_key = ?`).bind(nowIso, dayBucketKey).run();
      throw new Error(`QUOTA_EXHAUSTED: Daily free-tier limit (${dayRow.hard_limit} ${spec.unitName}) reached for ${params.providerId}.`);
    }

    if (monthRow.suspended === 1 || monthRow.units_consumed + monthRow.units_reserved + units > monthRow.hard_limit) {
      this.db.prepare(`UPDATE provider_budget_ledger SET suspended = 1, updated_at = ? WHERE bucket_key = ?`).bind(nowIso, monthBucketKey).run();
      throw new Error(`QUOTA_EXHAUSTED: Monthly free-tier limit (${monthRow.hard_limit} ${spec.unitName}) reached for ${params.providerId}.`);
    }

    this.db
      .prepare(`UPDATE provider_budget_ledger SET units_reserved = units_reserved + ?, updated_at = ? WHERE bucket_key = ?`)
      .bind(units, nowIso, dayBucketKey)
      .run();
    this.db
      .prepare(`UPDATE provider_budget_ledger SET units_reserved = units_reserved + ?, updated_at = ? WHERE bucket_key = ?`)
      .bind(units, nowIso, monthBucketKey)
      .run();

    return {
      reserved: true,
      dayBucketKey,
      monthBucketKey,
      dailyConsumedAfter: Number(dayRow.units_consumed) + Number(dayRow.units_reserved) + units,
      dailyHardLimit: Number(dayRow.hard_limit),
    };
  }

  /**
   * Reconciles a prior reservation with actual provider-reported usage.
   */
  public reconcileReservation(params: {
    dayBucketKey: string;
    monthBucketKey: string;
    reservedUnits: number;
    actualUnitsConsumed: number;
  }): void {
    const nowIso = new Date().toISOString();
    const r = Math.max(0, Math.ceil(params.reservedUnits));
    const a = Math.max(0, Math.ceil(params.actualUnitsConsumed));
    for (const key of [params.dayBucketKey, params.monthBucketKey]) {
      this.db
        .prepare(
          `UPDATE provider_budget_ledger
           SET units_reserved = MAX(0, units_reserved - ?),
               units_consumed = units_consumed + ?,
               updated_at = ?
           WHERE bucket_key = ?`
        )
        .bind(r, a, nowIso, key)
        .run();
    }
  }

  public getPersistentBudgetSummary(userId: string): Record<string, any> {
    const dayKey = BudgetGovernor.currentUtcDayKey();
    const rows = this.db
      .prepare(`SELECT * FROM provider_budget_ledger WHERE period_key = ? AND (scope_owner_id = ? OR scope_owner_id = 'ALL')`)
      .bind(dayKey, userId)
      .all<any>().results;
    return {
      utcDay: dayKey,
      zeroCashEnforced: true,
      billingEnabled: false,
      buckets: rows,
    };
  }

  private ensureBucketExists(
    bucketKey: string,
    providerId: string,
    scopeType: string,
    ownerId: string,
    periodKey: string,
    hardLimit: number,
    nowIso: string
  ): void {
    const existing = this.db.prepare(`SELECT bucket_key FROM provider_budget_ledger WHERE bucket_key = ?`).bind(bucketKey).first();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO provider_budget_ledger (bucket_key, provider_id, scope_type, scope_owner_id, period_key, units_reserved, units_consumed, hard_limit, billing_enabled, suspended, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 0, ?)`
        )
        .bind(bucketKey, providerId, scopeType, ownerId, periodKey, hardLimit, nowIso)
        .run();
    }
  }
}
