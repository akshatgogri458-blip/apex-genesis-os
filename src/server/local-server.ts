import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ApexD1Database } from '../db/d1-sqlite-engine';
import { SecurityGuard } from '../security/auth';
import {
  ApexNeuralCore,
  CloudflareWorkersAIProvider,
  GoogleGeminiProvider,
  DeterministicStructuredEngine,
} from '../neural-core/index';
import { MemoryEngine } from '../memory/index';
import { UniversalToolRegistry } from '../tools/index';
import { AgentFleetRegistry } from '../agents/index';
import { DurableExecutionEngine } from '../autonomy/queue-engine';
import { AutonomousPlanner } from '../planner/index';
import { RecruitmentWorkflowEngine } from '../recruitment/engine';
import { AuthorizedIntegrationNexus } from '../integrations/nexus';
import { ApexApplicationApi } from '../api/router';

export interface RunningApexServer {
  server: http.Server;
  port: number;
  api: ApexApplicationApi;
  db: ApexD1Database;
  close: () => Promise<void>;
}

export function createApexRuntime(dbPath = '/tmp/apex_genesis_v2_server.sqlite'): {
  db: ApexD1Database;
  api: ApexApplicationApi;
} {
  const schemaPath = path.resolve(__dirname, '../../../migrations/0001_genesis_schema.sql');
  const db = new ApexD1Database(dbPath);
  db.migrateFromFile(schemaPath);

  const secret = process.env.APEX_SESSION_SECRET || 'apex_genesis_v2_server_default_hmac_secret_key_32bytes_min';
  const security = new SecurityGuard(db, secret);
  const neural = new ApexNeuralCore(db);
  neural.registerProvider(
    new CloudflareWorkersAIProvider({
      accountId: process.env.CF_ACCOUNT_ID,
      apiToken: process.env.CF_API_TOKEN,
    })
  );
  neural.registerProvider(new GoogleGeminiProvider({ apiKey: process.env.GEMINI_API_KEY }));
  neural.registerProvider(new DeterministicStructuredEngine());

  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory);
  const api = new ApexApplicationApi({
    db,
    security,
    neural,
    memory,
    tools,
    agents,
    queue,
    planner,
    recruitment,
    nexus,
  });

  return { db, api };
}

export async function startApexHttpServer(port = 0, dbPath = '/tmp/apex_genesis_v2_server.sqlite'): Promise<RunningApexServer> {
  const { db, api } = createApexRuntime(dbPath);
  const htmlPath = path.resolve(__dirname, '../../../public/index.html');

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = urlObj.pathname;
    const method = (req.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';

    if (pathname.startsWith('/api/')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsedBody: any = {};
      if (rawBody.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'INVALID_JSON_BODY' }));
          return;
        }
      }

      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }

      const apiRes = await api.handle({
        method,
        path: pathname,
        headers,
        body: parsedBody,
      });

      res.writeHead(apiRes.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        ...(apiRes.headers ?? {}),
      });
      res.end(JSON.stringify(apiRes.body));
      return;
    }

    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', () => resolve()));
  const addr = server.address() as { port: number };

  return {
    server,
    port: addr.port,
    api,
    db,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  startApexHttpServer(port).then((srv) => {
    console.log(`[APEX-SERVER] Live API & Command Environment listening on http://127.0.0.1:${srv.port}`);
  });
}
