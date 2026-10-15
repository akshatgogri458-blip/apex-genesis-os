import { APEX_DESIGN_TOKENS, APEX_V6_LIVING_TOKENS, REQUIRED_23_WORKSPACES, WorkspaceSpecification } from './design-system';

declare const React: any;

export interface ApexApiClientConfig {
  baseUrl: string;
  sessionToken: string;
  csrfToken: string;
}

export async function callApexBackendApi(
  cfg: ApexApiClientConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, any>
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (cfg.sessionToken) {
    headers['authorization'] = `Bearer ${cfg.sessionToken}`;
  }
  if (cfg.csrfToken && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    headers['x-csrf-token'] = cfg.csrfToken;
  }
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

/**
 * Generates a parallel-transport (Bishop) 3D tube mesh without Frenet-frame flips or pinching.
 */
export function buildParallelTransportTubeMesh(
  curveFn: (t: number) => [number, number, number],
  segments: number,
  rings: number,
  radius: number
): { xyz: number[]; norm: number[]; indices: number[] } {
  const xyz: number[] = [];
  const norm: number[] = [];
  const indices: number[] = [];
  const dt = 0.0008;

  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a: number[], s: number) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm3 = (a: number[]) => {
    const d = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / d, a[1] / d, a[2] / d];
  };

  let prevBinormal: number[] | null = null;

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = curveFn(t);
    const cp = curveFn(t + dt);
    const cm = curveFn(t - dt);
    const tangent = norm3(sub(cp, cm));

    let bin: number[];
    if (!prevBinormal) {
      const anchor = Math.abs(tangent[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
      bin = norm3(cross(tangent, anchor));
    } else {
      const projected = sub(prevBinormal, mul(tangent, dot(prevBinormal, tangent)));
      bin = norm3(projected);
    }
    prevBinormal = bin;
    const n2 = norm3(cross(tangent, bin));

    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * Math.PI * 2;
      const normalVec = add(mul(bin, Math.cos(a)), mul(n2, Math.sin(a)));
      const posVec = add(c, mul(normalVec, radius));
      xyz.push(posVec[0], posVec[1], posVec[2]);
      norm.push(normalVec[0], normalVec[1], normalVec[2]);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rings; j++) {
      const x = i * (rings + 1) + j;
      indices.push(x, x + rings + 1, x + 1, x + 1, x + rings + 1, x + rings + 2);
    }
  }

  return { xyz, norm, indices };
}

export interface ApexGenesisAppProps {
  activeWorkspaceId: string;
  applicationState: Record<string, any>;
  onSelectWorkspace: (workspaceId: string) => void;
  onDispatchObjective: (objective: string) => Promise<void>;
  onToggleEmergencyStop: (stopped: boolean, reason: string) => Promise<void>;
}

export function renderWorkspaceVerifySummary(workspaceId: string, state: Record<string, any>): {
  workspace: WorkspaceSpecification;
  ariaLabel: string;
  liveItemCount: number;
  statusBadge: string;
} {
  const ws = REQUIRED_23_WORKSPACES.find((w) => w.id === workspaceId) ?? REQUIRED_23_WORKSPACES[0];
  const dataVal = state[ws.primaryDataKey];
  const liveItemCount = Array.isArray(dataVal)
    ? dataVal.length
    : typeof dataVal === 'object' && dataVal !== null
    ? Object.keys(dataVal).length
    : 0;

  return {
    workspace: ws,
    ariaLabel: `Workspace ${ws.index}: ${ws.title}`,
    liveItemCount,
    statusBadge: ws.implementationStatus,
  };
}

export const ApexGenesisApp = (props: ApexGenesisAppProps) => {
  const summary = renderWorkspaceVerifySummary(props.activeWorkspaceId, props.applicationState);
  const state = props.applicationState || {};
  const isEmergencyStopped = Boolean(state.resourceGuardian?.emergencyStopped);

  return React.createElement(
    'div',
    {
      className: 'apex-v6-living-shell',
      role: 'application',
      'aria-label': 'APEX GENESIS V6 — Living Career Intelligence Environment',
      style: {
        backgroundColor: APEX_V6_LIVING_TOKENS.dark.bg,
        color: APEX_V6_LIVING_TOKENS.dark.text,
        fontFamily: APEX_DESIGN_TOKENS.typography.fontSans,
      },
    },
    React.createElement(
      'header',
      { role: 'banner', className: 'topbar' },
      React.createElement('span', { className: 'brand' }, 'APEX'),
      React.createElement('span', { className: 'brand-desc' }, 'An intelligence environment'),
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': 'Server Emergency Stop Toggle',
          onClick: () => props.onToggleEmergencyStop(!isEmergencyStopped, 'Operator UI toggle'),
        },
        isEmergencyStopped ? 'EMERGENCY STOP: ENGAGED' : 'EMERGENCY STOP: ARMED'
      )
    ),
    React.createElement(
      'aside',
      { role: 'navigation', className: 'rail', 'aria-label': 'Primary Navigation Rail' },
      REQUIRED_23_WORKSPACES.map((ws) =>
        React.createElement(
          'button',
          {
            key: ws.id,
            type: 'button',
            className: 'rail-btn',
            'aria-current': ws.id === props.activeWorkspaceId ? 'page' : undefined,
            onClick: () => props.onSelectWorkspace(ws.id),
          },
          `${ws.index}. ${ws.title}`
        )
      )
    ),
    React.createElement(
      'main',
      { role: 'main', className: 'page', 'aria-label': summary.ariaLabel },
      React.createElement('h1', null, summary.workspace.title),
      React.createElement('p', { className: 'serif pale' }, summary.workspace.subtitle),
      React.createElement('span', { className: 'status-badge' }, summary.statusBadge),
      React.createElement('div', { 'data-testid': 'live-item-count' }, `Live Records: ${summary.liveItemCount}`)
    )
  );
};
