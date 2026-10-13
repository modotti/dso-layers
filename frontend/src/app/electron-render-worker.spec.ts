import { ElectronRenderWorkerBridge, ElectronRenderWorkerClient } from './electron-render-worker';
import { RenderJobManifest } from './render-job';
import { RenderWorkerCommand } from './render-worker-protocol';

describe('ElectronRenderWorkerClient', () => {
  const manifest = { version: 1, jobId: 'desktop-job' } as RenderJobManifest;
  let sent: RenderWorkerCommand[]; let listener: (message: unknown) => void; let bridge: ElectronRenderWorkerBridge;

  beforeEach(() => {
    sent = [];
    bridge = { send: command => sent.push(command), subscribe: callback => { listener = callback; return () => undefined; }, saveOutput: async () => '/videos/export.mp4' };
  });

  it('submits a manifest and resolves the desktop output path', async () => {
    const client = new ElectronRenderWorkerClient(bridge); const events: string[] = [];
    const handle = client.submit(manifest, event => events.push(event.status));
    expect(sent[0]).toEqual({ protocolVersion: 1, type: 'submit', manifest });
    listener({ protocolVersion: 1, type: 'event', event: { jobId: 'desktop-job', status: 'rendering', renderedFrames: 1, totalFrames: 2 } });
    listener({ protocolVersion: 1, type: 'completed', jobId: 'desktop-job', outputUri: '/tmp/video.mp4' });
    expect(await handle.result).toEqual({ ok: true, jobId: 'desktop-job', value: '/tmp/video.mp4' });
    expect(events).toEqual(['rendering']);
  });

  it('forwards cancellation and isolates a worker crash', async () => {
    const client = new ElectronRenderWorkerClient(bridge); const handle = client.submit(manifest);
    await handle.cancel();
    expect(sent.at(-1)).toEqual({ protocolVersion: 1, type: 'cancel', jobId: 'desktop-job' });
    listener({ protocolVersion: 1, type: 'failed', jobId: '*', error: { code: 'execution_failed', message: 'Worker crashed.' } });
    expect(await handle.result).toEqual({ ok: false, jobId: 'desktop-job', error: { code: 'execution_failed', message: 'Worker crashed.' } });
  });

  it('streams one frame at a time with worker acknowledgement', async () => {
    const client = new ElectronRenderWorkerClient(bridge); client.submit(manifest);
    const written = client.writeFrame('desktop-job', 3, new Uint8Array([255, 216, 255, 217]));
    expect(sent.at(-1)?.type).toBe('frame');
    listener({ protocolVersion: 1, type: 'frame-accepted', jobId: 'desktop-job', index: 3 });
    await expectAsync(written).toBeResolved();
    client.finish('desktop-job');
    expect(sent.at(-1)).toEqual({ protocolVersion: 1, type: 'finish', jobId: 'desktop-job' });
  });

  it('asks the desktop shell to save a completed output', async () => {
    const client = new ElectronRenderWorkerClient(bridge);
    await expectAsync(client.saveOutput('/tmp/video.mp4', 'scene.mp4')).toBeResolvedTo('/videos/export.mp4');
  });
});
