import { SceneLayer } from './models';
import { separatedLayerDepth } from './layer-depth';

describe('separatedLayerDepth', () => {
  const layer = (type: SceneLayer['type'], depth: number) =>
    ({ type, depth }) as SceneLayer;
  const anchorDepth = -0.35;

  it('keeps the starless plane fixed at every separation', () => {
    const starless = layer('nebula', anchorDepth);
    expect(separatedLayerDepth(starless, anchorDepth, 0)).toBe(anchorDepth);
    expect(separatedLayerDepth(starless, anchorDepth, 1)).toBe(anchorDepth);
    expect(separatedLayerDepth(starless, anchorDepth, 3)).toBe(anchorDepth);
  });

  it('collapses star layers onto the starless plane at zero separation', () => {
    expect(separatedLayerDepth(layer('stars', 0.15), anchorDepth, 0)).toBe(
      anchorDepth,
    );
  });

  it('preserves authored depths at 1x and expands each star layer proportionally', () => {
    const distant = layer('stars', -0.15);
    const near = layer('stars', 0.45);
    expect(separatedLayerDepth(distant, anchorDepth, 1)).toBeCloseTo(-0.15);
    expect(separatedLayerDepth(near, anchorDepth, 1)).toBeCloseTo(0.45);
    expect(separatedLayerDepth(distant, anchorDepth, 3)).toBeCloseTo(0.25);
    expect(separatedLayerDepth(near, anchorDepth, 3)).toBeCloseTo(2.05);
  });
});
