const { fork, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const jpeg = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { encoding: null });
if (jpeg.status !== 0 || !jpeg.stdout?.length) throw new Error('Could not create the worker test frame.');

const child = fork(path.join(__dirname, 'render-worker.cjs'), [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const manifest = { version: 1, jobId: `integration-${process.pid}`, timeline: { movements: [{ duration: 5 }, { duration: 5, transition: 'crossfade', transitionDuration: 1 }], flow: 'per-movement' }, output: { width: 64, height: 64, fps: 1, quality: 'draft', lightEffect: 'none' } };
const expectedFrames = 9;
let nextFrame = 0;
const timer = setTimeout(() => { child.kill(); throw new Error('Desktop render worker integration test timed out.'); }, 15000);

child.on('message', message => {
  if (message.type === 'event' && message.event.status === 'rendering' && message.event.renderedFrames === 0) child.send({ protocolVersion: 1, type: 'frame', jobId: manifest.jobId, index: nextFrame, jpeg: new Uint8Array(jpeg.stdout) });
  if (message.type === 'frame-accepted') {
    nextFrame++;
    if (nextFrame < expectedFrames) child.send({ protocolVersion: 1, type: 'frame', jobId: manifest.jobId, index: nextFrame, jpeg: new Uint8Array(jpeg.stdout) });
    else child.send({ protocolVersion: 1, type: 'finish', jobId: manifest.jobId });
  }
  if (message.type === 'failed') { clearTimeout(timer); child.kill(); throw new Error(message.error.message); }
  if (message.type === 'completed') {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,avg_frame_rate', '-of', 'json', message.outputUri], { encoding: 'utf8' });
    const stream = JSON.parse(probe.stdout).streams[0];
    if (stream.nb_read_frames !== String(expectedFrames) || stream.avg_frame_rate !== '1/1') throw new Error(`Unexpected worker output: ${probe.stdout}`);
    fs.rmSync(message.outputUri, { force: true }); clearTimeout(timer); child.send({ protocolVersion: 1, type: 'shutdown' });
  }
});

child.send({ protocolVersion: 1, type: 'submit', manifest });
