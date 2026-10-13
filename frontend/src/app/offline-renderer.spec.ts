import { createFrameSchedule, DeterministicRenderer, FrameSink, RenderJobManifest, runRenderJob, videoRenderDimensions } from './offline-renderer';

describe('createFrameSchedule', () => {
  it('creates exact timestamped frames without adding the final still', () => {
    const frames = createFrameSchedule(1, 24);
    expect(frames.length).toBe(24);
    expect(frames[0].timeSeconds).toBe(0);
    expect(frames.at(-1)!.timeSeconds).toBeCloseTo(23 / 24);
    expect(frames.reduce((sum, frame) => sum + frame.durationMicroseconds, 0)).toBe(1_000_000);
  });

  it('uses the rounded duration contract', () => expect(createFrameSchedule(1.51, 30).length).toBe(45));

  it('bounds draft resolution while preserving full final resolution', () => {
    expect(videoRenderDimensions(3840, 2160, 'draft')).toEqual({ width: 1280, height: 720 });
    expect(videoRenderDimensions(1080, 1920, 'draft')).toEqual({ width: 406, height: 720 });
    expect(videoRenderDimensions(3840, 2160, 'final')).toEqual({ width: 3840, height: 2160 });
  });

  it('keeps timestamps exact when rendering is slower than playback', async () => {
    const timestamps: number[] = []; let clock = 0; let disposed = false;
    const renderer: DeterministicRenderer = { prepare: async () => undefined, renderFrameAt: async request => { clock += 100; return { source: {} as CanvasImageSource, timestampMicroseconds: request.timeSeconds * 1e6, durationMicroseconds: 0 }; }, dispose: async () => { disposed = true; } };
    const sink: FrameSink = { write: async frame => { timestamps.push(frame.timestampMicroseconds); }, close: async () => undefined, abort: async () => undefined };
    const manifest = { version: 1, scene: {} as RenderJobManifest['scene'], timeline: [{ id: 'a', duration: 5, easing: 'linear', path: { start: { position: [0, 0, 1], target: [0, 0, 0] }, end: { position: [1, 0, 1], target: [0, 0, 0] } } }], output: { width: 10, height: 10, fps: 2, quality: 'draft' } } satisfies RenderJobManifest;
    await runRenderJob(manifest, renderer, sink, { now: () => clock });
    expect(timestamps).toEqual([0, 500000, 1000000, 1500000, 2000000, 2500000, 3000000, 3500000, 4000000, 4500000]);
    expect(disposed).toBeTrue();
  });
});
