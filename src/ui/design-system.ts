/**
 * APEX GENESIS V6 — LIVING EXPERIENCE / MOTION-FIRST DESIGN SYSTEM
 * Combines the V6 Living Experience editorial tokens, parallel-transport 3D
 * sculptural tube specifications, and spring motion parameters with the
 * 23-workspace Genesis architecture.
 */

export interface WorkspaceSpecification {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  category: 'CORE_COMMAND' | 'INTELLIGENCE' | 'RECRUITMENT' | 'EXECUTION' | 'GOVERNANCE';
  primaryRoute: string;
  primaryDataKey: string;
  v6PrimaryView: 'home' | 'neural' | 'jobs' | 'resume';
  implementationStatus: 'IMPLEMENTED_AND_TESTED' | 'PARTIALLY_IMPLEMENTED';
  description: string;
}

export type WorkspaceDefinition = WorkspaceSpecification;

export interface V6SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface V6SculptureSpec {
  sceneId: 'LIVING_TORUS_UNIVERSE' | 'NEURAL_SYNAPTIC_CROWN' | 'OPPORTUNITY_HORIZON_ARC' | 'STORY_ATELIER_WAVE';
  viewId: 'home' | 'neural' | 'jobs' | 'resume';
  tubeSegments: number;
  radialRings: number;
  normalFrame: 'PARALLEL_TRANSPORT_BISHOP';
  supportsRaycastSelection: boolean;
  supportsCanvas2DFallback: boolean;
}

export const APEX_V6_LIVING_TOKENS = {
  version: '6.0.0-living-experience',
  dark: {
    bg: '#080a13',
    bg2: '#0d1020',
    text: '#f5f2fb',
    muted: '#9da3bc',
    soft: '#757c97',
    border: 'rgba(205, 214, 255, 0.13)',
    line: 'rgba(219, 222, 255, 0.09)',
    glass: 'rgba(17, 21, 39, 0.74)',
    highlight: '#c4b5fd',
    lime: '#d9ffb1',
    pink: '#f4b5c4',
    cyan: '#95e4ec',
  },
  light: {
    bg: '#f6f4f0',
    bg2: '#f0eced',
    text: '#192136',
    muted: '#5d6578',
    soft: '#626b7d',
    border: 'rgba(56, 62, 100, 0.17)',
    line: 'rgba(54, 63, 99, 0.12)',
    glass: 'rgba(255, 255, 255, 0.85)',
    highlight: '#7660b7',
    lime: '#54784d',
  },
  typography: {
    sans: "Inter, Manrope, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  motion: {
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    cameraSpring: { stiffness: 28, damping: 7.5, mass: 1 } as V6SpringConfig,
    hoverSpring: { stiffness: 42, damping: 9.0, mass: 1 } as V6SpringConfig,
  },
  sculptures: [
    {
      sceneId: 'LIVING_TORUS_UNIVERSE',
      viewId: 'home',
      tubeSegments: 360,
      radialRings: 24,
      normalFrame: 'PARALLEL_TRANSPORT_BISHOP',
      supportsRaycastSelection: true,
      supportsCanvas2DFallback: true,
    },
    {
      sceneId: 'NEURAL_SYNAPTIC_CROWN',
      viewId: 'neural',
      tubeSegments: 340,
      radialRings: 22,
      normalFrame: 'PARALLEL_TRANSPORT_BISHOP',
      supportsRaycastSelection: true,
      supportsCanvas2DFallback: true,
    },
    {
      sceneId: 'OPPORTUNITY_HORIZON_ARC',
      viewId: 'jobs',
      tubeSegments: 240,
      radialRings: 18,
      normalFrame: 'PARALLEL_TRANSPORT_BISHOP',
      supportsRaycastSelection: true,
      supportsCanvas2DFallback: true,
    },
    {
      sceneId: 'STORY_ATELIER_WAVE',
      viewId: 'resume',
      tubeSegments: 180,
      radialRings: 16,
      normalFrame: 'PARALLEL_TRANSPORT_BISHOP',
      supportsRaycastSelection: false,
      supportsCanvas2DFallback: true,
    },
  ] as V6SculptureSpec[],
};

