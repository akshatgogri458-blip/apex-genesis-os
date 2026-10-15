export interface SpatialNodeTarget {
  index: number;
  id: string;
  label: string;
  subtitle: string;
  worldPos: [number, number, number];
}

export class InteractionManager {
  public pickNearestProjectedNode(
    ndcX: number,
    ndcY: number,
    projectedNodes: Array<{ index: number; ndcX: number; ndcY: number; visible: boolean }>
  ): number {
    let bestIdx = 0;
    let bestDistSq = 999;
    for (const n of projectedNodes) {
      if (!n.visible) continue;
      const dSq = (n.ndcX - ndcX) ** 2 + (n.ndcY - ndcY) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = n.index;
      }
    }
    return bestIdx;
  }
}
