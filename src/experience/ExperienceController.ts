import { PerformanceManager } from './PerformanceManager';
import { InteractionManager } from './InteractionManager';
import { MotionSystem } from './MotionSystem';

export class ExperienceController {
  public readonly performance = new PerformanceManager();
  public readonly interaction = new InteractionManager();
  public readonly motion = new MotionSystem();
  public activeWorld: 'MISSION' | 'NEURAL' | 'OPPORTUNITY' | 'RESUME' = 'MISSION';

  public transitionToWorld(world: 'MISSION' | 'NEURAL' | 'OPPORTUNITY' | 'RESUME'): void {
    this.activeWorld = world;
  }
}
