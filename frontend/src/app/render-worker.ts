import { RenderJobEvent, RenderJobManifest } from './render-job';

export type RenderWorkerErrorCode = 'cancelled' | 'duplicate_job' | 'execution_failed' | 'worker_timeout' | 'worker_shutdown';
export interface RenderWorkerError { code: RenderWorkerErrorCode; message: string }
export type RenderWorkerOutcome<T> = { ok: true; jobId: string; value: T } | { ok: false; jobId: string; error: RenderWorkerError };
export interface RenderWorkerContext { signal: AbortSignal; emit(event: RenderJobEvent): void }
export type RenderWorkerExecutor<T> = (manifest: RenderJobManifest, context: RenderWorkerContext) => Promise<T>;
export interface RenderWorkerHandle<T> { jobId: string; result: Promise<RenderWorkerOutcome<T>>; cancel(): Promise<void> }
export interface RenderWorkerAdapter<T> { submit(manifest: RenderJobManifest, executor: RenderWorkerExecutor<T>, onEvent?: (event: RenderJobEvent) => void): RenderWorkerHandle<T>; shutdown(): Promise<void> }

class WorkerInterruption extends Error {
  constructor(readonly code: 'cancelled' | 'worker_timeout' | 'worker_shutdown', message: string) { super(message); this.name = 'WorkerInterruption'; }
}

interface ActiveJob { controller: AbortController; timeout?: ReturnType<typeof setTimeout> }

/** In-process adapter implementing the same narrow contract expected from desktop IPC. */
export class InProcessRenderWorker<T> implements RenderWorkerAdapter<T> {
  private readonly active = new Map<string, ActiveJob>();
  private stopped = false;
  constructor(private readonly idleTimeoutMs = 0) {}

  submit(manifest: RenderJobManifest, executor: RenderWorkerExecutor<T>, onEvent?: (event: RenderJobEvent) => void): RenderWorkerHandle<T> {
    const jobId = manifest.jobId;
    if (this.stopped) return this.rejected(jobId, 'worker_shutdown', 'Render worker is shut down.');
    if (this.active.has(jobId)) return this.rejected(jobId, 'duplicate_job', `Render job ${jobId} is already active.`);
    const job: ActiveJob = { controller: new AbortController() };
    this.active.set(jobId, job);
    const armTimeout = () => { if (!this.idleTimeoutMs) return; clearTimeout(job.timeout); job.timeout = setTimeout(() => job.controller.abort(new WorkerInterruption('worker_timeout', 'Render worker stopped reporting progress.')), this.idleTimeoutMs); };
    const emit = (event: RenderJobEvent) => { if (event.jobId === jobId) { armTimeout(); onEvent?.(event); } };
    emit({ jobId, status: 'queued', renderedFrames: 0, totalFrames: 0 });
    const result = (async (): Promise<RenderWorkerOutcome<T>> => {
      try {
        const value = await executor(manifest, { signal: job.controller.signal, emit });
        return { ok: true, jobId, value };
      } catch (error) {
        const reason = job.controller.signal.reason;
        if (reason instanceof WorkerInterruption) return { ok: false, jobId, error: { code: reason.code, message: reason.message } };
        const cancelled = job.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
        return { ok: false, jobId, error: { code: cancelled ? 'cancelled' : 'execution_failed', message: cancelled ? 'Render cancelled.' : error instanceof Error ? error.message : String(error) } };
      } finally {
        clearTimeout(job.timeout); this.active.delete(jobId);
      }
    })();
    return { jobId, result, cancel: async () => job.controller.abort(new WorkerInterruption('cancelled', 'Render cancelled.')) };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const job of this.active.values()) job.controller.abort(new WorkerInterruption('worker_shutdown', 'Render worker was shut down.'));
  }

  private rejected(jobId: string, code: RenderWorkerErrorCode, message: string): RenderWorkerHandle<T> {
    return { jobId, result: Promise.resolve({ ok: false, jobId, error: { code, message } }), cancel: async () => undefined };
  }
}
