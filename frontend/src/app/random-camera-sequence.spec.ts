import { SceneDocument, VideoExportSettings } from './models';
import { createRandomCameraSequence } from './random-camera-sequence';

describe('createRandomCameraSequence', () => {
  const scene = {
    source: { width: 1600, height: 900 },
    camera: { position: [0, 0, 5], target: [0, 0, 0], fov: 45 },
    layers: [{ type: 'nebula', depth: -.35, transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }],
  } as SceneDocument;
  const video = { width: 1920, height: 1080, fps: 30, lightEffect: 'none' } as VideoExportSettings;

  it('creates five smooth movements whose adjoining poses are linked', () => {
    const values = [.2, .7, .1, .8, .4, .9]; let index = 0;
    const sequence = createRandomCameraSequence(scene, video, 5, () => values[index++ % values.length]);
    expect(sequence.length).toBe(5);
    expect(sequence.every(movement => movement.easing === 'ease-in-out')).toBeTrue();
    for (let index = 1; index < sequence.length; index++) expect(sequence[index].path.start).toEqual(sequence[index - 1].path.end);
    expect(sequence.some(movement => movement.path.start?.roll !== 0 || movement.path.end?.roll !== 0)).toBeTrue();
    const maximumSafeDistance = (5.35 * Math.tan(45 * Math.PI / 360)) / (Math.tan(45 * Math.PI / 360) * (Math.cos(6 * Math.PI / 180) + (1920 / 1080) * Math.sin(6 * Math.PI / 180)));
    for (const movement of sequence) expect(Math.abs(movement.path.end!.position[2] - movement.path.start!.position[2])).toBeGreaterThanOrEqual(maximumSafeDistance * .08 - 1e-10);
  });

  it('keeps every generated pose inside the starless plane', () => {
    const values = [0, 1, 0, 1, .25, .75, .9, .1]; let index = 0;
    const sequence = createRandomCameraSequence(scene, { ...video, width: 2560 }, 5, () => values[index++ % values.length]);
    const halfPlaneHeight = (5.35) * Math.tan(45 * Math.PI / 360);
    const halfPlaneWidth = halfPlaneHeight * (1600 / 900);
    for (const movement of sequence) for (const pose of [movement.path.start!, movement.path.end!]) {
      const halfViewHeight = (pose.position[2] + .35) * Math.tan(45 * Math.PI / 360);
      const halfViewWidth = halfViewHeight * (2560 / 1080);
      const radians = Math.abs(pose.roll ?? 0) * Math.PI / 180;
      const rotatedHalfWidth = halfViewWidth * Math.cos(radians) + halfViewHeight * Math.sin(radians);
      const rotatedHalfHeight = halfViewHeight * Math.cos(radians) + halfViewWidth * Math.sin(radians);
      expect(Math.abs(pose.target[0]) + rotatedHalfWidth).toBeLessThanOrEqual(halfPlaneWidth);
      expect(Math.abs(pose.target[1]) + rotatedHalfHeight).toBeLessThanOrEqual(halfPlaneHeight);
    }
  });
});
