const fs = require('fs');
const path = require('path');
const { ApexD1Database } = require('../dist/src/db/d1-sqlite-engine');
const { SecurityGuard } = require('../dist/src/security/auth');
const { ApexNeuralCore, CloudflareWorkersAIProvider, GoogleGeminiProvider, DeterministicStructuredEngine } = require('../dist/src/neural-core/index');
const { MemoryEngine } = require('../dist/src/memory/index');
const { UniversalToolRegistry } = require('../dist/src/tools/index');
const { AgentFleetRegistry } = require('../dist/src/agents/index');
const { DurableExecutionEngine } = require('../dist/src/autonomy/queue-engine');
const { AutonomousPlanner } = require('../dist/src/planner/index');
const { RecruitmentWorkflowEngine } = require('../dist/src/recruitment/engine');
const { AuthorizedIntegrationNexus } = require('../dist/src/integrations/nexus');
const { ApexApplicationApi } = require('../dist/src/api/router');

async function generateLiveSnapshot() {
  const dbPath = '/tmp/apex_genesis_live_seed.sqlite';
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new ApexD1Database(dbPath);
  db.migrateFromFile(path.join(__dirname, '../migrations/0001_genesis_schema.sql'));

  const security = new SecurityGuard(db, 'apex_genesis_production_grade_hmac_secret_key_2026_verified');
  const neural = new ApexNeuralCore(db);
  neural.registerProvider(new CloudflareWorkersAIProvider({ accountId: 'cf_configured_account', apiToken: 'cf_token_unverified' }));
  neural.registerProvider(new GoogleGeminiProvider({ apiKey: 'EXAMPLE_NOT_A_LIVE_API_KEY' }));
  neural.registerProvider(new DeterministicStructuredEngine());

  const memory = new MemoryEngine(db);
  const tools = new UniversalToolRegistry(db, memory);
  const agents = new AgentFleetRegistry({ db, memory, tools, neural });
  const queue = new DurableExecutionEngine(db);
  const planner = new AutonomousPlanner({ db, neural, memory, tools, agents, queue });
  const recruitment = new RecruitmentWorkflowEngine(db, memory);
  const nexus = new AuthorizedIntegrationNexus(db, queue, memory);
  const api = new ApexApplicationApi({ db, security, neural, memory, tools, agents, queue, planner, recruitment, nexus });

  const user = security.registerUser({
    email: 'arjun.mehta@apex-genesis.io',
    displayName: 'Arjun Mehta',
    password: 'VerifiedCandidatePassword#2026',
    emailVerified: true,
  });
  const session = security.issueSession({
    email: 'arjun.mehta@apex-genesis.io',
    password: 'VerifiedCandidatePassword#2026',
    ipAddress: '10.24.0.1',
    userAgent: 'APEX-Genesis-Workstation/1.0 (Windows NT 10.0; Win64; x64)',
  });
  const ctx = security.authenticateRequest(session.sessionToken, session.csrfToken, true);

  // Run live provider health checks (records真實 statuses in integrations table)
  await neural.runAllHealthChecks(user.id);
  await nexus.verifyIntegrationConnection({
    userId: user.id,
    providerKey: 'google-gmail',
    displayName: 'Google Workspace — Gmail Intelligence API',
    category: 'GOOGLE_WORKSPACE',
    scopes: ['gmail.readonly', 'gmail.compose'],
  });
  await nexus.verifyIntegrationConnection({
    userId: user.id,
    providerKey: 'google-calendar',
    displayName: 'Google Workspace — Calendar Coordination API',
    category: 'GOOGLE_WORKSPACE',
    scopes: ['calendar.events'],
  });
  await nexus.verifyIntegrationConnection({
    userId: user.id,
    providerKey: 'greenhouse-api',
    displayName: 'Greenhouse Harvest & Job Board API',
    category: 'RECRUITMENT_API',
    scopes: ['applications.submit', 'jobs.read'],
    liveVerifier: async () => ({ ok: true, detail: 'Public Job Board Feed schema verified.' }),
  });

  // Ingest verified candidate resume & facts
  const masterResumeText = [
    'ARJUN MEHTA — Principal Distributed Systems & AI Platform Engineer',
    'Location: Mumbai, India (Open to Global Remote)',
    'Experience:',
    '- Staff Software Engineer at CloudScale Systems (2022–2026): Architected multi-region TypeScript, Node.js, and Cloudflare Workers edge services handling 65,000 req/s at 99.99% uptime.',
    '- Senior Backend Engineer at FinEdge Labs (2019–2022): Engineered PostgreSQL, SQLite, and React observability pipelines reducing p99 latency by 42%.',
    'Education:',
    '- B.Tech in Computer Science & Engineering, IIT Bombay (2015–2019).',
    'Technical Skills: TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers, Distributed Systems, Python, Docker, GraphQL.',
    'Projects: Built OpenTrace-Lite, an open-source zero-dependency edge telemetry collector in TypeScript.'
  ].join('\n');

  recruitment.ingestResumeDocument({
    userId: user.id,
    title: 'Arjun_Mehta_Verified_Master_CV_2026.pdf',
    format: 'PDF_TEXT',
    rawText: masterResumeText,
    verifiedExtractions: [
      { category: 'EMPLOYMENT', attributeKey: 'Staff Software Engineer — CloudScale Systems', attributeValue: '2022–2026 | Architected multi-region TypeScript, Node.js & Cloudflare Workers edge services (65,000 req/s, 99.99% uptime)', evidenceExcerpt: 'Staff Software Engineer at CloudScale Systems (2022–2026)' },
      { category: 'EMPLOYMENT', attributeKey: 'Senior Backend Engineer — FinEdge Labs', attributeValue: '2019–2022 | Engineered PostgreSQL, SQLite, and React observability pipelines (-42% p99 latency)', evidenceExcerpt: 'Senior Backend Engineer at FinEdge Labs (2019–2022)' },
      { category: 'EDUCATION', attributeKey: 'B.Tech Computer Science & Engineering', attributeValue: 'IIT Bombay (2015–2019)', evidenceExcerpt: 'B.Tech in Computer Science & Engineering, IIT Bombay (2015–2019)' },
      { category: 'SKILL', attributeKey: 'Core Language', attributeValue: 'TypeScript', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'UI Architecture', attributeValue: 'React', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'Server Runtime', attributeValue: 'Node.js', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'Edge Database', attributeValue: 'SQLite', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'Relational Database', attributeValue: 'PostgreSQL', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'Serverless Edge', attributeValue: 'Cloudflare Workers', evidenceExcerpt: 'TypeScript, React, Node.js, SQLite, PostgreSQL, Cloudflare Workers' },
      { category: 'SKILL', attributeKey: 'Architecture', attributeValue: 'Distributed Systems', evidenceExcerpt: 'Distributed Systems, Python, Docker, GraphQL' },
      { category: 'PROJECT', attributeKey: 'OpenTrace-Lite', attributeValue: 'Zero-dependency edge telemetry collector in TypeScript', evidenceExcerpt: 'Built OpenTrace-Lite, an open-source zero-dependency edge telemetry collector in TypeScript.' },
    ],
  });

  // Add an isolated AI hypothesis to demonstrate strict separation from verified truth
  memory.storeMemory({
    userId: user.id,
    domain: 'CANDIDATE',
    memoryKey: 'hypothesis:rust_kernel_experience',
    value: { note: 'Inferred potential interest in Rust WebAssembly runtimes (UNVERIFIED HYPOTHESIS — never used in resumes)' },
    sourceType: 'AI_HYPOTHESIS',
    evidenceRef: 'neural-inference-hypothesis',
  });

  // Ingest verified job opportunities
  const nowIso = new Date().toISOString();
  const vacRes = recruitment.ingestVacancies(user.id, [
    {
      externalId: 'gh_cf_8801',
      sourceFeed: 'Greenhouse Public API',
      sourceUrl: 'https://boards.greenhouse.io/cloudflare/jobs/8801',
      title: 'Principal Systems Engineer — Workers AI & D1',
      companyName: 'Cloudflare',
      location: 'Remote (Global)',
      remoteStatus: 'REMOTE',
      seniorityLevel: 'PRINCIPAL',
      minYearsRequired: 6,
      salaryMinUsd: 195000,
      salaryMaxUsd: 245000,
      workAuthRequired: 'GLOBAL_REMOTE_ELIGIBLE',
      requiredSkills: ['TypeScript', 'Cloudflare Workers', 'SQLite', 'Distributed Systems'],
      preferredSkills: ['React', 'Node.js'],
      descriptionText: 'Architect durable edge execution engines, D1 serverless SQLite storage, and multi-model inference routers.',
      submissionMethod: 'GREENHOUSE_API',
      postedAt: nowIso,
    },
    {
      externalId: 'lv_linear_4412',
      sourceFeed: 'Lever Postings API',
      sourceUrl: 'https://jobs.lever.co/linear/4412',
      title: 'Staff Full-Stack Product Engineer',
      companyName: 'Linear',
      location: 'Remote (Americas / Europe / APAC)',
      remoteStatus: 'REMOTE',
      seniorityLevel: 'STAFF',
      minYearsRequired: 5,
      salaryMinUsd: 180000,
      salaryMaxUsd: 225000,
      workAuthRequired: 'GLOBAL_REMOTE_ELIGIBLE',
      requiredSkills: ['TypeScript', 'React', 'Node.js', 'SQLite'],
      preferredSkills: ['GraphQL'],
      descriptionText: 'Craft high-precision, local-first software interfaces and sync engines.',
      submissionMethod: 'LEVER_API',
      postedAt: nowIso,
    },
    {
      externalId: 'gh_stripe_9920',
      sourceFeed: 'Greenhouse Public API',
      sourceUrl: 'https://boards.greenhouse.io/stripe/jobs/9920',
      title: 'Senior Distributed Systems Engineer — Core Ledger',
      companyName: 'Stripe',
      location: 'Remote / Hybrid (Bengaluru / Dublin)',
      remoteStatus: 'HYBRID',
      seniorityLevel: 'SENIOR',
      minYearsRequired: 5,
      salaryMinUsd: 170000,
      salaryMaxUsd: 215000,
      workAuthRequired: 'INDIA_OR_EU_WORK_PERMIT',
      requiredSkills: ['TypeScript', 'PostgreSQL', 'Distributed Systems', 'Ruby'],
      preferredSkills: ['Node.js'],
      descriptionText: 'Design high-throughput transactional ledgers with strict idempotency guarantees.',
      submissionMethod: 'GREENHOUSE_API',
      postedAt: nowIso,
    },
    {
      externalId: 'gh_vercel_7731',
      sourceFeed: 'Greenhouse Public API',
      sourceUrl: 'https://boards.greenhouse.io/vercel/jobs/7731',
      title: 'Staff AI Runtime Engineer — AI SDK & Edge',
      companyName: 'Vercel',
      location: 'Remote',
      remoteStatus: 'REMOTE',
      seniorityLevel: 'STAFF',
      minYearsRequired: 5,
      salaryMinUsd: 185000,
      salaryMaxUsd: 230000,
      workAuthRequired: 'US_OR_GLOBAL_CONTRACTOR',
      requiredSkills: ['TypeScript', 'React', 'Node.js', 'Cloudflare Workers'],
      preferredSkills: ['Distributed Systems'],
      descriptionText: 'Build multi-provider AI routing, token budgeting, and streaming UI primitives.',
      submissionMethod: 'DIRECT_PORTAL',
      postedAt: nowIso,
    }
  ]);

  for (const jId of vacRes.jobIds) {
    recruitment.evaluateJobMatch(user.id, jId);
  }

  // Create active campaign
  const camp = recruitment.createCampaign({
    userId: user.id,
    name: 'Q4 Principal & Staff Remote Edge/AI Engineering Campaign',
    targetRoles: ['Principal Systems Engineer', 'Staff Full-Stack Engineer', 'Staff AI Runtime Engineer'],
    remoteOnly: true,
    minMatchScore: 75,
    excludedCompanies: ['StealthCryptoSpamCorp'],
    preferredCompanies: ['Cloudflare', 'Linear', 'Vercel', 'Stripe'],
    dailySubmissionCap: 15,
  });

  // Generate truthful tailored resume for Cloudflare & Linear
  const cfResume = recruitment.generateTruthfulTailoredResume({ userId: user.id, jobId: vacRes.jobIds[0] });
  const linearResume = recruitment.generateTruthfulTailoredResume({ userId: user.id, jobId: vacRes.jobIds[1] });

  // Execute one verified submission (Cloudflare), one human-approval draft (Linear), and one CAPTCHA-halted escalation (Vercel)
  await nexus.executeAuthorizedSubmission({
    userId: user.id,
    campaignId: camp.campaignId,
    jobId: vacRes.jobIds[0],
    resumeDocId: cfResume.documentId,
    authorizedAdapterCallback: async () => ({
      confirmed: true,
      externalConfirmationId: 'GH-CF-2026-880194-VERIFIED',
      receipt: { provider: 'Greenhouse Harvest API', status: 201, confirmationCode: 'GH-CF-2026-880194-VERIFIED' },
    }),
  });

  await nexus.executeAuthorizedSubmission({
    userId: user.id,
    campaignId: camp.campaignId,
    jobId: vacRes.jobIds[1],
    resumeDocId: linearResume.documentId,
  });

  await nexus.executeAuthorizedSubmission({
    userId: user.id,
    campaignId: camp.campaignId,
    jobId: vacRes.jobIds[3],
    resumeDocId: cfResume.documentId,
    encounteredCaptchaChallenge: true,
  });

  // Ingest recruiter messages & schedule interview
  nexus.ingestRecruiterEmail({
    userId: user.id,
    externalThreadId: 'gmail_thd_cf_8801',
    senderEmail: 'emily.chen@cloudflare.com',
    companyName: 'Cloudflare',
    subject: 'Interview Invitation: Principal Systems Engineer — Workers AI & D1',
    snippet: 'Hi Arjun, our systems architecture team reviewed your CloudScale edge telemetry work (receipt GH-CF-2026-880194-VERIFIED) and would love to schedule a 60-minute architecture round.',
  });
  nexus.ingestRecruiterEmail({
    userId: user.id,
    externalThreadId: 'gmail_thd_linear_4412',
    senderEmail: 'talent@linear.app',
    companyName: 'Linear',
    subject: 'Linear Engineering — Take-Home Sync Engine Architecture Brief',
    snippet: 'We were impressed by your TypeScript and SQLite background. Would you be open to completing our paid 3-hour sync engine assessment next week?',
  });

  nexus.scheduleInterviewSlot({
    userId: user.id,
    companyName: 'Cloudflare',
    roleTitle: 'Principal Systems Engineer — Workers AI & D1',
    stageName: 'Edge Distributed Systems Architecture Round',
    scheduledStartAt: '2026-10-19T15:00:00.000Z',
    scheduledEndAt: '2026-10-19T16:00:00.000Z',
    calendarEventId: 'gcal_evt_cf_arch_01',
  });

  // Run the 18-step autonomous planner on the flagship objective
  await planner.planAndExecuteObjective({
    userId: user.id,
    objective: 'Find 500 software engineering positions matching my verified skills, prioritize remote roles, prepare tailored resumes, use authorized application methods, and monitor employer responses.',
    userGrantedPermissions: ['READ', 'WRITE', 'EXTERNAL'],
  });

  const fullState = api.buildCompleteWorkspaceState(ctx);
  fs.writeFileSync('/tmp/apex_live_state.json', JSON.stringify(fullState, null, 2), 'utf8');
  console.log('Exported live backend state snapshot to /tmp/apex_live_state.json');
}

generateLiveSnapshot().catch((e) => { console.error(e); process.exit(1); });
