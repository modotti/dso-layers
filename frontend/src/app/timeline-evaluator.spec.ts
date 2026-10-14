import { CameraMovement, TextOverlay } from './models';
import { createTimelineEvaluator, timelineMovementIndex } from './timeline-evaluator';

describe('createTimelineEvaluator', () => {
  const movement = (id: string, from: number, to: number, duration = 5): CameraMovement => ({ id, duration, easing: 'linear', path: { start: { position: [from, 0, 5], target: [0, 0, 0], roll: from, focusDistance: from + 2 }, end: { position: [to, 0, 5], target: [1, 0, 0], roll: to, focusDistance: to + 2 } } });
  const overlay: TextOverlay = { id: 'title', text: 'Title', enabled: true, start: 1, duration: 3, fadeIn: 1, fadeOut: 1, x: .5, y: .5, fontFamily: 'Cabin', fontSize: 4, fontWeight: 600, letterSpacing: 0, lineHeight: 1, color: '#fff', opacity: .8, alignment: 'center', shadow: false, background: false, motion: true };

  it('is identical in sequential and random evaluation order', () => {
    const evaluate = createTimelineEvaluator([movement('a', 0, 10), movement('b', 10, 20)], { flow: 'per-movement', transitionMomentum: .55, overlays: [overlay] });
    const sequential = [0, 2.5, 5, 7.5, 10].map(evaluate);
    expect([7.5, 0, 10, 2.5, 5].map(evaluate)).toEqual([sequential[3], sequential[0], sequential[4], sequential[1], sequential[2]]);
  });

  it('defines movement boundaries and the final state exactly', () => {
    const evaluate = createTimelineEvaluator([movement('a', 0, 10), movement('b', 10, 20)], { flow: 'per-movement', transitionMomentum: .55 });
    expect(evaluate(5).position).toEqual([10, 0, 5]);
    expect(evaluate(10).position).toEqual([20, 0, 5]);
    expect(evaluate(10).complete).toBeTrue();
  });

  it('evaluates continuous camera, focus, and overlays from time alone', () => {
    const evaluate = createTimelineEvaluator([movement('a', 0, 10)], { flow: 'continuous', transitionMomentum: .55, overlays: [overlay] });
    expect(evaluate(0).position).toEqual([0, 0, 5]);
    expect(evaluate(2.5).focusDistance).toBeCloseTo(5.75);
    expect(evaluate(2).overlays[0].opacity).toBeCloseTo(.8);
    expect(evaluate(5).position).toEqual([10, 0, 5]);
  });

  it('identifies the active movement at timeline boundaries', () => {
    const movements = [movement('a', 0, 10, 1), movement('b', 10, 20, 2), movement('c', 20, 30, 3)];
    expect(timelineMovementIndex(movements, 0)).toBe(0);
    expect(timelineMovementIndex(movements, .999)).toBe(0);
    expect(timelineMovementIndex(movements, 1)).toBe(1);
    expect(timelineMovementIndex(movements, 3)).toBe(2);
    expect(timelineMovementIndex(movements, 99)).toBe(2);
  });
});
