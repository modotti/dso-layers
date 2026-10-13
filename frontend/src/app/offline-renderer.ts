import { CameraMovement, SceneDocument } from './models';
import { RenderJobEvent, RenderJobManifest } from './render-job';
export { RenderJobManifest } from './render-job';

export type RenderQuality = 'draft' | 'final';
export interface FrameRenderRequest { timeSeconds: number; width: number; height: number; quality: RenderQuality }
export interface RenderedFrame { source: CanvasImageSource; timestampMicroseconds: number; durationMicroseconds: number }
export interface DeterministicRenderer {
  prepare(scene: SceneDocument, timeline: CameraMovement[]): Promise<void>;
  renderFrameAt(request: FrameRenderRequest): Promise<RenderedFrame>;
  dispose(): Promise<void>;
}
export interface FrameScheduleEntry { index: number; timeSeconds: number; timestampMicroseconds: number; durationMicroseconds: number }

export function videoRenderDimensions(width: number, height: number, quality: RenderQuality): { width: number; height: number } {
  const scale = quality === 'draft' ? Math.min(1, 1280 / width, 720 / height) : 1;
  return { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) };
}

export function createFrameSchedule(durationSeconds: number, fps: number): FrameScheduleEntry[] {
  const safeFps = Math.max(1, Math.round(fps));
  const count = Math.max(0, Math.round(Math.max(0, durationSeconds) * safeFps));
  return Array.from({ length: count }, (_, index) => ({
    index,
    timeSeconds: index / safeFps,
    timestampMicroseconds: Math.round(index * 1_000_000 / safeFps),
    durationMicroseconds: Math.round((index + 1) * 1_000_000 / safeFps) - Math.round(index * 1_000_000 / safeFps),
  }));
}

export interface FrameSink {
  write(frame: RenderedFrame): Promise<void>;
  close(signal?: AbortSignal): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface RenderProgress { renderedFrames: number; totalFrames: number; renderSeconds: number }
export interface RunRenderJobOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  onEvent?: (event: RenderJobEvent) => void;
  now?: () => number;
}

/** Streams frames with bounded memory; renderer and sink own their resources. */
export async function runRenderJob(
  manifest: RenderJobManifest,
  renderer: DeterministicRenderer,
  sink: FrameSink,
  options: RunRenderJobOptions = {},
): Promise<void> {
  const schedule = createFrameSchedule(manifest.timeline.movements.reduce((sum, item) => sum + Math.max(5, Math.min(20, item.duration)), 0), manifest.output.fps);
  const now = options.now ?? (() => performance.now()); const started = now();
  let renderedFrames = 0;
  const emit = (status: RenderJobEvent['status'], message?: string) => options.onEvent?.({ jobId: manifest.jobId, status, renderedFrames, totalFrames: schedule.length, message });
  const checkCancelled = () => { if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Render cancelled', 'AbortError'); };
  try {
    emit('preparing');
    checkCancelled(); await renderer.prepare(manifest.scene, manifest.timeline.movements);
    emit('rendering');
    for (const item of schedule) {
      checkCancelled();
      const frame = await renderer.renderFrameAt({ timeSeconds: item.timeSeconds, width: manifest.output.width, height: manifest.output.height, quality: manifest.output.quality });
      checkCancelled(); await sink.write({ ...frame, timestampMicroseconds: item.timestampMicroseconds, durationMicroseconds: item.durationMicroseconds });
      renderedFrames = item.index + 1;
      options.onProgress?.({ renderedFrames: item.index + 1, totalFrames: schedule.length, renderSeconds: (now() - started) / 1000 });
      emit('rendering');
    }
    checkCancelled(); emit('encoding'); await sink.close(options.signal); checkCancelled(); emit('completed');
  } catch (error) {
    await sink.abort(error);
    const cancelled = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
    emit(cancelled ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await renderer.dispose();
  }
}
