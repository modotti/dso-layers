import { VideoExportSettings } from './models';

const BITS_PER_PIXEL_PER_FRAME = .4;
const MIN_VIDEO_BITRATE = 12_000_000;
const MAX_VIDEO_BITRATE = 100_000_000;

export interface OutputViewportProjection {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function outputViewportProjection(
  hostWidth: number,
  hostHeight: number,
  outputWidth: number,
  outputHeight: number,
): OutputViewportProjection {
  const fullWidth = Math.max(1, hostWidth);
  const fullHeight = Math.max(1, hostHeight);
  const availableWidth = fullWidth * .8;
  const availableHeight = fullHeight * .8;
  const aspect = Math.max(1, outputWidth) / Math.max(1, outputHeight);
  const width = Math.max(1, Math.round(Math.min(availableWidth, availableHeight * aspect)));
  const height = Math.max(1, Math.round(width / aspect));

  return {
    fullWidth,
    fullHeight,
    x: Math.round((fullWidth - width) / 2),
    y: Math.round((fullHeight - height) / 2),
    width,
    height,
  };
}

export function videoCaptureBitrate(settings: VideoExportSettings): number {
  const estimated = settings.width * settings.height * settings.fps * BITS_PER_PIXEL_PER_FRAME;
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, estimated)) / 1_000_000) * 1_000_000;
}
