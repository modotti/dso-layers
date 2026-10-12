import { TextOverlay } from './models';

export function textOverlayOpacity(overlay: TextOverlay, elapsed: number): number {
  if (!overlay.enabled || !overlay.text.trim() || elapsed < overlay.start || elapsed > overlay.start + overlay.duration) return 0;
  const local = elapsed - overlay.start;
  const fadeIn = overlay.fadeIn > 0 ? Math.min(1, local / overlay.fadeIn) : 1;
  const remaining = overlay.duration - local;
  const fadeOut = overlay.fadeOut > 0 ? Math.min(1, remaining / overlay.fadeOut) : 1;
  return Math.max(0, Math.min(fadeIn, fadeOut));
}
