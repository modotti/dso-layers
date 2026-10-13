import { CameraMovement, TextOverlay } from './models';
import { createFrameSchedule, videoRenderDimensions } from './offline-renderer';
import { createTimelineEvaluator } from './timeline-evaluator';

describe('offline rendering validation matrix', () => {
  const resolutions = [
    [1920, 1080], [2560, 1440], [3840, 2160],
    [1080, 1080], [1080, 1920], [2560, 1080],
  ] as const;

  for (const [width, height] of resolutions) {
    it(`preserves final ${width}x${height} and bounds its draft`, () => {
      expect(videoRenderDimensions(width, height, 'final')).toEqual({ width, height });
      const draft = videoRenderDimensions(width, height, 'draft');
      expect(draft.width).toBeLessThanOrEqual(1280);
      expect(draft.height).toBeLessThanOrEqual(720);
      expect(draft.width % 2).toBe(0);
      expect(draft.height % 2).toBe(0);
      expect(draft.width / draft.height).toBeCloseTo(width / height, 2);
    });
  }

  for (const fps of [24, 30, 60]) {
    it(`schedules an exact five-second ${fps} fps stream`, () => {
      const frames = createFrameSchedule(5, fps);
      expect(frames.length).toBe(5 * fps);
      expect(frames.at(-1)!.timeSeconds).toBeCloseTo(5 - 1 / fps, 8);
      expect(frames.reduce((total, frame) => total + frame.durationMicroseconds, 0)).toBe(5_000_000);
    });
  }

  it('keeps focus pulls and overlays deterministic across a movement boundary', () => {
    const movement = (id: string, from: number, to: number): CameraMovement => ({ id, duration: 5, easing: 'linear', path: { start: { position: [from, 0, 5], target: [0, 0, 0], focusDistance: from + 3 }, end: { position: [to, 0, 5], target: [0, 0, 0], focusDistance: to + 3 } } });
    const overlay: TextOverlay = { id: 'caption', text: 'Boundary', enabled: true, start: 4, duration: 2, fadeIn: 1, fadeOut: 1, x: .5, y: .5, fontFamily: 'Cabin', fontSize: 4, fontWeight: 600, letterSpacing: 0, lineHeight: 1, color: '#fff', opacity: 1, alignment: 'center', shadow: false, background: false, motion: true };
    const evaluate = createTimelineEvaluator([movement('one', 0, 5), movement('two', 5, 10)], { flow: 'per-movement', transitionMomentum: 0, overlays: [overlay] });
    expect(evaluate(4.5).focusDistance).toBeCloseTo(7.5);
    expect(evaluate(5).focusDistance).toBe(8);
    expect(evaluate(5).overlays[0]).toEqual({ id: 'caption', opacity: 1, motionProgress: 1 });
    expect(evaluate(5)).toEqual(evaluate(5));
  });
});
