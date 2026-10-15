import { V7_MOTION_PRESETS, V7MotionMode } from '../design/motion';

export class MotionSystem {
  private mode: V7MotionMode = 'IMMERSIVE';

  public setMode(mode: V7MotionMode): void {
    this.mode = mode;
  }

  public getMode(): V7MotionMode {
    return this.mode;
  }

  public stepSpring(current: number, target: number, velocity: number, dt: number): { value: number; velocity: number } {
    const preset = V7_MOTION_PRESETS[this.mode];
    const { stiffness, damping } = preset.cameraSpring;
    const nextVel = (velocity + (target - current) * stiffness * dt) * Math.exp(-damping * dt);
    return { value: current + nextVel * dt, velocity: nextVel };
  }
}
