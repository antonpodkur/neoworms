"""
Builds the seaside backdrop into the open Blender file: big cumulus clouds, two rows of hazy
islands (the near one with a lighthouse), and old mooring posts and a sailboat out on the sea.
art/scripts/render_backdrop.py renders each layer into a strip that the game repeats sideways;
backdrop_kit.py has the units and layer conventions. Here z = 0 is the horizon.

    blender --background --factory-startup --python art/scripts/seaside_backdrop.py -- art/backdrop/seaside.blend
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backdrop_kit import PX, STRIP, add_object, clear_scene, finish, make_layers, material, mesh_from, reflect, setup_render, srgb, tag, wrap  # noqa: E402

# The game's sky right above the horizon: distant things fade toward it.
HAZE = "#cdf1f6"
LAYERS = {
    "clouds": dict(anchor="horizon", offset=300, height=520, parallax=0.1, blur=1.0, drift=4),
    "islands_far": dict(anchor="horizon", offset=0, height=220, parallax=0.18, blur=1.2),
    "islands_near": dict(anchor="horizon", offset=-10, height=190, parallax=0.3, blur=0.6),
    "posts": dict(anchor="horizon", offset=-140, height=260, parallax=0.4, blur=1.0),
}
# Where the posts and the boat meet the water, below the horizon (they're nearer than the islands).
WATERLINE = -60 / PX


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.name = "Seaside"
    rng = random.Random(7)
    mats = make_materials()
    built = make_layers(scene, LAYERS)
    make_clouds(built["clouds"], mats, rng)
    make_islands(built["islands_far"], mats["island_far"], rng, count=5, height=(5, 11), width=(26, 44), depth=40)
    tallest = make_islands(built["islands_near"], mats["island_near"], rng, count=4, height=(4, 8.5), width=(18, 32), depth=20)
    make_lighthouse(built["islands_near"], mats, tallest)
    make_posts(built["posts"], mats, rng)
    make_sailboat(built["posts"], mats, Vector((STRIP * 0.62, 6, WATERLINE + 0.3)))
    reflect(built["posts"], mats["reflection"], WATERLINE)
    for layer in built.values():
        wrap(layer)
    # Sky-blue fill, so shaded sides turn soft blue.
    setup_render(scene, sun_energy=3.0, sun_color="#ffffff", world_color="#8cc6ea", world_strength=0.9)
    return {name: len(layer.objects) for name, layer in built.items()}


# --- Materials -----------------------------------------------------------------------------------


def hazy(name, color, haze=0.0, **kwargs):
    return material(name, color, haze=haze, haze_color=HAZE, **kwargs)


def reflection_material():
    """Things mirrored in the sea: dark, see-through, fading out a few units below the water."""
    mat = tag(bpy.data.materials.new("Reflection"))
    mat.use_nodes = True
    mat.surface_render_method = "BLENDED"
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb("#1f7a68")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Emission Color"].default_value = srgb("#1f7a68")
    bsdf.inputs["Emission Strength"].default_value = 0.6
    depth = nodes.new("ShaderNodeSeparateXYZ")
    links.new(nodes.new("ShaderNodeNewGeometry").outputs["Position"], depth.inputs[0])
    fade = nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = WATERLINE - 5
    fade.inputs["From Max"].default_value = WATERLINE
    fade.inputs["To Min"].default_value = 0.0
    fade.inputs["To Max"].default_value = 0.45
    links.new(depth.outputs["Z"], fade.inputs["Value"])
    links.new(fade.outputs["Result"], bsdf.inputs["Alpha"])
    return mat


def make_materials():
    return {
        "cloud": hazy("Cloud", "#ffffff", roughness=1.0, glow=0.12),
        "island_far": hazy("IslandFar", "#5d9fc8", haze=0.55),
        "island_near": hazy("IslandNear", "#4d8fbd", haze=0.3),
        "tower": hazy("LighthouseWhite", "#f4f1e8", haze=0.3),
        "band": hazy("LighthouseRed", "#c8463c", haze=0.3),
        "lamp": hazy("LighthouseLamp", "#ffe9a8", haze=0.2, glow=2.0),
        "wood": hazy("Wood", "#9a7a4a", haze=0.35),
        "rope": hazy("Rope", "#d2bb84", haze=0.35),
        "algae": hazy("Algae", "#3f6a4a", haze=0.35),
        "reflection": reflection_material(),
        "hull": hazy("Hull", "#f2efe6", haze=0.35),
        "stripe": hazy("HullStripe", "#3d78b5", haze=0.35),
        "sail": hazy("Sail", "#fbf6e9", haze=0.35, glow=0.2),
    }


# --- Meshes --------------------------------------------------------------------------------------


def make_clouds(layer, mats, rng):
    """A few cumulus heaps: round puffs piled into a dome on a flat base, like cauliflower."""
    count = 4
    for i in range(count):
        cx = (i + 0.25 + rng.random() * 0.5) / count * STRIP
        size = 3.2 + rng.random() * 2.6
        base = 300 / PX + 3 + rng.random() * 14

        def build(bm, size=size):
            puffs = []
            # A wide bottom row, a row of bigger puffs above it, and a crown or two.
            n = 5 + rng.randrange(3)
            for k in range(n):
                t = k / (n - 1) - 0.5
                r = size * (0.55 + 0.3 * rng.random()) * (1 - abs(t) * 0.5)
                puffs.append((t * size * 4.0, rng.uniform(-0.3, 0.3) * size, r * 0.55, r))
            for k in range(3):
                t = (k - 1) * 0.36 + rng.uniform(-0.08, 0.08)
                r = size * (0.8 + 0.3 * rng.random())
                puffs.append((t * size * 2.6, rng.uniform(-0.3, 0.3) * size, size * 0.9 + r * 0.25, r))
            for k in range(1 + rng.randrange(2)):
                r = size * (0.7 + 0.25 * rng.random())
                puffs.append((rng.uniform(-0.5, 0.5) * size, rng.uniform(-0.2, 0.2) * size, size * 1.75, r))
            for x, y, z, r in puffs:
                ball = bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
                bmesh.ops.translate(bm, vec=(x, y, z), verts=ball["verts"])
            for v in bm.verts:
                v.co.z = max(v.co.z, 0)  # the flat base, as if the cloud sat on a layer of air

        mesh = mesh_from(f"Cloud{i}", build)
        cloud = add_object(layer, f"cloud{i}", mesh, (cx, 30 + rng.random() * 10, base), [mats["cloud"]])
        # Melt the puffs into one soft heap: rebuild the surface as a single skin, then smooth it.
        melt = cloud.modifiers.new("Melt", "REMESH")
        melt.mode = "VOXEL"
        melt.voxel_size = 0.18
        melt.use_smooth_shade = True
        soften = cloud.modifiers.new("Soften", "SMOOTH")
        soften.factor = 1.0
        soften.iterations = 12


def make_islands(layer, mat, rng, count, height, width, depth):
    """Lumpy hills rising out of the sea along the horizon. Returns the highest point of them all."""
    tallest = Vector((0, 0, -math.inf))
    for i in range(count):
        cx = (i + 0.2 + rng.random() * 0.6) / count * STRIP
        w = rng.uniform(*width)
        h = rng.uniform(*height)
        seed = rng.random() * 100

        def build(bm, w=w, h=h, seed=seed):
            bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=1)
            offset = Vector((seed, seed * 2, seed * 3))
            for v in bm.verts:
                x, y, z = v.co
                # Peaks and saddles along the ridge, and rocky lumps all over.
                ridge = 0.55 + 0.45 * (0.5 + 0.5 * noise.noise(Vector((x * 2.2, 0, 0)) + offset))
                lumps = 1 + 0.22 * noise.noise(v.co * 3 + offset) + 0.08 * noise.noise(v.co * 9 + offset)
                v.co = Vector((x * w / 2 * lumps, y * depth / 2, z * h * ridge * lumps))

        mesh = mesh_from(f"Island{layer.name}{i}", build)
        y = 60 + depth + rng.random() * 10
        island = add_object(layer, f"{layer.name}.island{i}", mesh, (cx, y, -h * 0.25), [mat])
        peak = max((island.location + v.co for v in mesh.vertices), key=lambda p: p.z)
        if peak.z > tallest.z:
            tallest = peak
    return tallest


def make_lighthouse(layer, mats, at):
    """A white tower with red bands and a lit lamp, standing on the highest point `at`."""

    def cone(name, r1, r2, depth, z, mat):
        mesh = mesh_from(name, lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r1, radius2=r2, depth=depth))
        # Its foot a little sunk into the hilltop.
        add_object(layer, name, mesh, (at.x, at.y - 0.5, at.z - 0.3 + z + depth / 2), [mat])

    cone("LighthouseTower", 0.55, 0.36, 3.6, 0, mats["tower"])
    for k, z in enumerate((0.7, 1.9)):
        cone(f"LighthouseBand{k}", 0.52 - z * 0.05, 0.49 - z * 0.05, 0.5, z, mats["band"])
    cone("LighthouseGallery", 0.55, 0.55, 0.15, 3.6, mats["band"])
    cone("LighthouseLamp", 0.3, 0.3, 0.55, 3.75, mats["lamp"])
    cone("LighthouseRoof", 0.42, 0.02, 0.55, 4.3, mats["band"])


def make_posts(layer, mats, rng):
    """Old mooring posts in leaning clusters, weedy at the waterline, and what's left of a jetty."""

    def post(name, x, y, h, r, lean):
        def build(bm):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r * 0.9, depth=h)
            bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
            # A rounded, worn top, and a band of rope a little below it.
            top = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=r * 0.9)
            bmesh.ops.translate(bm, vec=(0, 0, h), verts=top["verts"])
            rope = bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=r * 1.08, radius2=r * 1.08, depth=0.35)
            bmesh.ops.translate(bm, vec=(0, 0, h * 0.8), verts=rope["verts"])
            for face in bm.faces:
                c = face.calc_center_median()
                face.material_index = 1 if c.z < 1.4 else 2 if abs(c.z - h * 0.8) < 0.2 and c.xy.length > r else 0

        obj = add_object(layer, name, mesh_from(name, build), (x, y, WATERLINE - 0.5), [mats["wood"], mats["algae"], mats["rope"]])
        obj.rotation_euler = (0, math.radians(lean), 0)
        return obj

    clusters = 4
    for c in range(clusters):
        cx = (c + 0.15 + rng.random() * 0.7) / clusters * STRIP
        for k in range(2 + rng.randrange(3)):
            post(f"post{c}_{k}", cx + k * rng.uniform(1.1, 1.8), rng.uniform(0, 4), rng.uniform(2.6, 5.5), rng.uniform(0.25, 0.36), rng.uniform(-7, 7))
    # A broken jetty: a row of posts carrying a plank deck that stops short.
    jx = STRIP * 0.3
    for k in range(6):
        post(f"jetty{k}", jx + k * 1.6, 8, 3.4 + rng.uniform(-0.15, 0.15), 0.28, rng.uniform(-2, 2))
    deck = mesh_from("JettyDeck", lambda bm: bmesh.ops.create_cube(bm, size=1), smooth=False)
    obj = add_object(layer, "jetty.deck", deck, (jx + 2.8, 8, WATERLINE + 2.7), [mats["wood"]])
    obj.scale = (6.4, 1.1, 0.25)


