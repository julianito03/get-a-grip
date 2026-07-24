#!/usr/bin/env python3
"""Gym wall (photo d7d842ce, July 2026) -> 3D build data.

Near-frontal photo of a school-gym bouldering wall:
flat white panel field, folded red relief band along the top,
red diamond/slab volumes, ~110 bolt-on holds.

All coordinates below are photo pixels, traced by eye from 2x crops.
The script maps them through the wall quad into metres and writes
gym_data.json for tools/gym_build.py (Blender).
"""
import json, math, os

# wall quad in the photo (tl, tr, br, bl) and real size in metres
QUAD = [(97, 175), (1203, 283), (1205, 1032), (55, 1110)]
W, H = 6.3, 4.4

# ---- red relief band ----------------------------------------------------
# vertex: (photo x, photo y, z out of wall in metres)
BAND_V = {
    "T0": (97, 175, 0.0),    # top-left corner, band meets wall plane
    "T1": (510, 168, 0.45),  # top edge above the prow ridge
    "T2": (627, 170, 0.35),
    "T3": (795, 193, 0.42),
    "T4": (862, 217, 0.40),
    "T45": (1085, 258, 0.38),
    "T5": (1203, 283, 0.30),  # top-right corner
    "V1": (549, 696, 0.0),   # deep V tip
    "K1": (702, 477, 0.0),   # white apex 1
    "V2": (922, 682, 0.0),   # red spike tip
    "K2": (980, 438, 0.0),   # white wedge apex
    "K3": (1093, 505, 0.0),
    "E1": (1205, 575, 0.0),  # band boundary meets right wall edge
}
BAND_F = [
    ["T0", "T1", "V1"],
    ["T1", "T2", "K1", "V1"],
    ["T2", "T3", "V2", "K1"],
    ["T3", "T4", "K2", "V2"],
    ["T4", "T45", "K3", "K2"],
    ["T45", "T5", "E1", "K3"],
]

# ---- red volumes on the white field -------------------------------------
# pyramids: 4 base corners (photo) + apex (photo x, y) + apex height (m)
PYR = [
    dict(base=[(165, 615), (252, 538), (340, 615), (255, 692)], apex=(247, 607), h=0.28),
    dict(base=[(337, 795), (392, 742), (442, 790), (388, 845)], apex=(383, 788), h=0.20),
    dict(base=[(482, 945), (544, 885), (600, 940), (538, 1000)], apex=(536, 937), h=0.20),
    dict(base=[(603, 713), (648, 618), (683, 688), (645, 758)], apex=(640, 700), h=0.16),
    dict(base=[(882, 602), (930, 527), (1003, 613), (952, 690)], apex=(940, 607), h=0.18),
]
# slabs: 4 front corners + prism depth
SLAB = [
    dict(face=[(820, 790), (872, 763), (900, 843), (846, 870)], d=0.12),
    dict(face=[(1066, 700), (1108, 671), (1153, 753), (1111, 783)], d=0.12),
    dict(face=[(1016, 930), (1077, 872), (1099, 896), (1038, 953)], d=0.10),
]

