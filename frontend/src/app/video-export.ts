import { VideoExportSettings } from './models';

const BITS_PER_PIXEL_PER_FRAME = .4;
const MIN_VIDEO_BITRATE = 12_000_000;
const MAX_VIDEO_BITRATE = 100_000_000;

export function videoCaptureBitrate(settings: VideoExportSettings): number {
  const estimated = settings.width * settings.height * settings.fps * BITS_PER_PIXEL_PER_FRAME;
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, estimated)) / 1_000_000) * 1_000_000;
}
