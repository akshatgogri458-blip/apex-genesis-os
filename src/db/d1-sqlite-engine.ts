import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface D1Meta {
  rows_read: number;
  rows_written: number;
  changes: number;
  last_row_id?: number;
  duration_ms: number;
}

export interface D1Result<T = Record<string, any>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1QuotaState {
  dailyRowsRead: number;
  dailyRowsWritten: number;
  maxDailyRowsRead: number;
  maxDailyRowsWritten: number;
  queriesInCurrentInvocation: number;
  maxQueriesPerInvocation: number;
  suspended: boolean;
}

const INLINE_PY = `
import sys, os, json, hashlib, sqlite3
req = json.loads(sys.argv[1])
orig_path = req['dbPath']
real_path = orig_path
if orig_path != ':memory:' and orig_path.startswith('/working_dir/'):
    digest = hashlib.sha256(orig_path.encode('utf-8')).hexdigest()[:16]
    real_path = os.path.join('/tmp', f'apex_d1_{digest}_{os.path.basename(orig_path)}')
    if not os.path.exists(orig_path):
        if os.path.exists(real_path):
            try:
                os.remove(real_path)
            except OSError:
                pass
        os.makedirs(os.path.dirname(orig_path), exist_ok=True)
        open(orig_path, 'wb').close()

conn = sqlite3.connect(real_path, isolation_level=None)
conn.row_factory = sqlite3.Row
conn.execute('PRAGMA foreign_keys = ON;')
try:
    op = req['op']
    sql = req.get('sql', '')
    params = req.get('params', [])
    if op == 'exec':
        conn.executescript(sql)
        print(json.dumps({'ok': True, 'results': [], 'rowsRead': 0, 'rowsWritten': 0, 'changes': 0}))
    elif op == 'query':
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        upper = sql.strip().upper()
        is_write = upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE'))
        changes = max(0, cur.rowcount) if is_write else 0
        print(json.dumps({
            'ok': True,
            'results': rows,
            'rowsRead': len(rows) if not is_write else 0,
            'rowsWritten': changes,
            'changes': changes
        }))
    elif op == 'batch':
        out = []
        conn.execute('BEGIN IMMEDIATE;')
        try:
            for item in req['statements']:
                cur = conn.execute(item['sql'], item['params'])
                rows = [dict(r) for r in cur.fetchall()]
                upper = item['sql'].strip().upper()
                is_write = upper.startswith(('INSERT', 'UPDATE', 'DELETE', 'REPLACE'))
                changes = max(0, cur.rowcount) if is_write else 0
                out.append({
                    'results': rows,
                    'rowsRead': len(rows) if not is_write else 0,
                    'rowsWritten': changes,
                    'changes': changes
                })
            conn.execute('COMMIT;')
            print(json.dumps({'ok': True, 'batchResults': out}))
        except Exception as be:
            conn.execute('ROLLBACK;')
            raise be
finally:
    conn.close()
`;

export class D1PreparedStatement {
  private db: ApexD1Database;
  private sql: string;
  private params: any[];

  constructor(db: ApexD1Database, sql: string, params: any[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: any[]): D1PreparedStatement {
    return new D1PreparedStatement(this.db, this.sql, values);
  }

  getRaw(): { sql: string; params: any[] } {
    return { sql: this.sql, params: this.params };
  }

  first<T = Record<string, any>>(colName?: string): T | null {
    const res = this.all<T>();
    if (!res.results || res.results.length === 0) return null;
    const row: any = res.results[0];
    if (colName) return row[colName] ?? null;
    return row as T;
  }

  all<T = Record<string, any>>(): D1Result<T> {
    return this.db._executeStatement<T>(this.sql, this.params);
  }

  run(): D1Result<Record<string, any>> {
    return this.db._executeStatement(this.sql, this.params);
  }
}

export class ApexD1Database {
  public readonly dbPath: string;
  private quota: D1QuotaState;

  constructor(dbPath: string, opts?: Partial<D1QuotaState>) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.quota = {
      dailyRowsRead: 0,
      dailyRowsWritten: 0,
      maxDailyRowsRead: opts?.maxDailyRowsRead ?? 5_000_000,
      maxDailyRowsWritten: opts?.maxDailyRowsWritten ?? 100_000,
      queriesInCurrentInvocation: 0,
      maxQueriesPerInvocation: opts?.maxQueriesPerInvocation ?? 50,
      suspended: false,
    };
  }

