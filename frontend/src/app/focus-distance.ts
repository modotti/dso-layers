import * as THREE from 'three';

export function focusDistanceAlongView(cameraPosition: THREE.Vector3, cameraDirection: THREE.Vector3, focusPoint: THREE.Vector3, nearClip: number): number {
  const directionLength = Math.max(Number.EPSILON, cameraDirection.length());
  const distance = ((focusPoint.x - cameraPosition.x) * cameraDirection.x + (focusPoint.y - cameraPosition.y) * cameraDirection.y + (focusPoint.z - cameraPosition.z) * cameraDirection.z) / directionLength;
  return Math.max(nearClip, distance);
}

export function perspectiveDepthForDistance(distance: number, nearClip: number, farClip: number): number {
  const viewZ = -Math.max(nearClip, distance);
  return THREE.MathUtils.clamp(((nearClip + viewZ) * farClip) / ((farClip - nearClip) * viewZ), 0, 1);
}

export function interpolateFocusDistance(start: number | undefined, end: number | undefined, phase: number): number | undefined {
  return start === undefined || end === undefined ? undefined : THREE.MathUtils.lerp(start, end, THREE.MathUtils.clamp(phase, 0, 1));
}
