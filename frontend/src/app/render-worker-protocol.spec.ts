import { RenderJobManifest } from './render-job';
import { isRenderWorkerCommand, isRenderWorkerMessage, RENDER_WORKER_PROTOCOL_VERSION, RenderWorkerCommand, RenderWorkerMessage } from './render-worker-protocol';

describe('render worker IPC protocol', () => {
  const manifest = { version: 1, jobId: 'job-1' } as RenderJobManifest;

  it('round-trips versioned commands through JSON', () => {
    const commands: RenderWorkerCommand[] = [
      { protocolVersion: RENDER_WORKER_PROTOCOL_VERSION, type: 'submit', manifest },
      { protocolVersion: RENDER_WORKER_PROTOCOL_VERSION, type: 'frame', jobId: 'job-1', index: 0, jpeg: new Uint8Array([255, 216, 255, 217]) },
      { protocolVersion: RENDER_WORKER_PROTOCOL_VERSION, type: 'finish', jobId: 'job-1' },
      { protocolVersion: RENDER_WORKER_PROTOCOL_VERSION, type: 'cancel', jobId: 'job-1' },
      { protocolVersion: RENDER_WORKER_PROTOCOL_VERSION, type: 'shutdown' },
    ];
    for (const command of commands) {
      const roundTripped = structuredClone(command);
      expect(isRenderWorkerCommand(roundTripped)).toBeTrue();
    }
  });

  it('round-trips events, results, and failures through JSON', () => {
    const messages: RenderWorkerMessage[] = [
      { protocolVersion: 1, type: 'event', event: { jobId: 'job-1', status: 'rendering', renderedFrames: 12, totalFrames: 120 } },
      { protocolVersion: 1, type: 'frame-accepted', jobId: 'job-1', index: 12 },
      { protocolVersion: 1, type: 'completed', jobId: 'job-1', outputUri: '/exports/job-1.mp4' },
      { protocolVersion: 1, type: 'failed', jobId: 'job-1', error: { code: 'execution_failed', message: 'FFmpeg exited.' } },
    ];
    for (const message of messages) expect(isRenderWorkerMessage(JSON.parse(JSON.stringify(message)))).toBeTrue();
  });

  it('rejects incompatible versions and malformed payloads', () => {
    expect(isRenderWorkerCommand({ protocolVersion: 2, type: 'shutdown' })).toBeFalse();
    expect(isRenderWorkerCommand({ protocolVersion: 1, type: 'cancel', jobId: '' })).toBeFalse();
    expect(isRenderWorkerMessage({ protocolVersion: 1, type: 'completed', jobId: 'job-1' })).toBeFalse();
  });
});
