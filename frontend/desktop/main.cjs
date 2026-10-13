const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DESKTOP_FRONTEND_PORT = 43127;

let backend;
let worker;
let server;
const completedRenderOutputs = new Set();

function startBackend() {
  const backendRoot = path.resolve(__dirname, '../../backend');
  const python = path.join(backendRoot, '.venv', 'bin', 'python');
  backend = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], { cwd: backendRoot, stdio: 'inherit' });
}

function proxyApi(request, response) {
  const upstream = http.request({ hostname: '127.0.0.1', port: 8000, path: request.url, method: request.method, headers: request.headers }, result => {
    response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ detail: 'Local backend is unavailable.' })); });
  request.pipe(upstream);
}

function startFrontendServer() {
  const root = path.resolve(__dirname, '../dist/astro-parallax-studio/browser');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/api/') || request.url?.startsWith('/media/')) { proxyApi(request, response); return; }
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const candidate = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    const safePath = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
    response.writeHead(200, { 'content-type': mime[path.extname(safePath)] ?? 'application/octet-stream' }); fs.createReadStream(safePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(DESKTOP_FRONTEND_PORT, '127.0.0.1', () => resolve(DESKTOP_FRONTEND_PORT));
  });
}

function startWorker(window) {
  worker = fork(path.join(__dirname, 'render-worker.cjs'), [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ASTRO_SOFT_REFLECTIONS: path.resolve(__dirname, '../../backend/assets/video-effects/soft-reflections.mp4') }, serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  worker.on('message', message => {
    if (message?.type === 'completed' && typeof message.outputUri === 'string') completedRenderOutputs.add(path.resolve(message.outputUri));
    if (!window.isDestroyed()) window.webContents.send('render-worker:message', message);
  });
  worker.on('exit', code => { if (!window.isDestroyed() && code !== 0) window.webContents.send('render-worker:message', { protocolVersion: 1, type: 'failed', jobId: '*', error: { code: 'execution_failed', message: `Render worker exited with code ${code}.` } }); });
  ipcMain.on('render-worker:command', (_event, command) => { if (worker?.connected) worker.send(command); });
  ipcMain.handle('render-worker:save-output', async (_event, sourcePath, suggestedName) => {
    const source = path.resolve(String(sourcePath));
    if (!completedRenderOutputs.has(source) || !fs.existsSync(source)) throw new Error('The completed render output is unavailable.');
    const safeName = String(suggestedName || 'camera-path.mp4').replace(/[^a-z0-9._-]+/gi, '-');
    const selection = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('videos'), safeName), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (selection.canceled || !selection.filePath) { completedRenderOutputs.delete(source); fs.rmSync(source, { force: true }); return null; }
    await fs.promises.copyFile(source, selection.filePath);
    completedRenderOutputs.delete(source);
    fs.rmSync(source, { force: true });
    return selection.filePath;
  });
}

app.whenReady().then(async () => {
  startBackend();
  const port = await startFrontendServer();
  const window = new BrowserWindow({ width: 1440, height: 960, backgroundColor: '#03050a', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  startWorker(window);
  await window.loadURL(`http://127.0.0.1:${port}`);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { ipcMain.removeAllListeners('render-worker:command'); ipcMain.removeHandler('render-worker:save-output'); if (worker?.connected) worker.send({ protocolVersion: 1, type: 'shutdown' }); backend?.kill(); server?.close(); });
