import { SceneLayer } from './models';

/** Expands the scene around the starless plane, which remains the fixed anchor. */
export function separatedLayerDepth(
  layer: SceneLayer,
  anchorDepth: number,
  separation: number,
): number {
  return anchorDepth + (layer.depth - anchorDepth) * separation;
}
