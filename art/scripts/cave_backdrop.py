"""
Builds the cave backdrop into the open Blender file: stalactites hanging from a rocky roof and
mounds and stalagmites rising from the floor, in two rows that fade into the cave's murk, with a
few faintly glowing crystals in the near row. art/scripts/render_backdrop.py renders each layer
into a strip that the game repeats sideways; backdrop_kit.py has the units and layer
conventions. The roof rows hang from the top of the map (z = 0 there), the floor rows stand on
the water (z = 0 there).

    blender --background --factory-startup --python art/scripts/cave_backdrop.py -- art/backdrop/cave.blend
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backdrop_kit import PX, STRIP, add_object, clear_scene, finish, make_layers, material, mesh_from, setup_render, wrap  # noqa: E402

# The cave's murky air: distant rock fades toward it (the game's cave backdrop colour).
MURK = "#271b15"
LAYERS = {
    "roof_far": dict(anchor="top", offset=0, height=440, parallax=0.3, blur=1.6),
    "floor_far": dict(anchor="water", offset=-10, height=400, parallax=0.3, blur=1.6),
    "roof_near": dict(anchor="top", offset=0, height=340, parallax=0.5, blur=0.8),
    "floor_near": dict(anchor="water", offset=-10, height=320, parallax=0.5, blur=0.8),
}


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.name = "Cave"
    rng = random.Random(3)
    far = material("RockFar", "#6b5040", haze=0.6, haze_color=MURK)
    near = material("RockNear", "#5a4232", haze=0.35, haze_color=MURK)
    crystal = material("Crystal", "#6fe3d2", haze=0.1, haze_color=MURK, roughness=0.3, glow=2.5)
    built = make_layers(scene, LAYERS)
    make_roof(built["roof_far"], far, rng, spikes=26, length=(5, 22), height=440 / PX)
    make_roof(built["roof_near"], near, rng, spikes=16, length=(4, 16), height=340 / PX)
    make_floor(built["floor_far"], far, rng, mounds=6, peaks=(8, 20), spikes=10)
    make_floor(built["floor_near"], near, rng, mounds=5, peaks=(6, 15), spikes=7)
    make_crystals(built["floor_near"], crystal, rng)
    for layer in built.values():
        wrap(layer)
    # A dim, warm light from the upper left and the murk as fill: the cave is lit, but barely.
    setup_render(scene, sun_energy=1.6, sun_color="#ffd8a8", world_color="#3a2a21", world_strength=0.8)
    return {name: len(layer.objects) for name, layer in built.items()}


def lumpy(v, offset, amount):
    """Rocky lumps: pushes a vertex in or out by a bit of noise."""
    return v * (1 + amount * noise.noise(v * 1.5 + offset) + amount * 0.4 * noise.noise(v * 4 + offset))


def make_roof(layer, mat, rng, spikes, length, height):
    """A ceiling of rock along the top with stalactites of all sizes hanging from it."""
    # The roof itself: a long lumpy slab whose underside dips and bulges.
    for i in range(4):
        cx = (i + 0.5) / 4 * STRIP
        seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))

        def slab(bm, seed=seed):
            bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=32, radius=1)
            for v in bm.verts:
                v.co = lumpy(Vector((v.co.x * 22, v.co.y * 10, v.co.z * 4)), seed, 0.18)

        add_object(layer, f"{layer.name}.slab{i}", mesh_from(f"Slab{layer.name}{i}", slab), (cx, 40, 0.5), [mat])
    for k in range(spikes):
        x = rng.random() * STRIP
        long = rng.uniform(*length)
        r = long * rng.uniform(0.12, 0.2)
        seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))

        def spike(bm, long=long, r=r, seed=seed, bend=rng.uniform(-0.5, 0.5)):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r * 0.04, depth=long)
            bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.01], cuts=8)
            for v in bm.verts:
                v.co = lumpy(v.co, seed, 0.22)
                # Drips don't hang dead straight: a slight curve toward the tip.
                v.co.x += bend * ((0.5 - v.co.z / long) ** 2) * r * 2

        obj = add_object(layer, f"{layer.name}.spike{k}", mesh_from(f"Spike{layer.name}{k}", spike), (x, 32 + rng.random() * 8, -long / 2 - 1), [mat])
        obj.rotation_euler = (math.pi, math.radians(rng.uniform(-6, 6)), 0)  # hanging point-down
        if -long - 1 < -height:
            obj.scale.z = (height - 1) / (long + 1)  # keep the tip inside the strip


def make_floor(layer, mat, rng, mounds, peaks, spikes):
    """Rock mounds along the floor with stalagmites rising between them."""
    for i in range(mounds):
        cx = (i + 0.2 + rng.random() * 0.6) / mounds * STRIP
        w = rng.uniform(18, 34)
        h = rng.uniform(*peaks)
        seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))

        def mound(bm, w=w, h=h, seed=seed):
            bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=1)
            for v in bm.verts:
                v.co = lumpy(Vector((v.co.x * w / 2, v.co.y * 8, v.co.z * h)), seed, 0.15)

        add_object(layer, f"{layer.name}.mound{i}", mesh_from(f"Mound{layer.name}{i}", mound), (cx, 45 + rng.random() * 8, -h * 0.3), [mat])
    for k in range(spikes):
        long = rng.uniform(4, 12)
        r = long * rng.uniform(0.14, 0.22)
        seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))

        def spike(bm, long=long, r=r, seed=seed):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r * 0.06, depth=long)
            bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.01], cuts=6)
            for v in bm.verts:
                v.co = lumpy(v.co, seed, 0.12)

        add_object(layer, f"{layer.name}.spike{k}", mesh_from(f"Mite{layer.name}{k}", spike), (rng.random() * STRIP, 38, long / 2 - 0.5), [mat])


def make_crystals(layer, mat, rng):
    """Small clusters of glowing crystals sprouting from the near floor."""
    for c in range(5):
        cx = (c + 0.3 + rng.random() * 0.4) / 5 * STRIP
        for k in range(3 + rng.randrange(3)):
            long = rng.uniform(0.8, 2.2)

            def shard(bm, long=long):
                bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=long * 0.18, radius2=0.0, depth=long)

            obj = add_object(layer, f"crystal{c}_{k}", mesh_from(f"Crystal{c}_{k}", shard, smooth=False), (cx + rng.uniform(-1, 1), 30, long / 2), [mat])
            obj.rotation_euler = (math.radians(rng.uniform(-15, 15)), math.radians(rng.uniform(-35, 35)), 0)


finish(main())