def make_sailboat(layer, mats, at, size=0.7):
    """A small sailboat: a rounded hull with a stripe, a mast and two sails, `size` times full size."""
    before = set(layer.objects)

    def hull(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1)
        for v in bm.verts:
            x, y, z = v.co
            z = min(z, 0.35)  # a flat deck
            v.co = Vector((x * 2.6 * (1 + 0.15 * z), y * 0.8, z * 0.8))
            v.co.x += 0.5 * max(0, x) * (z + 0.3)  # a raised bow

    mesh = mesh_from("Hull", hull)
    for poly in mesh.polygons:
        poly.material_index = 1 if -0.25 < poly.center.z < 0.0 else 0
    add_object(layer, "boat.hull", mesh, at, [mats["hull"], mats["stripe"]])
    mast = mesh_from("Mast", lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.08, radius2=0.06, depth=6))
    add_object(layer, "boat.mast", mast, at + Vector((0.2, 0, 3.2)), [mats["wood"]])

    def sail(points):
        def build(bm):
            verts = [bm.verts.new(p) for p in points]
            bm.faces.new(verts)

        return mesh_from("Sail", build, smooth=False)

    add_object(layer, "boat.mainsail", sail([(0.05, -0.1, 0.6), (0.05, -0.1, 6), (-2.3, -0.1, 0.7)]), at + Vector((0.2, 0, 0)), [mats["sail"]])
    add_object(layer, "boat.jib", sail([(0.35, -0.1, 0.6), (0.35, -0.1, 5.4), (2.2, -0.1, 0.5)]), at + Vector((0.2, 0, 0)), [mats["sail"]])
    for part in set(layer.objects) - before:
        part.location = at + (part.location - at) * size
        part.scale = (size, size, size)


finish(main())
