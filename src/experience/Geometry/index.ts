/**
 * APEX V7 INFINITY — PROCEDURAL 3D GEOMETRY BUILDERS
 * Generates parallel-transport sculpted gyroscopic ribbons, inner citadel spires,
 * floating waterfall sky-islands, planetary globes, and refractive monolith frames.
 */

export interface MeshBuffersData {
  xyz: number[];
  norm: number[];
  indices: number[];
}

export function buildSculptedGyroRibbonMesh(
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  twistFreq: number,
  ribbonWidth: number,
  ribbonThickness: number,
  segments = 240,
  rings = 16
): MeshBuffersData {
  const xyz: number[] = [];
  const norm: number[] = [];
  const indices: number[] = [];
  const dt = 0.001;

  const center = (t: number): [number, number, number] => [
    radiusX * Math.cos(t) + 0.18 * Math.cos(twistFreq * t),
    radiusY * Math.sin(t) * Math.cos(0.5 * twistFreq * t),
    radiusZ * Math.sin(t) + 0.18 * Math.sin(twistFreq * t),
  ];

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

  let prevBin: number[] | null = null;

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = center(t);
    const tangent = norm3(sub(center(t + dt), center(t - dt)));
    let bin: number[];
    if (!prevBin) {
      const anchor = Math.abs(tangent[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
      bin = norm3(cross(tangent, anchor));
    } else {
      bin = norm3(sub(prevBin, mul(tangent, dot(prevBin, tangent))));
    }
    prevBin = bin;
    const n2 = norm3(cross(tangent, bin));

    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * Math.PI * 2;
      const localN = norm3(add(mul(bin, Math.cos(a)), mul(n2, Math.sin(a))));
      const offset = add(mul(bin, Math.cos(a) * ribbonWidth), mul(n2, Math.sin(a) * ribbonThickness));
      const pos = add(c, offset);
      xyz.push(pos[0], pos[1], pos[2]);
      norm.push(localN[0], localN[1], localN[2]);
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
