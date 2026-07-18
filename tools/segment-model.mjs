import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

export const ROUTES = [
  { id: 'yellow', name: 'Yellow', hex: '#f2c40c' },
  { id: 'green', name: 'Green', hex: '#33c21f' },
  { id: 'blue', name: 'Blue', hex: '#2276e8' },
  { id: 'pinkpurple', name: 'Pink / Purple', hex: '#d23fae' },
  { id: 'beigegrey', name: 'Beige / Grey', hex: '#c9b892' },
  { id: 'black', name: 'Black', hex: '#222428', available: false },
];

export const FACE_LABELS = ['structure', ...ROUTES.map((route) => route.id)];

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta > 1e-6) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return [hue, max <= 0 ? 0 : delta / max, max];
}

export function classifyRGB(r, g, b) {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (v < 0.24) return 'structure';
  if (h >= 42 && h <= 64 && s >= 0.48 && v >= 0.52) return 'yellow';
  if (h >= 76 && h <= 164 && s >= 0.3 && v >= 0.26) return 'green';
  if (h >= 188 && h <= 250 && s >= 0.28 && v >= 0.2) return 'blue';
  if ((h >= 286 && h <= 346) || (h >= 256 && h < 286 && s >= 0.22)) {
    if (s >= 0.2 && v >= 0.2) return 'pinkpurple';
  }
  if (h >= 17 && h <= 46 && s >= 0.2 && s < 0.48 && v >= 0.36 && v <= 0.82) {
    return 'beigegrey';
  }
  return 'structure';
}

function createSampler(image, width, height, channels) {
  const pixel = (u, v) => {
    const x = Math.max(0, Math.min(width - 1, Math.round((u - Math.floor(u)) * (width - 1))));
    const wrappedV = v - Math.floor(v);
    const y = Math.max(0, Math.min(height - 1, Math.round(wrappedV * (height - 1))));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const offset = (py * width + px) * channels;
        r += image[offset];
        g += image[offset + 1];
        b += image[offset + 2];
        count += 1;
      }
    }
    return classifyRGB(r / count, g / count, b / count);
  };

  return (uvs) => {
    const samples = uvs.map(([u, v]) => pixel(u, v));
    const centroid = [
      uvs.reduce((sum, uv) => sum + uv[0], 0) / uvs.length,
      uvs.reduce((sum, uv) => sum + uv[1], 0) / uvs.length,
    ];
    samples.push(pixel(centroid[0], centroid[1]));

    const votes = new Map();
    for (const sample of samples) {
      if (sample === 'structure') continue;
      votes.set(sample, (votes.get(sample) || 0) + 1);
    }
    let winner = 'structure';
    let best = 0;
    for (const [route, count] of votes) {
      if (count > best) {
        winner = route;
        best = count;
      }
    }
    return best >= 2 ? winner : 'structure';
  };
}

function typedIndices(values, vertexCount) {
  return vertexCount > 65_535 ? new Uint32Array(values) : new Uint16Array(values);
}

