# Get a Grip

Interactive Three.js viewer for a photogrammetry reconstruction of a bouldering wall. The viewer keeps the wall on a white studio background, renders high-contrast route colours, and filters true 3D geometry rather than masking image pixels.

## Current model

The build step classifies the texture of `wall_fused.glb` once. It writes a compact `route-faces.bin.gz` label map with one label for each of the original 293,423 triangles. In the browser, the viewer splits the original indexed mesh into route-aware 3D layers while sharing its precise positions, normals, UVs and embedded texture. This keeps the public download small and guarantees that filtering does not alter the source geometry.

`wall_semantic.glb` is also generated as an authoring/validation asset. Its nodes contain explicit `routeColor` metadata and can be opened directly in Blender or another glTF tool. The website uses the smaller face map plus `wall_fused.glb`, so it does not duplicate the model download.

The available semantic layers are:

- `wall_structure`
- `route_yellow`
- `route_green`
- `route_blue`
- `route_pinkpurple`
- `route_beigegrey`

Black and neutral-grey holds cannot be separated reliably from the black wall using colour alone. They intentionally remain in `wall_structure` until a Blender artist separates them manually.

## Local development

The site has no bundler and must be served over HTTP because it loads GLB and JSON assets.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Model build and validation

```bash
npm install
npm run build:model
npm run extract:video -- video-01.mp4 video-02.mp4
npm run validate:model
npm test
```

The segmentation command reads `wall_fused.glb` and writes:

- `wall_semantic.glb`
- `model.manifest.json`
- `route-faces.bin.gz`

The original source model is retained as a reproducible input.

## Supplemental video frames

The two available WhatsApp videos add useful oblique views of the main wall, the right-hand fold, the large yellow volumes and several hold profiles. They are only 640×480 and contain compression and motion blur, so they should support camera alignment and depth reconstruction rather than replace the high-resolution still photographs.

The local `capture/keyframes` dataset was sampled at 2 fps. This gives much better viewpoint coverage without sending all 981 highly redundant source frames into photogrammetry. Audio is never extracted. Source photos, videos and extracted frames stay out of the public repository.

To rebuild the dataset from higher-quality originals:

```bash
npm run extract:video -- /path/to/video-01.mp4 /path/to/video-02.mp4 --fps=2
```

If the original, uncompressed phone videos are available, use them instead of the WhatsApp copies. Keep their native resolution and do not apply sharpening, stabilisation, colour filters or AI upscaling before reconstruction.

## Contract for the final Blender model

The viewer recognises route objects using either node extras or the node name. Metadata is preferred:

```json
{
  "kind": "route",
  "routeColor": "green",
  "holdId": "green_001",
  "wallSection": "centre",
  "semanticVersion": 1
}
```

Supported `routeColor` values are:

```text
yellow
green
blue
pinkpurple
beigegrey
black
```

Structural objects should use:

```json
{
  "kind": "structure",
  "semanticVersion": 1
}
```

As a fallback, nodes named `route_<colour>` are recognised. Use one object per physical hold in the final production asset so that click selection, counts, route editing and future hold-level information remain accurate.

## Recommended capture procedure

The current reconstruction is based on too few wide photographs to recover hidden surfaces exactly. For the production scan:

1. Capture 100–200 photographs with the same main camera and fixed focal length.
2. Maintain approximately 70–80% overlap horizontally and vertically.
3. Make straight-on, left-oblique and right-oblique passes across every wall section.
4. Add close passes around large volumes and clusters of small holds.
5. Use diffuse, stable lighting; avoid flash, moving people and changing exposure.
6. Include at least three measured markers distributed across the wall.
7. Reconstruct the mesh in RealityScan/RealityCapture or Agisoft Metashape.
8. Correct scale and wall planes in Blender.
9. Separate the structure, volumes and every hold into named objects.
10. Add the metadata above and export as GLB with textures embedded.

Gaussian splats may be retained as a visual reference, but the route-filtering application should use a mesh because individual holds must be independently selectable and hideable.

## Quality gate before replacing the model

- No invented or duplicated holds
- Wall planes and large volumes match measured dimensions
- Every hold has a unique `holdId`
- Every hold has a supported `routeColor`
- Black and grey holds are separated manually
- Object origins and transforms are applied in Blender
- Normals face outward
- Textures use physically plausible colour and roughness
- The exported asset passes `npm run validate:model`
