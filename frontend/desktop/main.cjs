const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const BACKEND_START_TIMEOUT_MS = 30_000;
let backend; let worker; let server; let mainWindow; let quitting = false; let backendPort = 0; let activeProjectPath = null;
const completedRenderOutputs = new Set();

function executableName(name) { return process.platform === 'win32' ? `${name}.exe` : name; }
function resourcePath(...parts) { return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.resolve(__dirname, '../..', ...parts); }
function bundledTool(name) { return app.isPackaged ? resourcePath('bin', executableName(name)) : name; }
function logPath() { return path.join(app.getPath('logs'), 'paralastro-desktop.log'); }
function preferencesPath() { return path.join(app.getPath('userData'), 'preferences.json'); }
function safeProjectName(value) { return String(value || 'Untitled').replace(/[^a-z0-9 _.-]+/gi, '-').replace(/^\.+|\.+$/g, '').trim() || 'Untitled'; }
function assetName(value) { return path.basename(new URL(String(value), 'http://localhost').pathname); }
function projectAssetUrls(document) {
  const urls = new Set();
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    else if (typeof value === 'string' && value.startsWith('/media/')) urls.add(value);
  };
  visit(document.project); visit(document.workspace?.imageOverlays);
  return [...urls];
}
function replaceAssetUrls(value) {
  if (Array.isArray(value)) return value.map(replaceAssetUrls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAssetUrls(item)]));
  return typeof value === 'string' && value.startsWith('/media/') ? `assets/${assetName(value)}` : value;
}
function decodeDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  return { extension: match[1].toLowerCase() === 'image/jpeg' ? 'jpg' : 'png', content: Buffer.from(match[2], 'base64') };
}
async function fetchBackendAsset(url) {
  if (!backendPort || !String(url).startsWith('/media/')) throw new Error('Invalid project asset URL.');
  const response = await fetch(`http://127.0.0.1:${backendPort}${url}`);
  if (!response.ok) throw new Error(`Could not read project asset ${assetName(url)}.`);
  return Buffer.from(await response.arrayBuffer());
}
async function writeProjectFolder(target, document, assetOverrides) {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`; const backup = `${target}.backup-${process.pid}`;
  await fs.promises.mkdir(path.join(temporary, 'assets'), { recursive: true });
  try {
    const saved = structuredClone(document); const written = new Set();
    for (const overlay of saved.workspace?.imageOverlays ?? []) {
      const decoded = typeof overlay.dataUrl === 'string' ? decodeDataUrl(overlay.dataUrl) : null;
      if (!decoded) continue;
      const name = `overlay-${safeProjectName(overlay.id)}.${decoded.extension}`;
      await fs.promises.writeFile(path.join(temporary, 'assets', name), decoded.content, { mode: 0o600 });
      overlay.dataUrl = `assets/${name}`; written.add(name);
    }
    for (const url of projectAssetUrls(saved)) {
      const name = assetName(url); if (!name || written.has(name)) continue;
      const override = assetOverrides?.[name]; const decoded = typeof override === 'string' ? decodeDataUrl(override) : null;
      await fs.promises.writeFile(path.join(temporary, 'assets', name), decoded?.content ?? await fetchBackendAsset(url), { mode: 0o600 });
      written.add(name);
    }
    const portable = replaceAssetUrls(saved);
    await fs.promises.writeFile(path.join(temporary, 'project.json'), `${JSON.stringify(portable, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rm(backup, { recursive: true, force: true });
    if (fs.existsSync(target)) await fs.promises.rename(target, backup);
    await fs.promises.rename(temporary, target);
    await fs.promises.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.promises.rm(temporary, { recursive: true, force: true });
    if (!fs.existsSync(target) && fs.existsSync(backup)) await fs.promises.rename(backup, target);
    throw error;
  }
}
async function importProjectFolder(target) {
  const manifestPath = path.join(target, 'project.json');
  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size > 10_000_000) throw new Error('This folder does not contain a valid Paralastro project.');
  const document = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  if (document?.format !== 'paralastro-project' || document?.formatVersion !== 1 || !document.project || !document.workspace || !Array.isArray(document.workspace.cameraMovements) || !Array.isArray(document.workspace.textOverlays) || !Array.isArray(document.workspace.imageOverlays) || !document.workspace.starSettings || !document.workspace.brush || !document.workspace.lighting || !document.workspace.depthOfField || !document.workspace.videoExport) throw new Error('This project format is not supported.');
  const assetsRoot = path.join(target, 'assets'); const names = await fs.promises.readdir(assetsRoot);
  if (!names.length || names.length > 64) throw new Error('The project asset collection is invalid.');
  const form = new FormData();
  form.append('project', new Blob([JSON.stringify(document.project)], { type: 'application/json' }), 'project.json');
  for (const name of names) {
    if (name !== path.basename(name) || !/\.(png|jpe?g)$/i.test(name)) continue;
    const assetPath = path.join(assetsRoot, name); if ((await fs.promises.lstat(assetPath)).isSymbolicLink()) throw new Error('Project assets cannot be symbolic links.');
    const content = await fs.promises.readFile(assetPath);
    form.append('assets', new Blob([content], { type: /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png' }), name);
  }
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/projects/import`, { method: 'POST', body: form });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.detail?.message || 'The project assets could not be restored.'); }
  document.project = await response.json();
  for (const overlay of document.workspace.imageOverlays ?? []) {
    if (typeof overlay.dataUrl === 'string' && overlay.dataUrl.startsWith('assets/')) {
      const name = path.basename(overlay.dataUrl); if (!names.includes(name)) throw new Error(`The saved project asset '${name}' is missing.`);
      overlay.dataUrl = `/media/${document.project.projectId}/${name}`;
    }
  }
  return document;
}
function writeLog(scope, value) {
  const line = `[${new Date().toISOString()}] [${scope}] ${String(value).trim()}\n`;
  try { const target = logPath(); fs.mkdirSync(path.dirname(target), { recursive: true }); if (fs.existsSync(target) && fs.statSync(target).size > 2_000_000) { const previous = `${target}.previous`; fs.rmSync(previous, { force: true }); fs.renameSync(target, previous); } fs.appendFileSync(target, line); } catch { /* Logging must never stop the application. */ }
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.unref(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const address = probe.address(); const port = typeof address === 'object' && address ? address.port : 0; probe.close(() => port ? resolve(port) : reject(new Error('Could not allocate a backend port.'))); });
  });
}

function backendLaunch(port) {
  const environment = { ...process.env, PARALASTRO_BACKEND_HOST: '127.0.0.1', PARALASTRO_BACKEND_PORT: String(port), PARALASTRO_FFMPEG_PATH: bundledTool('ffmpeg'), PARALASTRO_FFPROBE_PATH: bundledTool('ffprobe') };
  if (app.isPackaged) return { command: resourcePath('backend', executableName('paralastro-backend')), args: [], options: { env: environment } };
  const backendRoot = resourcePath('backend');
  return { command: path.join(backendRoot, '.venv', 'bin', 'python'), args: ['desktop_entry.py'], options: { cwd: backendRoot, env: environment } };
}

function startBackend(port) {
  const launch = backendLaunch(port);
  if (!fs.existsSync(launch.command)) throw new Error(`Backend executable not found: ${launch.command}`);
  backend = spawn(launch.command, launch.args, { ...launch.options, stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout?.on('data', data => writeLog('backend', data)); backend.stderr?.on('data', data => writeLog('backend', data));
  backend.on('exit', code => { writeLog('backend', `exited with code ${code}`); if (!quitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:service-failed', { service: 'backend', code }); });
  backend.on('error', error => writeLog('backend', error.stack || error.message));
}

function waitForBackend(port) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => { if (Date.now() - started >= BACKEND_START_TIMEOUT_MS) reject(new Error(`Backend did not become ready within ${BACKEND_START_TIMEOUT_MS / 1000} seconds.`)); else setTimeout(check, 250); };
    const check = () => { const request = http.get({ hostname: '127.0.0.1', port, path: '/api/v1/health', timeout: 1000 }, response => { response.resume(); if (response.statusCode === 200) resolve(); else retry(); }); request.on('timeout', () => request.destroy()); request.on('error', retry); };
    check();
  });
}

function proxyApi(request, response, backendPort) {
  const headers = { ...request.headers, host: `127.0.0.1:${backendPort}` };
  const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method, headers }, result => { response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response); });
  upstream.on('error', error => { writeLog('proxy', error.message); response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ detail: 'Local backend is unavailable.' })); }); request.pipe(upstream);
}

function startFrontendServer(backendPort) {
  const root = path.resolve(__dirname, '../dist/astro-parallax-studio/browser');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf' };
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/api/') || request.url?.startsWith('/media/')) { proxyApi(request, response, backendPort); return; }
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]); const candidate = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`); const safePath = candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
    response.writeHead(200, { 'content-type': mime[path.extname(safePath)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' }); fs.createReadStream(safePath).pipe(response);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; if (port) resolve(port); else reject(new Error('Could not allocate a frontend port.')); }); });
}

function registerDesktopIpc() {
  ipcMain.on('desktop:preferences:load', event => {
    try { event.returnValue = fs.existsSync(preferencesPath()) ? fs.readFileSync(preferencesPath(), 'utf8') : null; }
    catch (error) { writeLog('preferences', error.message); event.returnValue = null; }
  });
  ipcMain.on('desktop:preferences:save', (_event, value) => {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 2_000_000) return;
    try { const target = preferencesPath(); fs.mkdirSync(path.dirname(target), { recursive: true }); const temporary = `${target}.tmp`; fs.writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, target); }
    catch (error) { writeLog('preferences', error.message); }
  });
  ipcMain.handle('desktop:project:save', async (_event, document, assetOverrides, currentPath) => {
    if (!document || document.format !== 'paralastro-project' || document.formatVersion !== 1) throw new Error('The project data is invalid.');
    let target = typeof currentPath === 'string' && activeProjectPath && path.resolve(currentPath) === activeProjectPath ? activeProjectPath : null;
    if (!target) {
      const selection = await dialog.showSaveDialog(mainWindow, { title: 'Save Paralastro project', defaultPath: path.join(app.getPath('documents'), `${safeProjectName(document.project?.scene?.name)}.paralastro`), filters: [{ name: 'Paralastro project', extensions: ['paralastro'] }] });
      if (selection.canceled || !selection.filePath) return null;
      target = selection.filePath.endsWith('.paralastro') ? selection.filePath : `${selection.filePath}.paralastro`;
    }
    activeProjectPath = path.resolve(target); await writeProjectFolder(activeProjectPath, document, assetOverrides ?? {}); return activeProjectPath;
  });
  ipcMain.handle('desktop:project:open', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: 'Open Paralastro project', defaultPath: app.getPath('documents'), properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const target = path.resolve(selection.filePaths[0]); const document = await importProjectFolder(target); activeProjectPath = target; return { path: target, document };
  });
}

function startWorker(window) {
  const ffmpeg = bundledTool('ffmpeg'); const effect = app.isPackaged ? resourcePath('effects', 'soft-reflections.mp4') : resourcePath('backend', 'assets', 'video-effects', 'soft-reflections.mp4');
  const workerPath = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'desktop', 'render-worker.cjs') : path.join(__dirname, 'render-worker.cjs');
  if (app.isPackaged && !fs.existsSync(ffmpeg)) throw new Error(`Bundled FFmpeg not found: ${ffmpeg}`);
  worker = fork(workerPath, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PARALASTRO_FFMPEG_PATH: ffmpeg, ASTRO_SOFT_REFLECTIONS: effect }, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  worker.stdout?.on('data', data => writeLog('render-worker', data)); worker.stderr?.on('data', data => writeLog('render-worker', data));
  worker.on('message', message => { if (message?.type === 'completed' && typeof message.outputUri === 'string') completedRenderOutputs.add(path.resolve(message.outputUri)); if (!window.isDestroyed()) window.webContents.send('render-worker:message', message); });
  worker.on('exit', code => { writeLog('render-worker', `exited with code ${code}`); if (!quitting && !window.isDestroyed() && code !== 0) window.webContents.send('render-worker:message', { protocolVersion: 1, type: 'failed', jobId: '*', error: { code: 'execution_failed', message: `Render worker exited with code ${code}.` } }); });
  ipcMain.on('render-worker:command', (_event, command) => { if (worker?.connected) worker.send(command); });
  ipcMain.handle('render-worker:save-output', async (_event, sourcePath, suggestedName) => {
    const source = path.resolve(String(sourcePath)); if (!completedRenderOutputs.has(source) || !fs.existsSync(source)) throw new Error('The completed render output is unavailable.');
    const safeName = String(suggestedName || 'camera-path.mp4').replace(/[^a-z0-9._-]+/gi, '-'); const selection = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('videos'), safeName), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (selection.canceled || !selection.filePath) { completedRenderOutputs.delete(source); fs.rmSync(source, { force: true }); return null; }
    await fs.promises.copyFile(source, selection.filePath); completedRenderOutputs.delete(source); fs.rmSync(source, { force: true }); return selection.filePath;
  });
  ipcMain.handle('desktop:show-logs', () => shell.showItemInFolder(logPath()));
}

