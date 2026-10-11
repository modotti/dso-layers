import { CameraMovement, CameraPathPose, SceneDocument, VideoExportSettings } from './models';

export function createRandomCameraSequence(
  scene: SceneDocument,
  video: VideoExportSettings,
  count = 5,
  random: () => number = Math.random,
  separation = 1,
): CameraMovement[] {
  const movementCount = Math.max(1, Math.min(5, Math.floor(count)));
  const nebula = scene.layers.find(layer => layer.type === 'nebula');
  const nebulaDepth = (nebula?.depth ?? 0) * separation;
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
  const maximumSafeDistance = Math.min(planeHalfHeight / tangent, planeHalfWidth / (tangent * viewportAspect));
  const maximumDistance = maximumSafeDistance * .82;
  const minimumDistance = maximumSafeDistance * .6;

  const pose = (): CameraPathPose => {
    const distance = minimumDistance + random() * (maximumDistance - minimumDistance);
    const cameraZ = planeZ + distance;
    const visibleHalfHeight = distance * tangent;
    const visibleHalfWidth = visibleHalfHeight * viewportAspect;
    const safeX = Math.max(0, planeHalfWidth - visibleHalfWidth) * .82;
    const safeY = Math.max(0, planeHalfHeight - visibleHalfHeight) * .82;
    const x = planeCenterX + (random() * 2 - 1) * safeX;
    const y = planeCenterY + (random() * 2 - 1) * safeY;
    return { position: [x, y, cameraZ], target: [x, y, targetZ], roll: 0 };
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
