const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');

const product = path.resolve(__dirname, '../release/mac-arm64/Paralastro.app');
const resources = path.join(product, 'Contents', 'Resources');
const required = [
  path.join(resources, 'backend', 'paralastro-backend'),
  path.join(resources, 'bin', 'ffmpeg'),
  path.join(resources, 'bin', 'ffprobe'),
  path.join(resources, 'effects', 'soft-reflections.mp4'),
  path.join(resources, 'app.asar'),
];

for (const candidate of required) if (!fs.existsSync(candidate)) throw new Error(`Packaged resource is missing: ${candidate}`);
for (const binary of required.slice(1, 3)) {
  const result = spawnSync(binary, ['-version'], { timeout: 15_000, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Packaged binary failed: ${binary}\n${result.error?.message ?? result.stderr}`);
}

const findPort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)); });
});
const waitForHealth = (port, timeout = 30_000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => { const request = http.get({ hostname: '127.0.0.1', port, path: '/api/v1/health', timeout: 1000 }, response => { response.resume(); if (response.statusCode === 200) resolve(); else retry(); }); request.on('timeout', () => request.destroy()); request.on('error', retry); };
  const retry = () => Date.now() - started > timeout ? reject(new Error('Packaged backend health check timed out.')) : setTimeout(check, 250);
  check();
});

(async () => {
  const port = await findPort();
  const backend = spawn(required[0], [], { env: { ...process.env, PARALASTRO_BACKEND_HOST: '127.0.0.1', PARALASTRO_BACKEND_PORT: String(port), PARALASTRO_FFMPEG_PATH: required[1], PARALASTRO_FFPROBE_PATH: required[2] }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; backend.stderr.on('data', value => { errors += value; });
  try { await waitForHealth(port); console.log(`Verified ${product}`); }
  catch (error) { throw new Error(`${error.message}\n${errors}`); }
  finally { backend.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
