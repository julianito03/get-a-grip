#!/usr/bin/env python3
"""Build the gym wall as a 3D model from tools/gym_data.json.

Run inside Blender:
  Blender --background --python tools/gym_build.py -- <out.glb> [render.png]

Geometry:
  - wall slab (white), panel seams, t-nut grid
  - red relief band: traced facet shell + roof closure to the wall plane
  - red volumes: 5 pyramids, 3 slab prisms
  - 131 holds: displaced icospheres, seeded per hold, sitting on the
    local surface (wall, band facet or volume face)

Objects carry glTF extras: kind=route/structure, routeColor, holdId.
"""
import bpy, bmesh, json, math, os, random, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.expanduser("~/get-a-grip/gym_wall.glb")
RENDER = argv[1] if len(argv) > 1 else None

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "gym_data.json")))
W, H = D["size"]

# ---------------- scene reset ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m

def srgb(hexs):
    h = hexs.lstrip("#")
    return tuple((int(h[i:i+2], 16) / 255) ** 2.2 for i in (0, 2, 4))

M_WALL = mat("wall_white", srgb("F0F1EF"), 0.75)
M_RED = mat("volume_red", srgb("B32A22"), 0.6)
M_SEAM = mat("seam", srgb("C9CBC8"), 0.8)
M_TNUT = mat("tnut", srgb("3A3C3E"), 0.8)
HOLD_COL = {
    "grau": "83898E", "gruen": "3E9B48", "schwarz": "1A1B1D",
    "gelb": "F5C921", "blau": "2A6FD4", "weiss": "EFEFEA",
}
for k, v in HOLD_COL.items():
    mat("hold_" + k, srgb(v), 0.5)