async function createApplication() {
  registerDesktopIpc(); backendPort = await findAvailablePort(); startBackend(backendPort); await waitForBackend(backendPort); const frontendPort = await startFrontendServer(backendPort);
  mainWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 1024, minHeight: 700, show: false, backgroundColor: '#03050a', title: `Paralastro ${app.getVersion()}`, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  startWorker(mainWindow); mainWindow.once('ready-to-show', () => mainWindow.show()); await mainWindow.loadURL(`http://127.0.0.1:${frontendPort}`);
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }); app.whenReady().then(createApplication).catch(async error => { writeLog('startup', error.stack || error.message); await dialog.showMessageBox({ type: 'error', title: 'Paralastro could not start', message: 'The local application services could not be started.', detail: `${error.message}\n\nLog: ${logPath()}` }); app.quit(); }); }

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; ipcMain.removeAllListeners('render-worker:command'); ipcMain.removeAllListeners('desktop:preferences:load'); ipcMain.removeAllListeners('desktop:preferences:save'); ipcMain.removeHandler('render-worker:save-output'); ipcMain.removeHandler('desktop:show-logs'); ipcMain.removeHandler('desktop:project:save'); ipcMain.removeHandler('desktop:project:open'); if (worker?.connected) worker.send({ protocolVersion: 1, type: 'shutdown' }); backend?.kill(); server?.close(); });
