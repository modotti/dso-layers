const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..');
const resources = path.join(frontendRoot, 'build-resources');
const binaryName = name => process.platform === 'win32' ? `${name}.exe` : name;
const copy = (source, destination, executable = false) => {
  if (!source || !fs.existsSync(source)) throw new Error(`Required desktop resource is missing: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
  if (executable && process.platform !== 'win32') fs.chmodSync(destination, 0o755);
};

copy(require('ffmpeg-static'), path.join(resources, 'bin', binaryName('ffmpeg')), true);
copy(require('ffprobe-static').path, path.join(resources, 'bin', binaryName('ffprobe')), true);
copy(path.resolve(frontendRoot, '../backend/assets/video-effects/soft-reflections.mp4'), path.join(resources, 'effects', 'soft-reflections.mp4'));
copy(path.join(frontendRoot, 'node_modules/ffmpeg-static/LICENSE'), path.join(resources, 'licenses', 'ffmpeg-static-GPL-3.0.txt'));
copy(path.join(frontendRoot, 'node_modules/ffprobe-static/LICENSE'), path.join(resources, 'licenses', 'ffprobe-static-license.txt'));

console.log(`Desktop resources staged for ${process.platform}/${process.arch}.`);
