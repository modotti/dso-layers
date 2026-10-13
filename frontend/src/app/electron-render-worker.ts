import { RenderJobEvent, RenderJobManifest } from './render-job';
import { RenderWorkerError, RenderWorkerHandle, RenderWorkerOutcome } from './render-worker';
import { isRenderWorkerMessage, RenderWorkerCommand, RenderWorkerMessage } from './render-worker-protocol';

export interface ElectronRenderWorkerBridge {
  send(command: RenderWorkerCommand): void;
  subscribe(listener: (message: unknown) => void): () => void;
  saveOutput(sourcePath: string, suggestedName: string): Promise<string | null>;
}

declare global { interface Window { astroRenderWorker?: ElectronRenderWorkerBridge } }

interface PendingJob {
  resolve(outcome: RenderWorkerOutcome<string>): void;
  onEvent?: (event: RenderJobEvent) => void;
}

/** Renderer-side IPC client. Electron and Tauri adapters can share the same public shape. */
export class ElectronRenderWorkerClient {
  private readonly pending = new Map<string, PendingJob>();
  private readonly pendingFrames = new Map<string, { resolve(): void; reject(error: Error): void }>();
  private readonly unsubscribe: () => void;

  constructor(private readonly bridge: ElectronRenderWorkerBridge) {
    this.unsubscribe = bridge.subscribe(message => this.receive(message));
  }

  submit(manifest: RenderJobManifest, onEvent?: (event: RenderJobEvent) => void): RenderWorkerHandle<string> {
    const jobId = manifest.jobId;
    const result = new Promise<RenderWorkerOutcome<string>>(resolve => this.pending.set(jobId, { resolve, onEvent }));
    this.bridge.send({ protocolVersion: 1, type: 'submit', manifest });
    return { jobId, result, cancel: async () => this.bridge.send({ protocolVersion: 1, type: 'cancel', jobId }) };
  }

  async writeFrame(jobId: string, index: number, frame: Blob | Uint8Array): Promise<void> {
    const key = `${jobId}:${index}`;
    const accepted = new Promise<void>((resolve, reject) => this.pendingFrames.set(key, { resolve, reject }));
    const jpeg = frame instanceof Uint8Array ? frame : new Uint8Array(await frame.arrayBuffer());
    this.bridge.send({ protocolVersion: 1, type: 'frame', jobId, index, jpeg });
    return accepted;
  }

  finish(jobId: string): void { this.bridge.send({ protocolVersion: 1, type: 'finish', jobId }); }

  saveOutput(sourcePath: string, suggestedName: string): Promise<string | null> { return this.bridge.saveOutput(sourcePath, suggestedName); }

  async shutdown(): Promise<void> {
    this.unsubscribe();
    const error: RenderWorkerError = { code: 'worker_shutdown', message: 'Render worker was shut down.' };
    for (const [jobId, job] of this.pending) job.resolve({ ok: false, jobId, error });
    this.pending.clear();
  }

  private receive(value: unknown): void {
    if (!isRenderWorkerMessage(value)) return;
    const message: RenderWorkerMessage = value;
    if (message.type === 'event') { this.pending.get(message.event.jobId)?.onEvent?.(message.event); return; }
    if (message.type === 'frame-accepted') { const frame = this.pendingFrames.get(`${message.jobId}:${message.index}`); frame?.resolve(); this.pendingFrames.delete(`${message.jobId}:${message.index}`); return; }
    if (message.jobId === '*') { for (const [jobId, job] of this.pending) job.resolve({ ok: false, jobId, error: message.type === 'failed' ? message.error : { code: 'execution_failed', message: 'Render worker stopped.' } }); this.pending.clear(); return; }
    const job = this.pending.get(message.jobId); if (!job) return;
    this.pending.delete(message.jobId);
    if (message.type === 'completed') job.resolve({ ok: true, jobId: message.jobId, value: message.outputUri });
    else { job.resolve({ ok: false, jobId: message.jobId, error: message.error }); for (const [key, frame] of this.pendingFrames) if (key.startsWith(`${message.jobId}:`)) { frame.reject(new Error(message.error.message)); this.pendingFrames.delete(key); } }
  }
}
