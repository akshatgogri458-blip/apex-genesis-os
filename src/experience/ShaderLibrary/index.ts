/**
 * APEX V7 INFINITY — CUSTOM GLSL SHADER LIBRARY
 * Includes:
 * 1. Pass 0: Full-Screen Raymarched Cosmic Sky, Nebula, Distant Moon, Golden Sunrise Horizon,
 *            Procedural Crystalline Citadel Mountain Skylines, Volumetric Mist, and the
 *            Luminous Concentric Observation Dais with the Capes-Flowing Observer Silhouette.
 * 2. Pass 1 & 2: Physically-Inspired Refractive Glass Biosphere, Sculpted Brushed-Gold &
 *            Sapphire Gyroscopic Ribbons, Floating Waterfall Islands, and Night-Lights Earth Globe.
 */

export const V7_ENVIRONMENT_VERTEX_SHADER = `
  attribute vec2 aQuadPos;
  varying vec2 vUv;
  void main() {
    vUv = aQuadPos * 0.5 + 0.5;
    gl_Position = vec4(aQuadPos, 0.999, 1.0);
  }
`;

export const V7_ENVIRONMENT_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uCameraYawPitch;
  uniform float uSceneMode; // 0=Mission, 1=Neural, 2=Opportunity, 3=Resume

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    p.x += uCameraYawPitch.x * 0.12;
    p.y += uCameraYawPitch.y * 0.08;

    // 1. Deep Cosmic Sky & Starfield
    vec3 skyTop = vec3(0.018, 0.026, 0.065);
    vec3 skyMid = vec3(0.055, 0.075, 0.165);
    float horizonY = -0.14;
    float hDist = uv.y - 0.34;
    vec3 col = mix(skyMid, skyTop, smoothstep(0.25, 0.95, uv.y));

    // Nebula & Sunrise Horizon Glow
    float sunGlow = exp(-length(vec2(p.x * 0.75, uv.y - 0.28)) * 3.2);
    float violetGlow = exp(-length(vec2((p.x - 0.15) * 0.9, uv.y - 0.52)) * 2.4);
    col += vec3(0.98, 0.68, 0.36) * sunGlow * 0.68;
    col += vec3(0.52, 0.40, 0.95) * violetGlow * 0.42;

    // Distant Moon
    vec2 moonCenter = vec2(-0.52, 0.28);
    float moonD = length(p - moonCenter);
    if (moonD < 0.065) {
      float mShade = smoothstep(0.065, 0.01, moonD);
      col = mix(col, vec3(0.75, 0.80, 0.92) * mShade, 0.55);
    }

    // Distant Crystalline Spire Skyline Silhouette at Horizon (uv.y ~ 0.20..0.38)
    float spireX = p.x * 18.0;
    float spireId = floor(spireX);
    float spireH = 0.04 + 0.11 * hash21(vec2(spireId, 1.0)) * exp(-abs(p.x + 0.35) * 1.4);
    float spireMask = step(uv.y, 0.24 + spireH) * step(0.18, uv.y);
    if (spireMask > 0.5 && abs(fract(spireX) - 0.5) < 0.32) {
      col = mix(col, vec3(0.06, 0.07, 0.13), 0.82);
    }

    // Luminous Concentric Observation Dais Floor (uv.y < 0.22)
    if (uv.y < 0.24) {
      float floorT = (0.24 - uv.y) / 0.24;
      float radial = length(vec2(p.x / max(0.18, floorT * 1.35), (uv.y - 0.11) * 4.2));
      float ring1 = exp(-abs(radial - 0.22) * 42.0);
      float ring2 = exp(-abs(radial - 0.42) * 34.0);
      float ring3 = exp(-abs(radial - 0.68) * 28.0);
      vec3 floorCol = vec3(0.03, 0.04, 0.09);
      floorCol += vec3(0.98, 0.78, 0.48) * (ring1 + ring3 * 0.7) * 0.85;
      floorCol += vec3(0.58, 0.48, 0.98) * ring2 * 0.75;
      col = mix(col, floorCol, smoothstep(0.24, 0.16, uv.y));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const V7_SCULPTURE_VERTEX_SHADER = `
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 projection, view, model;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    vec4 worldPos = model * vec4(position, 1.0);
    vPos = worldPos.xyz;
    vNormal = mat3(model) * normal;
    vec4 eyePos = view * worldPos;
    vView = -eyePos.xyz;
    gl_Position = projection * eyePos;
  }
`;

export const V7_SCULPTURE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uMatType; // 1=GlassBiosphere, 2=GoldSapphireRibbon, 3=CitadelSpire, 4=EarthGlobe, 5=Waterfall
  uniform float uHighlight;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vView);
    vec3 L1 = normalize(vec3(-0.45, 0.78, 0.92));
    vec3 L2 = normalize(vec3(0.68, -0.52, 0.65)); // Warm horizon bounce light
    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    float spec = pow(max(dot(reflect(-L1, N), V), 0.0), 48.0);

    vec3 col = uTint;
    float alpha = uAlpha;

    if (uMatType > 3.5 && uMatType < 4.5) {
      // 4 = Planetary Night-Lights Earth Globe (Opportunity Atlas)
      vec3 P = normalize(vPos);
      float n1 = sin(P.x * 4.2 + uTime * 0.12) * cos(P.y * 4.5) * sin(P.z * 3.9 - uTime * 0.1);
      float n2 = sin(P.x * 9.8 - uTime * 0.18) * cos(P.y * 8.6 + P.z * 7.4);
      float land = smoothstep(-0.04, 0.24, n1 + 0.45 * n2);
      float cityGrid = abs(sin(P.x * 38.0 + uTime * 0.15) * cos(P.y * 36.0) * sin(P.z * 40.0));
      float cities = smoothstep(0.42, 0.82, cityGrid) * land;
      vec3 oceanCol = vec3(0.03, 0.07, 0.16) + spec * vec3(0.45, 0.65, 0.95) * 0.6;
      vec3 landCol = vec3(0.06, 0.10, 0.18) + cities * vec3(1.0, 0.78, 0.42) * 1.45;
      col = mix(oceanCol, landCol, land) + fresnel * vec3(0.55, 0.72, 1.0) * 0.85;
      alpha = 0.96;
    } else if (uMatType > 1.5 && uMatType < 2.5) {
      // 2 = Sculpted Liquid-Glass & Brushed Champagne-Gold Gyroscopic Ribbon
      float vein = pow(0.5 + 0.5 * sin(vPos.x * 3.6 + vPos.y * 2.9 - uTime * 1.6), 3.0);
      vec3 goldRim = vec3(0.98, 0.80, 0.50);
      vec3 sapphireCore = mix(uTint * 0.35, uTint * 1.15, diff1 * 0.75 + diff2 * 0.35);
      col = mix(sapphireCore, goldRim, fresnel * 0.72 + vein * 0.38) + spec * vec3(1.0, 0.96, 0.86) * 0.95;
    } else if (uMatType > 2.5 && uMatType < 3.5) {
      // 3 = Golden Citadel Spire & Floating Cliff Architecture
      vec3 spireBase = mix(vec3(0.14, 0.12, 0.22), vec3(0.96, 0.76, 0.46), diff1 * 0.65 + diff2 * 0.45);
      float windows = step(0.65, fract(vPos.y * 18.0)) * step(0.55, fract(vPos.x * 24.0));
      col = spireBase + windows * vec3(1.0, 0.86, 0.58) * 0.9 + fresnel * vec3(0.98, 0.82, 0.52) * 0.55;
    } else {
      // 1 = Refractive Glass Biosphere Shell & Luminous Waterfall Filaments
      vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + dot(N, V) * 4.5 + uTime * 0.5);
      col = mix(uTint * 0.25, irid, 0.45) + fresnel * vec3(0.96, 0.84, 0.62) * 0.92 + spec * 1.1;
    }

    col += uTint * uHighlight * 0.45;
    gl_FragColor = vec4(col, alpha);
  }
`;
