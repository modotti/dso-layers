import { RenderJobManifest } from './render-job';
import { InProcessRenderWorker } from './render-worker';

describe('InProcessRenderWorker', () => {
  const manifest = { version: 1, jobId: 'job-1', scene: {}, assets: [], timeline: { movements: [], flow: 'per-movement', transitionMomentum: 0, overlays: [] }, output: { width: 2, height: 2, fps: 30, quality: 'draft', lightEffect: 'none' } } as unknown as RenderJobManifest;

  it('reports queued state and returns the executor result', async () => {
    const events: string[] = [];
    const handle = new InProcessRenderWorker<string>().submit(manifest, async (_, context) => { context.emit({ jobId: 'job-1', status: 'preparing', renderedFrames: 0, totalFrames: 10 }); return 'video.mp4'; }, event => events.push(event.status));
    expect(await handle.result).toEqual({ ok: true, jobId: 'job-1', value: 'video.mp4' });
    expect(events).toEqual(['queued', 'preparing']);
  });

  it('cooperatively cancels an active job with a structured error', async () => {
    const worker = new InProcessRenderWorker<string>();
    const handle = worker.submit(manifest, async (_, context) => new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })));
    await handle.cancel();
    expect(await handle.result).toEqual({ ok: false, jobId: 'job-1', error: { code: 'cancelled', message: 'Render cancelled.' } });
  });

  it('rejects duplicate active job identifiers', async () => {
    const worker = new InProcessRenderWorker<string>();
    const first = worker.submit(manifest, async (_, context) => new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })));
    const duplicate = worker.submit(manifest, async () => 'unexpected');
    expect(await duplicate.result).toEqual({ ok: false, jobId: 'job-1', error: { code: 'duplicate_job', message: 'Render job job-1 is already active.' } });
    await first.cancel(); await first.result;
  });

  it('times out a worker that stops reporting progress', async () => {
    const worker = new InProcessRenderWorker<string>(5);
    const handle = worker.submit(manifest, async (_, context) => new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })));
    expect(await handle.result).toEqual({ ok: false, jobId: 'job-1', error: { code: 'worker_timeout', message: 'Render worker stopped reporting progress.' } });
  });

  it('shuts down active and future jobs', async () => {
    const worker = new InProcessRenderWorker<string>();
    const active = worker.submit(manifest, async (_, context) => new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })));
    await worker.shutdown();
    expect(await active.result).toEqual({ ok: false, jobId: 'job-1', error: { code: 'worker_shutdown', message: 'Render worker was shut down.' } });
    expect(await worker.submit({ ...manifest, jobId: 'job-2' }, async () => 'unexpected').result).toEqual({ ok: false, jobId: 'job-2', error: { code: 'worker_shutdown', message: 'Render worker is shut down.' } });
  });
});
