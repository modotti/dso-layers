import { SceneDocument } from './models';
import { canTransitionRenderJob, createRenderJobManifest } from './render-job';

describe('render job contract', () => {
  const scene = {
    schemaVersion: 1, name: 'Test', source: {}, conventions: {}, camera: {}, processing: {},
    layers: [{ id: 'nebula', texture_url: '/media/color.png', depth_texture_url: '/media/depth.png' }],
  } as unknown as SceneDocument;

  it('creates a serializable immutable snapshot with resolved assets', () => {
    const movements = [{ id: 'move', duration: 5, easing: 'linear', path: {} }] as const;
    const manifest = createRenderJobManifest({ jobId: 'job-1', scene, movements: [...movements], flow: 'continuous', transitionMomentum: .4, overlays: [], output: { width: 1920, height: 1080, fps: 30, quality: 'final', lightEffect: 'none' }, baseUri: 'http://localhost:4200/' });
    scene.name = 'Changed';
    expect(manifest.scene.name).toBe('Test');
    expect(manifest.assets.map(asset => asset.uri)).toEqual(['http://localhost:4200/media/color.png', 'http://localhost:4200/media/depth.png']);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('only permits forward lifecycle transitions', () => {
    expect(canTransitionRenderJob('queued', 'preparing')).toBeTrue();
    expect(canTransitionRenderJob('rendering', 'encoding')).toBeTrue();
    expect(canTransitionRenderJob('encoding', 'completed')).toBeTrue();
    expect(canTransitionRenderJob('completed', 'rendering')).toBeFalse();
    expect(canTransitionRenderJob('failed', 'preparing')).toBeFalse();
  });
});
