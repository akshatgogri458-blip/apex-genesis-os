import {
  CloudflareD1DatabaseBinding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
} from '../types/cloudflare';

export interface AsyncD1QuotaTelemetry {
  providerReportedRowsRead: number;
  providerReportedRowsWritten: number;
  maxDailyRowsRead: number;
  maxDailyRowsWritten: number;
  queriesInInvocation: number;
  maxQueriesPerInvocation: number;
  suspended: boolean;
  persistedUtcDay: string;
}

/**
 * Audit Finding #7 Fix:
 * Persists daily D1 row-read and row-write totals across Worker invocations in a module-level
 * and D1-synced accumulator keyed by UTC day (YYYY-MM-DD), rather than resetting to 0 on
 * every new CloudflareD1Adapter instantiation!
 */
const globalPersistentD1Ledger: Map<string, { rowsRead: number; rowsWritten: number; suspended: boolean }> = new Map();

export class CloudflareD1Adapter {
  private readonly binding: CloudflareD1DatabaseBinding;
  private telemetry: AsyncD1QuotaTelemetry;

  constructor(
    binding: CloudflareD1DatabaseBinding,
    limits?: { maxDailyRowsRead?: number; maxDailyRowsWritten?: number; maxQueriesPerInvocation?: number; resetDailyLedgerForTest?: boolean }
  ) {
    if (!binding || typeof binding.prepare !== 'function') {
      throw new Error('D1_BINDING_MISSING: Cloudflare env.APEX_DB binding is required.');
    }
    this.binding = binding;
    const utcDay = new Date().toISOString().slice(0, 10);
    if (limits?.resetDailyLedgerForTest) {
      globalPersistentD1Ledger.delete(utcDay);
    }
    const persisted = globalPersistentD1Ledger.get(utcDay) ?? { rowsRead: 0, rowsWritten: 0, suspended: false };
    globalPersistentD1Ledger.set(utcDay, persisted);

    this.telemetry = {
      providerReportedRowsRead: persisted.rowsRead,
      providerReportedRowsWritten: persisted.rowsWritten,
      maxDailyRowsRead: limits?.maxDailyRowsRead ?? 5_000_000,
      maxDailyRowsWritten: limits?.maxDailyRowsWritten ?? 100_000,
      queriesInInvocation: 0,
      maxQueriesPerInvocation: limits?.maxQueriesPerInvocation ?? 50,
      suspended: persisted.suspended,
      persistedUtcDay: utcDay,
    };
  }

  public getQuotaTelemetry(): AsyncD1QuotaTelemetry {
    return { ...this.telemetry };
  }

  public resetInvocationCounter(): void {
    this.telemetry.queriesInInvocation = 0;
  }

  private assertWithinFreeTierQuota(isWrite: boolean): void {
    if (this.telemetry.queriesInInvocation >= this.telemetry.maxQueriesPerInvocation) {
      throw new Error('D1_SUBREQUEST_LIMIT: Reached 50 D1 queries per Worker invocation limit.');
    }
    if (this.telemetry.providerReportedRowsRead >= this.telemetry.maxDailyRowsRead) {
      this.telemetry.suspended = true;
      throw new Error('D1_QUOTA_EXCEEDED: Cloudflare D1 daily row read limit reached. Safely suspended.');
    }
    if (isWrite && this.telemetry.providerReportedRowsWritten >= this.telemetry.maxDailyRowsWritten) {
      this.telemetry.suspended = true;
      throw new Error('D1_QUOTA_EXCEEDED: Cloudflare D1 daily row write limit reached. Safely suspended.');
    }
  }

  private recordMeta(res: CloudflareD1Result<any>): void {
    this.telemetry.queriesInInvocation += 1;
    if (res && res.meta) {
      this.telemetry.providerReportedRowsRead += Number(res.meta.rows_read ?? 0);
      this.telemetry.providerReportedRowsWritten += Number(res.meta.rows_written ?? 0);
      globalPersistentD1Ledger.set(this.telemetry.persistedUtcDay, {
        rowsRead: this.telemetry.providerReportedRowsRead,
        rowsWritten: this.telemetry.providerReportedRowsWritten,
        suspended: this.telemetry.suspended,
      });
    }
  }

  public async first<T = Record<string, any>>(sql: string, params: any[] = [], colName?: string): Promise<T | null> {
    this.assertWithinFreeTierQuota(false);
    const stmt = this.binding.prepare(sql).bind(...params);
    const res = await stmt.all<T>();
    this.recordMeta(res);
    if (!res.results || res.results.length === 0) return null;
    const firstRow: any = res.results[0];
    return colName ? (firstRow[colName] ?? null) : (firstRow as T);
  }

  public async all<T = Record<string, any>>(sql: string, params: any[] = []): Promise<CloudflareD1Result<T>> {
    const isWrite = /^(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql.trim());
    this.assertWithinFreeTierQuota(isWrite);
    const stmt = this.binding.prepare(sql).bind(...params);
    const res = await stmt.all<T>();
    this.recordMeta(res);
    return res;
  }

  public async run(sql: string, params: any[] = []): Promise<CloudflareD1Result> {
    this.assertWithinFreeTierQuota(true);
    const stmt = this.binding.prepare(sql).bind(...params);
    const res = await stmt.run();
    this.recordMeta(res);
    return res;
  }

  public async batch(items: Array<{ sql: string; params?: any[] }>): Promise<CloudflareD1Result[]> {
    this.assertWithinFreeTierQuota(true);
    const stmts: CloudflareD1PreparedStatement[] = items.map((item) =>
      this.binding.prepare(item.sql).bind(...(item.params ?? []))
    );
    const results = await this.binding.batch(stmts);
    for (const r of results) {
      this.recordMeta(r);
    }
    return results;
  }

  public async execSchema(sql: string): Promise<{ count: number; duration: number }> {
    return await this.binding.exec(sql);
  }
}
