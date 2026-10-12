import { cinematicPathPhase } from './camera-path-flow';

describe('cinematicPathPhase', () => {
  it('keeps every movement boundary fixed', () => {
    expect(cinematicPathPhase(0, 3, 0.55)).toBe(0);
    expect(cinematicPathPhase(1 / 3, 3, 0.55)).toBeCloseTo(1 / 3);
    expect(cinematicPathPhase(2 / 3, 3, 0.55)).toBeCloseTo(2 / 3);
    expect(cinematicPathPhase(1, 3, 0.55)).toBe(1);
  });

  it('moves faster near joins and slower through segment middles', () => {
    const nearStart = cinematicPathPhase(0.05, 1, 0.55);
    const nearMiddle = cinematicPathPhase(0.55, 1, 0.55) - 0.5;
    expect(nearStart).toBeGreaterThan(0.05);
    expect(nearMiddle).toBeLessThan(0.05);
  });

  it('remains monotonic at maximum supported momentum', () => {
    const samples = Array.from({ length: 101 }, (_, index) =>
      cinematicPathPhase(index / 100, 4, 0.9),
    );
    expect(samples.every((value, index) => !index || value >= samples[index - 1])).toBeTrue();
  });
});
