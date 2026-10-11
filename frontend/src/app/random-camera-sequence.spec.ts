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
    const sequence = createRandomCameraSequence(scene, video, 5, () => .5);
    expect(sequence.length).toBe(5);
    expect(sequence.every(movement => movement.easing === 'ease-in-out')).toBeTrue();
    for (let index = 1; index < sequence.length; index++) expect(sequence[index].path.start).toEqual(sequence[index - 1].path.end);
  });

  it('keeps every generated pose inside the starless plane', () => {
    const values = [0, 1, 0, 1, .25, .75, .9, .1]; let index = 0;
    const sequence = createRandomCameraSequence(scene, { ...video, width: 2560 }, 5, () => values[index++ % values.length]);
    const halfPlaneHeight = (5.35) * Math.tan(45 * Math.PI / 360);
    const halfPlaneWidth = halfPlaneHeight * (1600 / 900);
    for (const movement of sequence) for (const pose of [movement.path.start!, movement.path.end!]) {
      const halfViewHeight = (pose.position[2] + .35) * Math.tan(45 * Math.PI / 360);
      const halfViewWidth = halfViewHeight * (2560 / 1080);
      expect(Math.abs(pose.target[0]) + halfViewWidth).toBeLessThanOrEqual(halfPlaneWidth);
      expect(Math.abs(pose.target[1]) + halfViewHeight).toBeLessThanOrEqual(halfPlaneHeight);
    }
  });
});
