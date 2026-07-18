import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const inputs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const fpsArgument = process.argv.find((argument) => argument.startsWith('--fps='));
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const fps = Number(fpsArgument?.split('=')[1] || 2);
const outputRoot = resolve(outputArgument?.split('=')[1] || 'capture/keyframes');

if (!inputs.length) {
  console.error('Usage: npm run extract:video -- video-01.mp4 [video-02.mp4] [--fps=2] [--output=capture/keyframes]');
  process.exit(1);
}
if (!Number.isFinite(fps) || fps <= 0 || fps > 10) {
  throw new Error('Frame rate must be greater than 0 and no more than 10 fps.');
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const sources = [];

for (let index = 0; index < inputs.length; index += 1) {
  const input = resolve(inputs[index]);
  const id = `video-${String(index + 1).padStart(2, '0')}`;
  const outputDirectory = resolve(outputRoot, id);
  await mkdir(outputDirectory, { recursive: true });

  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration,size:stream=width,height,avg_frame_rate,nb_frames',
    '-of', 'json',
    input,
  ], { encoding: 'utf8' }));
  const stream = probe.streams?.[0] || {};

  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-an',
    '-vf', `fps=${fps}`,
    '-q:v', '2',
    resolve(outputDirectory, 'frame-%03d.jpg'),
  ], { stdio: 'inherit' });

  const duration = Number(probe.format?.duration || 0);
  sources.push({
    id,
    originalName: basename(input),
    durationSeconds: duration,
    sourceResolution: [stream.width, stream.height],
    sourceFrames: Number(stream.nb_frames || 0),
    extractedFps: fps,
    extractedFrames: Math.ceil(duration * fps),
    role: 'supplemental alignment and oblique geometry evidence',
  });
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  guidance: [
    'Use these frames together with the original still photographs.',
    'Do not upscale them or use them as the only source for texture generation.',
    'Disable blurred frames if camera alignment rejects them.',
    'Prefer original uncompressed phone videos when they are available.',
  ],
  sources,
};

await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Extracted ${sources.reduce((sum, source) => sum + source.extractedFrames, 0)} supplemental frames into ${outputRoot}.`);