export async function segmentModel({ input, output, manifest, faceMap }) {
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const document = await io.read(input);
  const root = document.getRoot();
  const mesh = root.listMeshes().find((candidate) => candidate.listPrimitives().length > 0);
  if (!mesh) throw new Error('No mesh primitive found in the input model.');

  const primitive = mesh.listPrimitives()[0];
  const position = primitive.getAttribute('POSITION');
  const normal = primitive.getAttribute('NORMAL');
  const uv = primitive.getAttribute('TEXCOORD_0');
  const indices = primitive.getIndices();
  const material = primitive.getMaterial();
  const texture = material?.getBaseColorTexture();

  if (!position || !uv || !indices || !material || !texture?.getImage()) {
    throw new Error('The source model must contain positions, UVs, indices, a material, and an embedded base-colour texture.');
  }

  const decoded = await sharp(texture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sampleRoute = createSampler(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  );

  const sourceIndices = indices.getArray();
  const uvArray = uv.getArray();
  const groups = new Map([['structure', []], ...ROUTES.filter((route) => route.available !== false).map((route) => [route.id, []])]);
  const faceLabels = new Uint8Array(sourceIndices.length / 3);
  const uvAt = (vertex) => [uvArray[vertex * 2], uvArray[vertex * 2 + 1]];

  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const a = sourceIndices[offset];
    const b = sourceIndices[offset + 1];
    const c = sourceIndices[offset + 2];
    const route = sampleRoute([uvAt(a), uvAt(b), uvAt(c)]);
    groups.get(route).push(a, b, c);
    faceLabels[offset / 3] = FACE_LABELS.indexOf(route);
  }

  if (faceMap) {
    await mkdir(dirname(faceMap), { recursive: true });
    await writeFile(faceMap, gzipSync(faceLabels, { level: 9 }));
  }

  const sourceNode = root.listNodes().find((node) => node.getMesh() === mesh);
  if (!sourceNode) throw new Error('Could not find the node that owns the source mesh.');
  sourceNode.setName('wall_semantic_root').setMesh(null).setExtras({
    kind: 'semantic-root',
    semanticVersion: 1,
  });

  const stats = {};
  for (const [route, routeIndices] of groups) {
    if (!routeIndices.length) continue;
    const routePrimitive = document.createPrimitive()
      .setMode(primitive.getMode())
      .setMaterial(material)
      .setIndices(document.createAccessor(`${route}_indices`)
        .setType('SCALAR')
        .setArray(typedIndices(routeIndices, position.getCount()))
        .setBuffer(indices.getBuffer()))
      .setAttribute('POSITION', position)
      .setAttribute('TEXCOORD_0', uv);
    if (normal) routePrimitive.setAttribute('NORMAL', normal);

    const routeMesh = document.createMesh(`${route}_mesh`).addPrimitive(routePrimitive);
    const routeNode = document.createNode(route === 'structure' ? 'wall_structure' : `route_${route}`)
      .setMesh(routeMesh)
      .setExtras({
        kind: route === 'structure' ? 'structure' : 'route',
        routeColor: route === 'structure' ? null : route,
        semanticVersion: 1,
      });
    sourceNode.addChild(routeNode);
    stats[route] = {
      triangles: routeIndices.length / 3,
      verticesReferenced: new Set(routeIndices).size,
    };
  }

  mesh.dispose();
  primitive.dispose();
  await document.transform(prune({ propertyTypes: ['ACCESSOR', 'MESH', 'NODE'] }));
  await mkdir(dirname(output), { recursive: true });
  await io.write(output, document);

  const manifestData = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: input.split('/').pop(),
    model: output.split('/').pop(),
    mode: 'semantic-mesh',
    faceMap: faceMap ? {
      file: faceMap.split('/').pop(),
      encoding: 'gzip-uint8',
      triangles: faceLabels.length,
      labels: FACE_LABELS,
    } : null,
    limitations: [
      'Segmentation is derived offline from the existing photo texture.',
      'Black and neutral-grey holds remain part of the structure until they are manually separated in Blender.',
      'Hidden geometry cannot be recovered from the original photographs.',
    ],
    routes: ROUTES.map((route) => ({
      ...route,
      available: route.available !== false && Boolean(stats[route.id]),
      ...stats[route.id],
    })),
    structure: stats.structure,
  };
  await writeFile(manifest, `${JSON.stringify(manifestData, null, 2)}\n`, 'utf8');
  return manifestData;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const repoRoot = resolve(dirname(modulePath), '..');
  const input = resolve(repoRoot, process.argv[2] || 'wall_fused.glb');
  const output = resolve(repoRoot, process.argv[3] || 'wall_semantic.glb');
  const manifest = resolve(repoRoot, process.argv[4] || 'model.manifest.json');
  const faceMap = resolve(repoRoot, process.argv[5] || 'route-faces.bin.gz');
  const result = await segmentModel({ input, output, manifest, faceMap });
  console.log(JSON.stringify(result, null, 2));
}