def add_obj(name, verts, faces, material, extras=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    scene.collection.objects.link(ob)
    for k_, v_ in (extras or {}).items():
        ob[k_] = v_
    return ob

def P(p, z=0.0):
    """wall coords (x right, y up) + z out -> Blender (X, Y, Z), front = -Y"""
    return (p[0] - W / 2, -z, p[1])

# ---------------- wall slab ----------------
t = 0.12
add_obj("wall_structure",
        [(-W/2, 0, 0), (W/2, 0, 0), (W/2, 0, H), (-W/2, 0, H),
         (-W/2, t, 0), (W/2, t, 0), (W/2, t, H), (-W/2, t, H)],
        [(0, 1, 2, 3), (5, 4, 7, 6), (4, 0, 3, 7), (1, 5, 6, 2), (3, 2, 6, 7), (4, 5, 1, 0)],
        M_WALL, dict(kind="structure", part="wall"))

# panel seams (shallow proud strips) + t-nut grid on the white field
seam_x = [1.05, 2.32, 3.60, 4.88, 6.15]
seam_z = [1.62, 3.10]
sv, sf = [], []
def strip(x0, z0, x1, z1, w_):
    i = len(sv)
    if x0 == x1:
        sv.extend([(x0 - W/2 - w_, -0.002, z0), (x0 - W/2 + w_, -0.002, z0),
                   (x0 - W/2 + w_, -0.002, z1), (x0 - W/2 - w_, -0.002, z1)])
    else:
        sv.extend([(x0 - W/2, -0.002, z0 - w_), (x1 - W/2, -0.002, z0 - w_),
                   (x1 - W/2, -0.002, z1 + w_), (x0 - W/2, -0.002, z1 + w_)])
    sf.append((i, i + 1, i + 2, i + 3))
for sx in seam_x:
    strip(sx, 0.04, sx, H - 0.04, 0.004)
for sz in seam_z:
    strip(0.04, sz, W - 0.04, sz, 0.004)
add_obj("panel_seams", sv, sf, M_SEAM, dict(kind="structure", part="seams"))

tv, tf = [], []
for ix in range(1, int(W / 0.25)):
    for iz in range(1, int(H / 0.25)):
        cx, cz = ix * 0.25, iz * 0.25
        i = len(tv)
        for a in range(8):
            an = a / 8 * 2 * math.pi
            tv.append((cx - W/2 + 0.007 * math.cos(an), -0.003, cz + 0.007 * math.sin(an)))
        tf.append(tuple(range(i, i + 8)))
add_obj("tnuts", tv, tf, M_TNUT, dict(kind="structure", part="tnuts"))

# ---------------- red relief band ----------------
BV = D["band_v"]
names = list(BV.keys())
idx = {n: i for i, n in enumerate(names)}
bverts = [P(BV[n]["p"], BV[n]["z"]) for n in names]
bfaces = [tuple(idx[n] for n in f) for f in D["band_f"]]
# roof closure: top edge back to the wall plane
tops = ["T0", "T1", "T2", "T3", "T4", "T45", "T5"]
extra_v, extra_f = list(bverts), list(bfaces)
wall_idx = {}
for n in tops + ["T5", "E1"]:
    if n not in wall_idx:
        wall_idx[n] = len(extra_v)
        extra_v.append(P(BV[n]["p"], 0.0))
for a, b in zip(tops, tops[1:]):
    extra_f.append((idx[b], idx[a], wall_idx[a], wall_idx[b]))
extra_f.append((idx["E1"], idx["T5"], wall_idx["T5"]))  # right edge closure
band = add_obj("band_red", extra_v, extra_f, M_RED, dict(kind="structure", part="band"))

# ---------------- volumes ----------------
for i, py in enumerate(D["pyr"]):
    base = [P(p) for p in py["base"]]
    apex = P(py["apex"], py["h"])
    v = base + [apex]
    f = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    add_obj("volume_pyr_%d" % i, v, f, M_RED, dict(kind="structure", part="volume"))
for i, sl in enumerate(D["slab"]):
    fr = [P(p, sl["d"]) for p in sl["face"]]
    bk = [P(p) for p in sl["face"]]
    v = fr + bk
    f = [(0, 1, 2, 3)] + [((i0 + 1) % 4 + 4, i0 + 4, i0, (i0 + 1) % 4) for i0 in range(4)]
    add_obj("volume_slab_%d" % i, v, f, M_RED, dict(kind="structure", part="volume"))

# ---------------- surface height lookup (for holds on band/volumes) -------
def tri_z(px, pz, a, b, c):
    """z-out at (px,pz) if inside triangle a,b,c given as ((x,z), zout)"""
    (ax, az), za = a; (bx, bz), zb = b; (cx, cz), zc = c
    d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if abs(d) < 1e-9: return None
    w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
    w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
    w3 = 1 - w1 - w2
    if w1 < -0.02 or w2 < -0.02 or w3 < -0.02: return None
    return w1 * za + w2 * zb + w3 * zc

def surf_z(px, pz):
    best = 0.0
    for f in D["band_f"]:
        pts = [((BV[n]["p"][0], BV[n]["p"][1]), BV[n]["z"]) for n in f]
        for k in range(1, len(pts) - 1):
            z = tri_z(px, pz, pts[0], pts[k], pts[k + 1])
            if z is not None: best = max(best, z)
    for py in D["pyr"]:
        pts = [((p[0], p[1]), 0.0) for p in py["base"]]
        ap = ((py["apex"][0], py["apex"][1]), py["h"])
        for k in range(4):
            z = tri_z(px, pz, pts[k], pts[(k + 1) % 4], ap)
            if z is not None: best = max(best, z)
    for sl in D["slab"]:
        pts = [((p[0], p[1]), sl["d"]) for p in sl["face"]]
        for k in range(1, 3):
            z = tri_z(px, pz, pts[0], pts[k], pts[k + 1])
            if z is not None: best = max(best, z)
    return best

# ---------------- holds ----------------
def make_hold(i, hd):
    r = max(hd["r"], 0.035)
    rnd = random.Random(4200 + i)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    # organic displacement: three lobes of low-frequency noise
    lobes = [(rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0, 1), rnd.uniform(0.25, 0.5)) for _ in range(3)]
    for vtx in bm.verts:
        d = 0.0
        for (lx, ly, lz, amp) in lobes:
            dot = vtx.co.x * lx + vtx.co.y * ly + vtx.co.z * lz
            d += amp * max(0.0, dot)
        vtx.co *= (1.0 + 0.35 * d)
        if vtx.co.z < -0.15:  # flatten the back that bolts to the wall
            vtx.co.z = -0.15
    me = bpy.data.meshes.new("hold")
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new("route_%s_%03d" % (hd["c"], i), me)
    ob.data.materials.append(bpy.data.materials["hold_" + hd["c"]])
    scene.collection.objects.link(ob)
    x, z = hd["p"]
    zs = surf_z(x, z)
    ob.scale = (r, r * rnd.uniform(0.8, 1.0), r * 0.62)
    ob.rotation_euler = (math.radians(-90), 0, rnd.uniform(0, 6.28))
    ob.location = (x - W / 2, -(zs + 0.005), z)
    ob["kind"] = "route"; ob["routeColor"] = hd["c"]; ob["holdId"] = "%s_%03d" % (hd["c"], i)

for i, hd in enumerate(D["holds"]):
    make_hold(i, hd)

# ---------------- export ----------------
for ob in scene.collection.objects:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_extras=True,
                          export_yup=True, use_selection=True, export_apply=True)
print("EXPORTED", OUT)

# ---------------- optional verification render ----------------
if RENDER:
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = (-0.7, -7.6, 1.8)
    cam.rotation_euler = (math.radians(88), 0, math.radians(-5))
    cam.data.lens = 33
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 1.8
    sun.rotation_euler = (math.radians(55), math.radians(-15), math.radians(25))
    scene.collection.objects.link(sun)
    area = bpy.data.objects.new("area", bpy.data.lights.new("area", "AREA"))
    area.data.energy = 900; area.data.size = 8
    area.location = (0, -6, 3.5)
    area.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(area)
    world = bpy.data.worlds.new("w"); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.86, 0.88, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    scene.render.resolution_x = 1254
    scene.render.resolution_y = 1254
    scene.view_settings.view_transform = "Standard"
    # floor for grounding (render only, not exported)
    fl = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))
    fl.data.from_pydata([(-12, -12, 0), (12, -12, 0), (12, 12, 0), (-12, 12, 0)], [], [(0, 1, 2, 3)])
    fl.data.materials.append(mat("floor", srgb("C29A63"), 0.5))
    scene.collection.objects.link(fl)
    scene.render.filepath = RENDER
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", RENDER)
