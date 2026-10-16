import { ImageOverlay, TextOverlay } from './models';
import { textOverlayOpacity } from './text-overlay';

describe('textOverlayOpacity', () => {
  const overlay: TextOverlay = { id: 'title', text: 'Orion', enabled: true, start: 2, duration: 6, fadeIn: 1, fadeOut: 2, x: .5, y: .5, fontFamily: 'Cabin', fontSize: 6, fontWeight: 600, letterSpacing: -.035, lineHeight: 1.2, color: '#ffffff', opacity: 1, alignment: 'center', shadow: true, background: false, motion: true };

  it('fades in, holds, and fades out inside its global time window', () => {
    expect(textOverlayOpacity(overlay, 1.9)).toBe(0);
    expect(textOverlayOpacity(overlay, 2.5)).toBeCloseTo(.5);
    expect(textOverlayOpacity(overlay, 4)).toBe(1);
    expect(textOverlayOpacity(overlay, 7)).toBeCloseTo(.5);
    expect(textOverlayOpacity(overlay, 8.1)).toBe(0);
  });

  it('hides disabled and empty overlays', () => {
    expect(textOverlayOpacity({ ...overlay, enabled: false }, 4)).toBe(0);
    expect(textOverlayOpacity({ ...overlay, text: '  ' }, 4)).toBe(0);
  });

  it('supports variable weight in the canvas font shorthand', () => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '600 32px Cabin, sans-serif';
    expect(context.font).toContain('600');
    expect(context.font).toContain('Cabin');
  });
});

describe('image overlay opacity', () => {
  const overlay: ImageOverlay = { id: 'logo', name: 'logo.png', dataUrl: 'data:image/png;base64,AA==', enabled: true, start: 2, duration: 4, fadeIn: 1, fadeOut: 1, x: .5, y: .5, size: 25, rotation: 0, opacity: .8 };
  it('uses the same timing and fades as captions', () => {
    expect(textOverlayOpacity(overlay, 1.9)).toBe(0);
    expect(textOverlayOpacity(overlay, 2.5)).toBe(.5);
    expect(textOverlayOpacity(overlay, 4)).toBe(1);
    expect(textOverlayOpacity(overlay, 5.5)).toBe(.5);
  });
});