  public resetInvocationSubrequests(): void {
    this.quota.queriesInCurrentInvocation = 0;
  }

  public getQuotaState(): D1QuotaState {
    return { ...this.quota };
  }

  public setQuotaLimits(maxReads: number, maxWrites: number): void {
    this.quota.maxDailyRowsRead = maxReads;
    this.quota.maxDailyRowsWritten = maxWrites;
    this.quota.suspended =
      this.quota.dailyRowsRead >= this.quota.maxDailyRowsRead ||
      this.quota.dailyRowsWritten >= this.quota.maxDailyRowsWritten;
  }

  public prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this, sql, []);
  }

  public migrateFromFile(sqlFilePath: string): void {
    const schema = fs.readFileSync(sqlFilePath, 'utf8');
    this.exec(schema);
  }

  public execSchema(sql: string): void {
    this.exec(sql);
  }

  public exec(sql: string): void {
    const payload = JSON.stringify({ op: 'exec', dbPath: this.dbPath, sql });
    const res = spawnSync('python3', ['-S', '-c', INLINE_PY, payload], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`D1 SQLite exec error: ${res.stderr || res.stdout}`);
    }
    const parsed = JSON.parse(res.stdout.trim());
    if (!parsed.ok) {
      throw new Error(`D1 SQL error: ${parsed.error}`);
    }
  }

  public _executeStatement<T = Record<string, any>>(sql: string, params: any[]): D1Result<T> {
    const isWrite = /^(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql.trim());
    if (this.quota.dailyRowsRead >= this.quota.maxDailyRowsRead) {
      this.quota.suspended = true;
      throw new Error('D1_QUOTA_EXCEEDED: Daily free-tier row read limit (5,000,000) reached. Operations safely suspended until 00:00 UTC.');
    }
    if (isWrite && this.quota.dailyRowsWritten >= this.quota.maxDailyRowsWritten) {
      this.quota.suspended = true;
      throw new Error('D1_QUOTA_EXCEEDED: Daily free-tier row write limit (100,000) reached. Operations safely suspended until 00:00 UTC.');
    }

    const start = Date.now();
    const payload = JSON.stringify({ op: 'query', dbPath: this.dbPath, sql, params });
    const res = spawnSync('python3', ['-S', '-c', INLINE_PY, payload], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`D1 SQLite query failed: ${res.stderr || res.stdout}`);
    }
    const parsed = JSON.parse(res.stdout.trim());
    if (!parsed.ok) {
      throw new Error(`D1 SQL error: ${parsed.error}`);
    }

    const rowsRead = parsed.rowsRead || 0;
    const rowsWritten = parsed.rowsWritten || 0;
    this.quota.dailyRowsRead += rowsRead;
    this.quota.dailyRowsWritten += rowsWritten;
    this.quota.queriesInCurrentInvocation += 1;

    return {
      results: parsed.results as T[],
      success: true,
      meta: {
        rows_read: rowsRead,
        rows_written: rowsWritten,
        changes: parsed.changes || 0,
        duration_ms: Date.now() - start,
      },
    };
  }

  public batch(statements: D1PreparedStatement[]): D1Result[] {
    if (this.quota.dailyRowsWritten >= this.quota.maxDailyRowsWritten) {
      this.quota.suspended = true;
      throw new Error('D1_QUOTA_EXCEEDED: Cannot execute batch while write quota is exhausted.');
    }
    const start = Date.now();
    const rawStmts = statements.map((s) => s.getRaw());
    const payload = JSON.stringify({ op: 'batch', dbPath: this.dbPath, statements: rawStmts });
    const res = spawnSync('python3', ['-S', '-c', INLINE_PY, payload], { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`D1 batch transaction rolled back: ${res.stderr || res.stdout}`);
    }
    const parsed = JSON.parse(res.stdout.trim());
    if (!parsed.ok) {
      throw new Error(`D1 batch SQL error: ${parsed.error}`);
    }

    return parsed.batchResults.map((b: any) => {
      this.quota.dailyRowsRead += b.rowsRead;
      this.quota.dailyRowsWritten += b.rowsWritten;
      return {
        results: b.results,
        success: true,
        meta: {
          rows_read: b.rowsRead,
          rows_written: b.rowsWritten,
          changes: b.changes,
          duration_ms: Date.now() - start,
        },
      };
    });
  }
}
