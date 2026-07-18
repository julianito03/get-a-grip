import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRGB } from './segment-model.mjs';

const SH_C0 = 0.28209479177387814;
const ROUTE_COLOURS = {
  yellow: '#ffd20a',
  green: '#36d126',
  blue: '#2486ff',
  pinkpurple: '#e33cc2',
};

function parseHeader(buffer) {
  const token = Buffer.from('end_header\n');
  const headerBytes = buffer.indexOf(token) + token.length;
  if (headerBytes < token.length) throw new Error('The input is not a supported binary PLY file.');
  const header = buffer.subarray(0, headerBytes).toString('utf8');
  if (!header.includes('format binary_little_endian 1.0')) throw new Error('Only binary little-endian PLY files are supported.');
  const count = Number(header.match(/element vertex (\d+)/)?.[1]);
  const properties = [...header.matchAll(/^property\s+(\w+)\s+(\w+)$/gm)].map((match) => ({ type: match[1], name: match[2] }));
  if (!count || properties.some((property) => property.type !== 'float')) throw new Error('The Gaussian PLY must contain float vertex properties.');
  const propertyIndex = Object.fromEntries(properties.map((property, index) => [property.name, index]));
  for (const name of ['f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2', 'x', 'y', 'z']) {
    if (propertyIndex[name] === undefined) throw new Error(`The Gaussian PLY is missing ${name}.`);
  }
  return { header, headerBytes, count, properties, propertyIndex, stride: properties.length * 4 };
}

function decodeColour(view, offset, propertyIndex) {
  return ['f_dc_0', 'f_dc_1', 'f_dc_2'].map((name) => {
    const coefficient = view.getFloat32(offset + propertyIndex[name] * 4, true);
    return Math.max(0, Math.min(255, (0.5 + SH_C0 * coefficient) * 255));
  });
}

function encodeOverlaySplat(view, offset, propertyIndex, hex) {
  const record = Buffer.alloc(32);
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  ['x', 'y', 'z'].forEach((name, index) => record.writeFloatLE(view.getFloat32(offset + propertyIndex[name] * 4, true), index * 4));
  ['scale_0', 'scale_1', 'scale_2'].forEach((name, index) => record.writeFloatLE(Math.exp(view.getFloat32(offset + propertyIndex[name] * 4, true)), 12 + index * 4));
  channels.forEach((channel, index) => { record[24 + index] = channel; });
  const opacity = view.getFloat32(offset + propertyIndex.opacity * 4, true);
  record[27] = Math.max(0, Math.min(255, Math.floor((1 / (1 + Math.exp(-opacity))) * 255)));
  const rotation = ['rot_0', 'rot_1', 'rot_2', 'rot_3'].map((name) => view.getFloat32(offset + propertyIndex[name] * 4, true));
  const length = Math.hypot(...rotation) || 1;
  const normalised = rotation.map((component) => component / length);
  [normalised[3], normalised[0], normalised[1], normalised[2]].forEach((component, index) => {
    record[28 + index] = Math.max(0, Math.min(255, Math.round(component * 128 + 128)));
  });
  return record;
}

function routeId(id) {
  return id === 'pink' || id === 'purple' ? 'pinkpurple' : id;
}

function classifyPoint(x, y, z, colourClass, markers) {
  let winner = null;
  let bestScore = Infinity;
  for (const marker of markers) {
    const distance = Math.hypot(x - marker.x, y - marker.y, z - marker.z);
    const colourMatch = colourClass === marker.routeId;
    const radius = colourMatch ? 0.58 : 0.27;
    if (distance > radius) continue;
    const score = distance / radius + (colourMatch ? 0 : 0.18);
    if (score < bestScore) {
      bestScore = score;
      winner = marker.routeId;
    }
  }
  return winner;
}

export async function buildSplatOverlays({ input, routesPath, outputDirectory, manifestPath }) {
  const source = await readFile(input);
  const parsed = parseHeader(source);
  const routeData = JSON.parse(await readFile(routesPath, 'utf8'));
  const markerCandidates = routeData.routes.flatMap((route) => route.holds.map((hold) => ({
    ...hold,
    routeId: routeId(route.id),
  }))).filter((marker) => ROUTE_COLOURS[marker.routeId]);
  const markers = [];
  for (const marker of markerCandidates) {
    const duplicate = markers.some((item) => item.routeId === marker.routeId
      && Math.hypot(item.x - marker.x, item.y - marker.y, item.z - marker.z) < 0.06);
    if (!duplicate) markers.push(marker);
  }

  const records = Object.fromEntries(Object.keys(ROUTE_COLOURS).map((id) => [id, []]));
  const view = new DataView(source.buffer, source.byteOffset + parsed.headerBytes, source.length - parsed.headerBytes);
  for (let index = 0; index < parsed.count; index += 1) {
    const offset = index * parsed.stride;
    const x = view.getFloat32(offset + parsed.propertyIndex.x * 4, true);
    const y = view.getFloat32(offset + parsed.propertyIndex.y * 4, true);
    const z = view.getFloat32(offset + parsed.propertyIndex.z * 4, true);
    const colourClass = routeId(classifyRGB(...decodeColour(view, offset, parsed.propertyIndex)) || '');
    const id = classifyPoint(x, y, z, colourClass, markers);
    if (!id) continue;
    records[id].push(encodeOverlaySplat(view, offset, parsed.propertyIndex, ROUTE_COLOURS[id]));
  }

  await mkdir(outputDirectory, { recursive: true });
  const routes = [];
  for (const [id, routeRecords] of Object.entries(records)) {
    const file = `route-${id}.splat`;
    await writeFile(resolve(outputDirectory, file), Buffer.concat(routeRecords));
    routes.push({
      id,
      name: id === 'pinkpurple' ? 'Pink / Purple' : `${id[0].toUpperCase()}${id.slice(1)}`,
      color: ROUTE_COLOURS[id],
      file: `${outputDirectory.split('/').pop()}/${file}`,
      splats: routeRecords.length,
      holds: markers.filter((marker) => marker.routeId === id).length,
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: input.split('/').pop(),
    sourceSplats: parsed.count,
    mode: 'full-wall-gaussian-splat-with-semantic-overlays',
    view: routeData.view,
    routes,
    limitations: [
      'The full video scan is a Gaussian 3D reconstruction rather than a watertight mesh.',
      'Route overlays combine source colour evidence with the reviewed 3D hold markers.',
      'Beige, neutral-grey and black holds require a manual marker pass before they can be highlighted reliably.',
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const repoRoot = resolve(dirname(modulePath), '..');
  const result = await buildSplatOverlays({
    input: resolve(repoRoot, process.argv[2] || 'wall.ply'),
    routesPath: resolve(repoRoot, process.argv[3] || 'routes.json'),
    outputDirectory: resolve(repoRoot, process.argv[4] || 'splat-routes'),
    manifestPath: resolve(repoRoot, process.argv[5] || 'splat.manifest.json'),
  });
  console.log(JSON.stringify(result, null, 2));
}
