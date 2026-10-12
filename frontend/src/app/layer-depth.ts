import { SceneLayer } from './models';

/** Expands the scene around the starless plane, which remains the fixed anchor. */
export function separatedLayerDepth(
  layer: SceneLayer,
  anchorDepth: number,
  separation: number,
): number {
  return anchorDepth + (layer.depth - anchorDepth) * separation;
}

export const MINIMUM_STAR_DEPTH_GAP = 0.001;

/** Resolves authored depth, global separation and local Z while keeping stars camera-side of the nebula. */
export function effectiveLayerDepth(
  layer: SceneLayer,
  anchorDepth: number,
  anchorPositionZ: number,
  separation: number,
): number {
  const anchorEffectiveDepth = anchorDepth + anchorPositionZ;
  const translatedDepth =
    separatedLayerDepth(layer, anchorDepth, separation) +
    layer.transform.position.z;
  return layer.type === 'stars'
    ? Math.max(translatedDepth, anchorEffectiveDepth + MINIMUM_STAR_DEPTH_GAP)
    : translatedDepth;
}