# ---- holds: (photo x, y, colour, radius px) ------------------------------
HOLDS = [
    # upper left (red band, left facet)
    (172, 204, "grau", 18), (240, 202, "schwarz", 12), (315, 200, "gruen", 15),
    (317, 237, "schwarz", 12), (435, 245, "gruen", 16), (415, 320, "grau", 20),
    (465, 305, "gruen", 16), (352, 342, "schwarz", 12), (425, 385, "gruen", 16),
    (497, 387, "gelb", 10), (496, 415, "gelb", 10), (322, 415, "gruen", 12),
    (360, 445, "gruen", 14), (462, 460, "grau", 17), (391, 447, "schwarz", 11),
    (410, 475, "weiss", 14), (527, 507, "weiss", 10),
    # white field left
    (133, 372, "grau", 15), (270, 465, "grau", 17), (265, 435, "schwarz", 10),
    (200, 470, "gruen", 13), (202, 500, "schwarz", 11), (357, 562, "gelb", 16),
    (317, 567, "schwarz", 9), (338, 622, "schwarz", 10), (232, 595, "grau", 12),
    (382, 652, "gruen", 11), (407, 653, "schwarz", 9), (452, 610, "schwarz", 11),
    (500, 655, "gruen", 10),
    # centre of band (prow + spike facets)
    (657, 405, "gruen", 11), (700, 462, "gruen", 12), (745, 208, "gelb", 18),
    (848, 225, "weiss", 14), (800, 245, "blau", 16), (787, 238, "gruen", 12),
    (785, 305, "weiss", 16), (835, 290, "blau", 12), (955, 285, "gelb", 18),
    (745, 365, "gruen", 13), (795, 380, "blau", 12), (755, 405, "blau", 11),
    (850, 390, "weiss", 14), (930, 380, "gelb", 11), (990, 395, "grau", 10),
    (1030, 410, "schwarz", 14), (792, 485, "blau", 14), (1003, 465, "gelb", 12),
    (975, 452, "grau", 9), (1102, 387, "schwarz", 16), (1145, 326, "schwarz", 12),
    (1095, 325, "grau", 15), (1042, 505, "schwarz", 12), (1077, 477, "schwarz", 9),
    # white field centre
    (697, 592, "blau", 12), (747, 652, "weiss", 10),
    (782, 632, "schwarz", 9), (830, 617, "gelb", 10), (843, 578, "grau", 10),
    (855, 600, "gelb", 13), (897, 637, "weiss", 13), (925, 617, "schwarz", 10),
    (960, 630, "grau", 12), (985, 563, "gelb", 11), (855, 662, "schwarz", 8),
    # centre field below the V (was missed on first pass)
    (550, 785, "gelb", 14), (582, 785, "schwarz", 12), (638, 783, "grau", 17),
    (695, 783, "gruen", 11), (607, 852, "schwarz", 11), (735, 878, "schwarz", 11),
    (618, 537, "gruen", 12), (687, 522, "blau", 11), (733, 537, "gruen", 14),
    (722, 568, "weiss", 13), (672, 590, "gelb", 13), (1178, 325, "schwarz", 16),
    # bottom left
    (120, 690, "grau", 12), (315, 690, "gelb", 16), (272, 725, "gruen", 12),
    (168, 790, "gelb", 20), (268, 795, "grau", 11), (152, 948, "grau", 14),
    (340, 975, "gelb", 12), (412, 1000, "gruen", 12), (383, 718, "gruen", 11),
    (518, 675, "grau", 18), (578, 686, "schwarz", 11), (478, 750, "gruen", 12),
    (404, 771, "schwarz", 10), (408, 808, "gruen", 10), (445, 855, "grau", 16),
    (480, 888, "schwarz", 9), (475, 925, "gruen", 10), (560, 932, "gruen", 9),
    (600, 987, "grau", 17), (637, 985, "schwarz", 9),
    # bottom right
    (645, 658, "blau", 10), (675, 647, "gruen", 8), (697, 655, "gruen", 10),
    (845, 648, "schwarz", 14), (1005, 660, "weiss", 12), (868, 692, "blau", 14),
    (950, 690, "schwarz", 14), (815, 720, "gruen", 12), (985, 720, "blau", 14),
    (790, 748, "weiss", 13), (843, 750, "gruen", 11), (900, 745, "schwarz", 13),
    (952, 748, "blau", 12), (1048, 750, "gelb", 15), (1036, 777, "grau", 10),
    (1000, 775, "weiss", 14), (925, 780, "gelb", 12), (786, 785, "blau", 8),
    (787, 807, "gruen", 11), (833, 798, "schwarz", 10), (868, 810, "blau", 10),
    (955, 812, "weiss", 12), (1005, 805, "schwarz", 10), (1107, 690, "grau", 11),
    (1123, 732, "weiss", 10), (932, 840, "blau", 10), (928, 872, "schwarz", 9),
    (905, 900, "weiss", 12), (928, 902, "blau", 10), (960, 930, "schwarz", 10),
    (930, 965, "gruen", 12), (876, 970, "schwarz", 10), (1010, 988, "blau", 11),
    (1110, 925, "grau", 11),
]

# ---- mapping -------------------------------------------------------------
def bilerp(q, u, v):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = q
    tx, ty = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
    bx, by = x3 + (x2 - x3) * u, y3 + (y2 - y3) * u
    return (tx + (bx - tx) * v, ty + (by - ty) * v)

def inv(q, x, y):
    u = v = 0.5
    for _ in range(60):
        px, py = bilerp(q, u, v)
        d = 1e-4
        ju = bilerp(q, u + d, v); jv = bilerp(q, u, v + d)
        a, b_, c, dd = (ju[0]-px)/d, (jv[0]-px)/d, (ju[1]-py)/d, (jv[1]-py)/d
        det = a * dd - b_ * c
        if abs(det) < 1e-12: break
        ex, ey = x - px, y - py
        u += (dd * ex - b_ * ey) / det
        v += (-c * ex + a * ey) / det
    return u, v

def to_wall(x, y):
    """photo px -> (X right, Z up) metres on the wall plane"""
    u, v = inv(QUAD, x, y)
    return (u * W, (1 - v) * H)

def scale_at(x, y):
    u, v = inv(QUAD, x, y)
    d = 0.01
    p0 = bilerp(QUAD, u, v); p1 = bilerp(QUAD, u + d, v)
    return (d * W) / math.dist(p0, p1)  # metres per photo px (horizontal)

data = dict(size=[W, H])
data["band_v"] = {k: dict(p=to_wall(x, y), z=z) for k, (x, y, z) in BAND_V.items()}
data["band_f"] = BAND_F
data["pyr"] = [dict(base=[to_wall(*p) for p in o["base"]], apex=to_wall(*o["apex"]), h=o["h"]) for o in PYR]
data["slab"] = [dict(face=[to_wall(*p) for p in o["face"]], d=o["d"]) for o in SLAB]
data["holds"] = [dict(p=to_wall(x, y), c=c, r=r * scale_at(x, y)) for (x, y, c, r) in HOLDS]

out = os.path.join(os.path.dirname(__file__), "gym_data.json")
json.dump(data, open(out, "w"))
print("holds:", len(data["holds"]), "band verts:", len(data["band_v"]),
      "volumes:", len(data["pyr"]) + len(data["slab"]), "->", out)

# overlay debug (photo space) for verification
dbg = dict(quad=QUAD,
           band=[[BAND_V[k][:2] for k in f] for f in BAND_F],
           pyr=[o["base"] + [o["apex"]] for o in PYR],
           slab=[o["face"] for o in SLAB],
           holds=[[x, y, r, c] for (x, y, c, r) in HOLDS])
S = "/private/tmp/claude-501/-Users-juliandegen/3f43f39c-d55e-4d62-911c-9358f20796e5/scratchpad"
if os.path.isdir(S):
    open(os.path.join(S, "gym-overlay-data.js"), "w").write("const GY=" + json.dumps(dbg) + ";")
    print("overlay data written")
