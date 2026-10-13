import { VideoExportSettings } from './models';
import { outputViewportProjection, videoCaptureBitrate } from './video-export';

describe('videoCaptureBitrate', () => {
  const settings = (width: number, height: number, fps: number): VideoExportSettings => ({ width, height, fps, lightEffect: 'none' });

  it('scales the bitrate with resolution and frame rate', () => {
    expect(videoCaptureBitrate(settings(1920, 1080, 30))).toBe(25_000_000);
    expect(videoCaptureBitrate(settings(1920, 1080, 60))).toBe(50_000_000);
    expect(videoCaptureBitrate(settings(3840, 2160, 30))).toBe(100_000_000);
  });

  it('keeps small exports above the quality floor', () => {
    expect(videoCaptureBitrate(settings(1080, 1080, 24))).toBe(12_000_000);
  });
});

describe('outputViewportProjection', () => {
  it('describes the centered landscape crop shown in the editor', () => {
    expect(outputViewportProjection(1200, 900, 1920, 1080)).toEqual({
      fullWidth: 1200,
      fullHeight: 900,
      x: 120,
      y: 180,
      width: 960,
      height: 540,
    });
  });

  it('describes the centered portrait crop shown in the editor', () => {
    expect(outputViewportProjection(1200, 900, 1080, 1920)).toEqual({
      fullWidth: 1200,
      fullHeight: 900,
      x: 398,
      y: 90,
      width: 405,
      height: 720,
    });
  });
});
