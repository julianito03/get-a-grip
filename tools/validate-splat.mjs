import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(repoRoot, process.argv[2] || 'splat.manifest.json'), 'utf8'));
const failures = [];

async function vertexCount(path) {
  const handle = await readFile(path);
  const headerEnd = handle.indexOf(Buffer.from('end_header\n'));
  if (headerEnd < 0) return handle.length % 32 === 0 ? handle.length / 32 : null;
  return Number(handle.subarray(0, headerEnd).toString('utf8').match(/element vertex (\d+)/)?.[1]);
}

const sourceCount = await vertexCount(resolve(repoRoot, manifest.source));
if (sourceCount !== manifest.sourceSplats) failures.push(`Source splat mismatch: PLY=${sourceCount}, manifest=${manifest.sourceSplats}.`);

const routeIds = new Set();
for (const route of manifest.routes || []) {
  if (routeIds.has(route.id)) failures.push(`Duplicate route id ${route.id}.`);
  routeIds.add(route.id);
  const count = await vertexCount(resolve(repoRoot, route.file));
  if (count !== route.splats) failures.push(`Overlay count mismatch for ${route.id}: PLY=${count}, manifest=${route.splats}.`);
  if (!route.holds || !route.splats) failures.push(`Route ${route.id} must contain reviewed holds and overlay splats.`);
}

if (routeIds.size < 4) failures.push('Expected at least four reviewed colour routes.');
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${sourceCount.toLocaleString()} source splats and ${routeIds.size} semantic route overlays.`);
}
