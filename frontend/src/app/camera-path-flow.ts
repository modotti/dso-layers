import * as THREE from 'three';

/** Redistributes time inside each segment without pausing or changing speed at its joins. */
export function cinematicPathPhase(
  phase: number,
  segmentCount: number,
  momentum: number,
): number {
  const clampedPhase = THREE.MathUtils.clamp(phase, 0, 1);
  const segments = Math.max(1, Math.floor(segmentCount));
  if (clampedPhase === 1) return 1;
  const strength = THREE.MathUtils.clamp(momentum, 0, 0.9);
  const position = clampedPhase * segments;
  const segment = Math.floor(position);
  const localPhase = position - segment;
  const curvedPhase =
    localPhase +
    (strength * Math.sin(localPhase * Math.PI * 2)) / (Math.PI * 2);
  return (segment + curvedPhase) / segments;
}