export const APEX_DESIGN_TOKENS = {
  themeName: 'APEX V6 Living Experience (Obsidian Velvet & Editorial Alabaster)',
  wcagContrastVerified: true,
  minimumContrastRatio: 7.4,
  surfaces: {
    obsidianVoid: '#080a13',
    deepSapphire: '#0d1020',
    elevatedGlass: 'rgba(17, 21, 39, 0.74)',
    subtleBorder: 'rgba(205, 214, 255, 0.13)',
  },
  typography: {
    platinumPrimary: '#f5f2fb',
    mutedSilver: '#9da3bc',
    fontSans: "Inter, Manrope, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    displayFont: "Georgia, 'Times New Roman', serif",
    monoFont: "'JetBrains Mono', monospace",
  },
  accents: {
    champagneGold: '#d9ffb1',
    electricCyan: '#95e4ec',
    emeraldVerified: '#d9ffb1',
    amberWarning: '#f4b5c4',
    crimsonAlert: '#fb7185',
  },
  v6Living: APEX_V6_LIVING_TOKENS,
};

export const REQUIRED_23_WORKSPACES: WorkspaceSpecification[] = [
  { id: 'mission-control', index: 1, title: 'Mission Control', subtitle: 'Not just a career. A universe of possibility.', category: 'CORE_COMMAND', primaryRoute: '/workspaces/mission-control', primaryDataKey: 'facts', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Living 3D career universe, primary trajectory direction, and high-signal status.' },
  { id: 'ai-command-center', index: 2, title: 'AI Command Center', subtitle: 'Autonomous 14-Stage Objective Planner', category: 'CORE_COMMAND', primaryRoute: '/workspaces/ai-command-center', primaryDataKey: 'plans', v6PrimaryView: 'neural', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Natural-language objective composer and 14-stage validated DAG planner.' },
  { id: 'neural-core', index: 3, title: 'Neural Core', subtitle: 'Meet the mind behind the mission.', category: 'INTELLIGENCE', primaryRoute: '/workspaces/neural-core', primaryDataKey: 'neuralCapabilities', v6PrimaryView: 'neural', implementationStatus: 'PARTIALLY_IMPLEMENTED', description: 'Interactive 3D neural sculpture, model readiness, and truthful inference routing.' },
  { id: 'agent-fleet', index: 4, title: 'Agent Fleet', subtitle: '24 Specialized Career Intelligence Agents', category: 'INTELLIGENCE', primaryRoute: '/workspaces/agent-fleet', primaryDataKey: 'agentFleet', v6PrimaryView: 'neural', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: '24 specialized career, research, verification, and execution agents.' },
  { id: 'opportunity-explorer', index: 5, title: 'Opportunity Explorer', subtitle: 'The right opportunity changes everything.', category: 'RECRUITMENT', primaryRoute: '/workspaces/opportunity-explorer', primaryDataKey: 'jobs', v6PrimaryView: 'jobs', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Calm opportunity discovery, instant role filtering, and provenance verification.' },
  { id: 'job-matching', index: 6, title: 'Job Matching', subtitle: 'Explainable Multi-Factor Role Alignment', category: 'RECRUITMENT', primaryRoute: '/workspaces/job-matching', primaryDataKey: 'matches', v6PrimaryView: 'jobs', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Explainable multi-factor role scoring grounded in verified candidate facts.' },
  { id: 'campaign-manager', index: 7, title: 'Campaign Manager', subtitle: 'Targeted Search Cohorts', category: 'RECRUITMENT', primaryRoute: '/workspaces/campaign-manager', primaryDataKey: 'campaigns', v6PrimaryView: 'jobs', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Multi-role search campaigns and target company cohorts.' },
  { id: 'application-pipeline', index: 8, title: 'Application Pipeline', subtitle: 'Verified Submission Lifecycle', category: 'RECRUITMENT', primaryRoute: '/workspaces/application-pipeline', primaryDataKey: 'applications', v6PrimaryView: 'jobs', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'End-to-end submission lifecycle with external confirmation reconciliation.' },
  { id: 'resume-studio', index: 9, title: 'Resume Studio', subtitle: 'Your story, beautifully told.', category: 'RECRUITMENT', primaryRoute: '/workspaces/resume-studio', primaryDataKey: 'documents', v6PrimaryView: 'resume', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Tactile live document composer with real-time paper typography preview and evidence grounding.' },
  { id: 'candidate-profile', index: 10, title: 'Candidate Profile', subtitle: 'Canonical Grounded Fact Ledger', category: 'RECRUITMENT', primaryRoute: '/workspaces/candidate-profile', primaryDataKey: 'facts', v6PrimaryView: 'resume', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Canonical fact ledger with verbatim source excerpts and SHA-256 hashes.' },
  { id: 'employer-intelligence', index: 11, title: 'Employer Intelligence', subtitle: 'Organization & Engineering Signals', category: 'RECRUITMENT', primaryRoute: '/workspaces/employer-intelligence', primaryDataKey: 'jobs', v6PrimaryView: 'jobs', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Verified organization profiles, hiring signals, and technical stack analysis.' },
  { id: 'document-library', index: 12, title: 'Document Library', subtitle: 'Versioned Artifacts & Claim Diffs', category: 'RECRUITMENT', primaryRoute: '/workspaces/document-library', primaryDataKey: 'resumeVersions', v6PrimaryView: 'resume', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Versioned resume artifacts, cover letters, and cryptographic claim diffs.' },
  { id: 'task-execution', index: 13, title: 'Task Execution', subtitle: 'Durable Queue & Worker Leases', category: 'EXECUTION', primaryRoute: '/workspaces/task-execution', primaryDataKey: 'tasks', v6PrimaryView: 'neural', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Durable execution queue with atomic worker leases and idempotency keys.' },
  { id: 'workflow-studio', index: 14, title: 'Workflow Studio', subtitle: 'DAG Dependency & Checkpoint Inspector', category: 'EXECUTION', primaryRoute: '/workspaces/workflow-studio', primaryDataKey: 'plans', v6PrimaryView: 'neural', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'DAG dependency inspector and checkpoint recovery controls.' },
  { id: 'integration-nexus', index: 15, title: 'Integration Nexus', subtitle: 'Authorized External Connectors', category: 'EXECUTION', primaryRoute: '/workspaces/integration-nexus', primaryDataKey: 'applications', v6PrimaryView: 'jobs', implementationStatus: 'PARTIALLY_IMPLEMENTED', description: 'Authorized connectors for Greenhouse, Lever, Gmail, and Google Calendar.' },
  { id: 'recruiter-inbox', index: 16, title: 'Recruiter Inbox', subtitle: 'Inbound Thread Triage', category: 'EXECUTION', primaryRoute: '/workspaces/recruiter-inbox', primaryDataKey: 'memories', v6PrimaryView: 'jobs', implementationStatus: 'PARTIALLY_IMPLEMENTED', description: 'Inbound recruiter thread classification and response drafting.' },
  { id: 'interview-center', index: 17, title: 'Interview Center', subtitle: 'Schedule Guard & Technical Prep', category: 'EXECUTION', primaryRoute: '/workspaces/interview-center', primaryDataKey: 'memories', v6PrimaryView: 'resume', implementationStatus: 'PARTIALLY_IMPLEMENTED', description: 'Calendar conflict detection and role-specific technical preparation.' },
  { id: 'analytics', index: 18, title: 'Analytics', subtitle: 'Grounded Career Telemetry', category: 'GOVERNANCE', primaryRoute: '/workspaces/analytics', primaryDataKey: 'facts', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Grounded funnel telemetry and verified claim coverage metrics.' },
  { id: 'knowledge-and-memory', index: 19, title: 'Knowledge and Memory', subtitle: '5-Domain Isolated Memory Store', category: 'INTELLIGENCE', primaryRoute: '/workspaces/knowledge-and-memory', primaryDataKey: 'memories', v6PrimaryView: 'neural', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: '5-domain isolated memory engine preventing AI hypothesis contamination.' },
  { id: 'resource-guardian', index: 20, title: 'Resource Guardian', subtitle: 'Zero-Cost Free-Tier Quota Guard', category: 'GOVERNANCE', primaryRoute: '/workspaces/resource-guardian', primaryDataKey: 'resourceGuardian', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Zero-cost Cloudflare Workers, D1, Workers AI, and Gemini quota enforcement.' },
  { id: 'system-health', index: 21, title: 'System Health', subtitle: 'Runtime & Dead-Letter Diagnostics', category: 'GOVERNANCE', primaryRoute: '/workspaces/system-health', primaryDataKey: 'deadLetterTasks', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Runtime diagnostics, WebGL frame-rate telemetry, and dead-letter monitoring.' },
  { id: 'security-center', index: 22, title: 'Security Center', subtitle: 'Tamper-Evident Audit Chain & RBAC', category: 'GOVERNANCE', primaryRoute: '/workspaces/security-center', primaryDataKey: 'auditVerification', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'SHA-256 tamper-evident audit chain, RBAC, and scoped Emergency Stop controls.' },
  { id: 'settings', index: 23, title: 'Settings', subtitle: 'Appearance, Motion & Privacy Controls', category: 'GOVERNANCE', primaryRoute: '/workspaces/settings', primaryDataKey: 'user', v6PrimaryView: 'home', implementationStatus: 'IMPLEMENTED_AND_TESTED', description: 'Appearance themes, reduced-motion preferences, and GDPR data export/erasure.' },
];
