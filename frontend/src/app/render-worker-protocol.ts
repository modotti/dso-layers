import { RenderJobEvent, RenderJobManifest } from './render-job';
import { RenderWorkerError } from './render-worker';

export const RENDER_WORKER_PROTOCOL_VERSION = 1 as const;

export type RenderWorkerCommand =
  | { protocolVersion: 1; type: 'submit'; manifest: RenderJobManifest }
  | { protocolVersion: 1; type: 'cancel'; jobId: string }
  | { protocolVersion: 1; type: 'shutdown' };

export type RenderWorkerMessage =
  | { protocolVersion: 1; type: 'event'; event: RenderJobEvent }
  | { protocolVersion: 1; type: 'completed'; jobId: string; outputUri: string }
  | { protocolVersion: 1; type: 'failed'; jobId: string; error: RenderWorkerError };

export function isRenderWorkerCommand(value: unknown): value is RenderWorkerCommand {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RenderWorkerCommand>;
  if (candidate.protocolVersion !== RENDER_WORKER_PROTOCOL_VERSION) return false;
  if (candidate.type === 'shutdown') return true;
  if (candidate.type === 'cancel') return typeof candidate.jobId === 'string' && candidate.jobId.length > 0;
  return candidate.type === 'submit' && !!candidate.manifest && candidate.manifest.version === 1 && typeof candidate.manifest.jobId === 'string';
}

export function isRenderWorkerMessage(value: unknown): value is RenderWorkerMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RenderWorkerMessage>;
  if (candidate.protocolVersion !== RENDER_WORKER_PROTOCOL_VERSION) return false;
  if (candidate.type === 'event') return !!candidate.event && typeof candidate.event.jobId === 'string';
  if (candidate.type === 'completed') return typeof candidate.jobId === 'string' && typeof candidate.outputUri === 'string';
  return candidate.type === 'failed' && typeof candidate.jobId === 'string' && !!candidate.error && typeof candidate.error.code === 'string';
}
