const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const activeJobs = new Map();
const completedOutputs = new Set();

function send(message) { if (process.send) process.send({ protocolVersion: 1, ...message }); }
function fail(jobId, message, code = 'execution_failed') { send({ type: 'failed', jobId, error: { code, message } }); }
function expectedFrames(manifest) { return Math.round(manifest.timeline.movements.reduce((total, movement) => total + Math.max(5, Math.min(20, movement.duration)), 0) * manifest.output.fps); }
function remove(pathname) { try { fs.rmSync(pathname, { force: true }); } catch { /* Best-effort cleanup. */ } }

function start(command) {
  const { manifest } = command; const jobId = manifest.jobId;
  if (activeJobs.has(jobId)) { fail(jobId, `Render job ${jobId} is already active.`, 'duplicate_job'); return; }
  const outputPath = path.join(os.tmpdir(), `astro-parallax-${jobId}.mp4`); remove(outputPath);
  const input = ['-f', 'mjpeg', '-framerate', String(manifest.output.fps), '-i', 'pipe:0'];
  const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  let args;
  if (manifest.output.lightEffect === 'soft-reflections') {
    const effect = process.env.ASTRO_SOFT_REFLECTIONS;
    if (!effect || !fs.existsSync(effect)) { fail(jobId, 'The soft-reflections video asset is unavailable.'); return; }
    const filter = '[1:v][0:v]scale2ref=w=rw:h=rh[effect][base];[base][effect]blend=all_mode=screen:all_opacity=0.07:shortest=1[mixed];[mixed]scale=trunc(iw/2)*2:trunc(ih/2)*2[v]';
    args = ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-stream_loop', '-1', '-i', effect, '-filter_complex', filter, '-map', '[v]', '-an', ...encode, outputPath];
  } else args = ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', ...encode, outputPath];
  const processHandle = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const job = { process: processHandle, outputPath, frames: 0, expected: expectedFrames(manifest), finishing: false, cancelled: false, error: '' };
  activeJobs.set(jobId, job);
  processHandle.stderr.on('data', chunk => { job.error = `${job.error}${chunk}`.slice(-2000); });
  processHandle.on('error', error => { activeJobs.delete(jobId); remove(outputPath); fail(jobId, `Could not start FFmpeg: ${error.message}`); });
  processHandle.on('close', code => {
    if (!activeJobs.delete(jobId)) return;
    if (job.cancelled) { remove(outputPath); fail(jobId, 'Render cancelled.', 'cancelled'); return; }
    if (!job.finishing || code !== 0 || job.frames !== job.expected || !fs.existsSync(outputPath)) { remove(outputPath); fail(jobId, job.error || `FFmpeg exited with code ${code}; received ${job.frames} of ${job.expected} frames.`); return; }
    completedOutputs.add(outputPath);
    send({ type: 'event', event: { jobId, status: 'completed', renderedFrames: job.frames, totalFrames: job.expected } });
    send({ type: 'completed', jobId, outputUri: outputPath });
  });
  send({ type: 'event', event: { jobId, status: 'preparing', renderedFrames: 0, totalFrames: job.expected } });
  send({ type: 'event', event: { jobId, status: 'rendering', renderedFrames: 0, totalFrames: job.expected } });
}

function appendFrame(command) {
  const job = activeJobs.get(command.jobId);
  if (!job || job.finishing || command.index !== job.frames) { fail(command.jobId, 'Frame arrived out of order or after finalization.'); return; }
  const jpeg = Buffer.from(command.jpeg);
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) { fail(command.jobId, 'The worker received an invalid JPEG frame.'); return; }
  job.process.stdin.write(jpeg, error => {
    if (error) { job.process.kill(); fail(command.jobId, `FFmpeg rejected frame ${command.index}.`); return; }
    job.frames++;
    send({ type: 'frame-accepted', jobId: command.jobId, index: command.index });
    send({ type: 'event', event: { jobId: command.jobId, status: 'rendering', renderedFrames: job.frames, totalFrames: job.expected } });
  });
}

function finish(jobId) {
  const job = activeJobs.get(jobId);
  if (!job || job.finishing) return;
  if (job.frames !== job.expected) { job.cancelled = true; job.process.kill(); fail(jobId, `Render received ${job.frames} frames; expected ${job.expected}.`); return; }
  job.finishing = true;
  send({ type: 'event', event: { jobId, status: 'encoding', renderedFrames: job.frames, totalFrames: job.expected } });
  job.process.stdin.end();
}

function cancel(jobId) { const job = activeJobs.get(jobId); if (job) { job.cancelled = true; job.process.kill('SIGTERM'); } }
function shutdown() { for (const [jobId] of activeJobs) cancel(jobId); for (const output of completedOutputs) remove(output); setTimeout(() => process.exit(0), 50); }

process.on('message', command => {
  if (!command || command.protocolVersion !== 1) return;
  if (command.type === 'submit' && command.manifest?.jobId) start(command);
  else if (command.type === 'frame') appendFrame(command);
  else if (command.type === 'finish') finish(command.jobId);
  else if (command.type === 'cancel') cancel(command.jobId);
  else if (command.type === 'shutdown') shutdown();
});
