export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1ResponseMeta {
  duration: number;
  rows_read: number;
  rows_written: number;
  last_row_id?: number;
  changed_db?: boolean;
  size_after?: number;
  changes: number;
}

export interface CloudflareD1Result<T = Record<string, any>> {
  results: T[];
  success: boolean;
  meta: D1ResponseMeta;
}

export interface CloudflareD1PreparedStatement {
  bind(...values: any[]): CloudflareD1PreparedStatement;
  first<T = Record<string, any>>(colName?: string): Promise<T | null>;
  run<T = Record<string, any>>(): Promise<CloudflareD1Result<T>>;
  all<T = Record<string, any>>(): Promise<CloudflareD1Result<T>>;
}

export interface CloudflareD1DatabaseBinding {
  prepare(query: string): CloudflareD1PreparedStatement;
  batch<T = Record<string, any>>(statements: CloudflareD1PreparedStatement[]): Promise<CloudflareD1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface CloudflareWorkersAIBinding {
  run(model: string, inputs: Record<string, any>, options?: Record<string, any>): Promise<any>;
}

export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface CloudflareScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry?: () => void;
}
