import { VideoExportSettings } from './models';
import { videoCaptureBitrate } from './video-export';

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
