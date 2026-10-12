import { CameraMovement, CameraPathPose, SceneDocument, VideoExportSettings } from './models';

export function createRandomCameraSequence(
  scene: SceneDocument,
  video: VideoExportSettings,
  count = 5,
  random: () => number = Math.random,
  _separation = 1,
): CameraMovement[] {
  const movementCount = Math.max(1, Math.min(5, Math.floor(count)));
  const nebula = scene.layers.find(layer => layer.type === 'nebula');
  // Separation expands star layers around this fixed starless plane.
  const nebulaDepth = nebula?.depth ?? 0;
  const planeZ = nebulaDepth + (nebula?.transform?.position.z ?? 0);
  const originZ = scene.camera.position[2];
  const targetZ = scene.camera.target[2];
  const baseDistance = Math.max(.1, originZ - nebulaDepth);
  const tangent = Math.tan(scene.camera.fov * Math.PI / 360);
  const imageAspect = scene.source.width / Math.max(1, scene.source.height);
  const viewportAspect = video.width / Math.max(1, video.height);
  const planeHalfHeight = baseDistance * tangent * (nebula?.transform?.scale.y ?? 1);
  const planeHalfWidth = baseDistance * tangent * imageAspect * (nebula?.transform?.scale.x ?? 1);
  const planeCenterX = nebula?.transform?.position.x ?? 0;
  const planeCenterY = nebula?.transform?.position.y ?? 0;
  const maximumRoll = 6;
  const rollRadians = maximumRoll * Math.PI / 180;
  const rotatedWidthFactor = viewportAspect * Math.cos(rollRadians) + Math.sin(rollRadians);
  const rotatedHeightFactor = Math.cos(rollRadians) + viewportAspect * Math.sin(rollRadians);
  const maximumSafeDistance = Math.min(planeHalfHeight / (tangent * rotatedHeightFactor), planeHalfWidth / (tangent * rotatedWidthFactor));
  const maximumDistance = maximumSafeDistance * .82;
  const minimumDistance = maximumSafeDistance * .6;
  const minimumZoomDifference = maximumSafeDistance * .08;
  let previousDistance: number | undefined;

  const nextDistance = (): number => {
    if (previousDistance === undefined) return minimumDistance + random() * (maximumDistance - minimumDistance);
    const lowerMaximum = previousDistance - minimumZoomDifference;
    const upperMinimum = previousDistance + minimumZoomDifference;
    const canZoomIn = lowerMaximum >= minimumDistance;
    const canZoomOut = upperMinimum <= maximumDistance;
    if (canZoomOut && (!canZoomIn || random() >= .5)) return upperMinimum + random() * (maximumDistance - upperMinimum);
    return minimumDistance + random() * Math.max(0, lowerMaximum - minimumDistance);
  };

  const pose = (): CameraPathPose => {
    const distance = nextDistance();
    previousDistance = distance;
    const cameraZ = planeZ + distance;
    const visibleHalfHeight = distance * tangent;
    const visibleHalfWidth = visibleHalfHeight * viewportAspect;
    const worstCaseHalfWidth = visibleHalfWidth * Math.cos(rollRadians) + visibleHalfHeight * Math.sin(rollRadians);
    const worstCaseHalfHeight = visibleHalfHeight * Math.cos(rollRadians) + visibleHalfWidth * Math.sin(rollRadians);
    const safeX = Math.max(0, planeHalfWidth - worstCaseHalfWidth) * .82;
    const safeY = Math.max(0, planeHalfHeight - worstCaseHalfHeight) * .82;
    const x = planeCenterX + (random() * 2 - 1) * safeX;
    const y = planeCenterY + (random() * 2 - 1) * safeY;
    const roll = (random() * 2 - 1) * maximumRoll;
    return { position: [x, y, cameraZ], target: [x, y, targetZ], roll };
  };

  const poses = Array.from({ length: movementCount + 1 }, pose);
  return Array.from({ length: movementCount }, (_, index) => ({
    id: `random-${Date.now()}-${index + 1}`,
    path: {
      start: { ...poses[index], position: [...poses[index].position], target: [...poses[index].target] },
      end: { ...poses[index + 1], position: [...poses[index + 1].position], target: [...poses[index + 1].target] },
    },
    duration: Math.round((6.5 + random() * 4) * 2) / 2,
    easing: 'ease-in-out',
  }));
}
