const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repository = path.resolve(__dirname, '..');
const backend = path.join(repository, 'backend');
const executable = process.platform === 'win32' ? 'pyinstaller.exe' : 'pyinstaller';
const pyinstaller = path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', executable);
const output = path.join(repository, 'frontend', 'build-resources');
const bundle = path.join(output, 'paralastro-backend');
const dataSeparator = process.platform === 'win32' ? ';' : ':';

if (!fs.existsSync(pyinstaller)) {
  throw new Error("PyInstaller is missing. Run the backend development dependency installation first.");
}
fs.rmSync(bundle, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const result = spawnSync(pyinstaller, [
  '--noconfirm', '--clean', '--onedir', '--name', 'paralastro-backend',
  '--paths', backend,
  '--add-data', `${path.join(backend, 'assets')}${dataSeparator}assets`,
  '--distpath', output,
  '--workpath', path.join(backend, 'build', 'desktop'),
  '--specpath', path.join(backend, 'build'),
  path.join(backend, 'desktop_entry.py'),
], { stdio: 'inherit' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
