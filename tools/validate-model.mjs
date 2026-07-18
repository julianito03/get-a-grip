import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

const repoRoot = resolve(import.meta.dirname, '..');
const modelPath = resolve(repoRoot, process.argv[2] || 'wall_semantic.glb');
const manifestPath = resolve(repoRoot, process.argv[3] || 'model.manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const faceMapPath = resolve(repoRoot, process.argv[4] || manifest.faceMap?.file || 'route-faces.bin.gz');
const faceLabels = manifest.faceMap?.encoding === 'gzip-uint8'
  ? new Uint8Array(gunzipSync(await readFile(faceMapPath)))
  : new Uint8Array(await readFile(faceMapPath));
const document = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(modelPath);
const nodes = document.getRoot().listNodes();
const routeNodes = nodes.filter((node) => node.getExtras()?.kind === 'route');
const structureNodes = nodes.filter((node) => node.getExtras()?.kind === 'structure');
const failures = [];

if (manifest.schemaVersion !== 1) failures.push('model.manifest.json must use schemaVersion 1.');
if (!manifest.faceMap?.labels?.length) failures.push('The manifest has no semantic face-map labels.');
if (faceLabels.length !== manifest.faceMap?.triangles) failures.push(`Face-map triangle mismatch: map=${faceLabels.length}, manifest=${manifest.faceMap?.triangles}.`);
if (structureNodes.length < 1) failures.push('The model has no structure node.');
if (routeNodes.length < 1) failures.push('The model has no semantic route nodes.');

const routeIds = new Set();
for (const node of routeNodes) {
  const routeId = node.getExtras()?.routeColor;
  if (!routeId) failures.push(`${node.getName()} has no routeColor metadata.`);
  if (!node.getMesh()) failures.push(`${node.getName()} has no mesh.`);
  routeIds.add(routeId);
}

for (const route of manifest.routes.filter((item) => item.available)) {
  if (!routeIds.has(route.id)) failures.push(`Manifest route ${route.id} has no corresponding 3D node.`);
}

const triangleTotal = document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((meshSum, primitive) => {
  const count = primitive.getIndices()?.getCount() || primitive.getAttribute('POSITION')?.getCount() || 0;
  return meshSum + count / 3;
}, 0), 0);

const manifestTriangleTotal = manifest.routes.reduce((sum, route) => sum + (route.triangles || 0), 0) + (manifest.structure?.triangles || 0);
if (triangleTotal !== manifestTriangleTotal) {
  failures.push(`Triangle total mismatch: GLB=${triangleTotal}, manifest=${manifestTriangleTotal}.`);
}

const faceCounts = new Map(manifest.faceMap.labels.map((label) => [label, 0]));
for (const labelIndex of faceLabels) {
  const label = manifest.faceMap.labels[labelIndex];
  if (!label) failures.push(`Face map contains unknown label index ${labelIndex}.`);
  else faceCounts.set(label, faceCounts.get(label) + 1);
}
for (const route of manifest.routes.filter((item) => item.available)) {
  if (faceCounts.get(route.id) !== route.triangles) failures.push(`Face-map count mismatch for ${route.id}.`);
}
if (faceCounts.get('structure') !== manifest.structure?.triangles) failures.push('Face-map count mismatch for structure.');

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${routeNodes.length} route layers, ${structureNodes.length} structure layer, and ${triangleTotal.toLocaleString()} triangles.`);
}
