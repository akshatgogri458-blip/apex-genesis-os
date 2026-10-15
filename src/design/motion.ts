export type V7MotionMode = 'IMMERSIVE' | 'BALANCED' | 'REDUCED_MOTION';

export interface SpringParameters {
  stiffness: number;
  damping: number;
  mass: number;
}

export const V7_MOTION_PRESETS: Record<V7MotionMode, {
  timeScale: number;
  enableArrivalFlight: boolean;
  enableBloomPass: boolean;
  cameraSpring: SpringParameters;
}> = {
  IMMERSIVE: {
    timeScale: 1.0,
    enableArrivalFlight: true,
    enableBloomPass: true,
    cameraSpring: { stiffness: 26, damping: 6.8, mass: 1.0 },
  },
  BALANCED: {
    timeScale: 0.55,
    enableArrivalFlight: false,
    enableBloomPass: true,
    cameraSpring: { stiffness: 34, damping: 8.5, mass: 1.0 },
  },
  REDUCED_MOTION: {
    timeScale: 0.0,
    enableArrivalFlight: false,
    enableBloomPass: false,
    cameraSpring: { stiffness: 120, damping: 24.0, mass: 1.0 },
  },
};
