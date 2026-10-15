export interface PerformanceTelemetry {
  fps: number;
  dpr: number;
  qualityTier: 'HIGH_CINEMATIC' | 'BALANCED' | 'BATTERY_SAVER' | 'FALLBACK_2D';
  contextLost: boolean;
}

export class PerformanceManager {
  private fps = 60;
  private contextLost = false;

  public computeAdaptiveDpr(viewportWidth: number, rawDpr: number): number {
    if (viewportWidth < 650) return Math.min(rawDpr || 1, 1.25);
    return Math.min(rawDpr || 1, 1.65);
  }

  public recordFrameRate(measuredFps: number): void {
    this.fps = Math.max(1, Math.min(120, Math.round(measuredFps)));
  }

  public markContextLost(lost: boolean): void {
    this.contextLost = lost;
  }

  public getTelemetry(viewportWidth: number): PerformanceTelemetry {
    return {
      fps: this.fps,
      dpr: this.computeAdaptiveDpr(viewportWidth, 1.5),
      qualityTier: this.contextLost ? 'FALLBACK_2D' : this.fps >= 45 ? 'HIGH_CINEMATIC' : 'BALANCED',
      contextLost: this.contextLost,
    };
  }
}
