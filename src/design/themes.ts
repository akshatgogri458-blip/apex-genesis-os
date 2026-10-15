import { V7_INFINITY_TOKENS } from './tokens';

export type V7ThemeId = 'celestial-horizon' | 'aurora-sanctuary' | 'editorial-daylight';

export const V7_THEMES = {
  'celestial-horizon': {
    id: 'celestial-horizon',
    label: 'Celestial Horizon (V7 Flagship)',
    skyTop: [0.02, 0.03, 0.08],
    horizonGlow: [0.96, 0.72, 0.43],
    nebulaTint: [0.48, 0.39, 0.91],
    tokens: V7_INFINITY_TOKENS,
  },
  'aurora-sanctuary': {
    id: 'aurora-sanctuary',
    label: 'Aurora Sanctuary',
    skyTop: [0.01, 0.04, 0.09],
    horizonGlow: [0.38, 0.88, 0.82],
    nebulaTint: [0.35, 0.55, 0.96],
    tokens: V7_INFINITY_TOKENS,
  },
  'editorial-daylight': {
    id: 'editorial-daylight',
    label: 'Editorial Daylight',
    skyTop: [0.88, 0.90, 0.95],
    horizonGlow: [0.98, 0.82, 0.62],
    nebulaTint: [0.52, 0.44, 0.85],
    tokens: V7_INFINITY_TOKENS,
  },
};
