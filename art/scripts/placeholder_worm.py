"""
Builds the placeholder worm into the open Blender file: a rigged tube body with eyes, a bazooka,
the sprite camera and lights, and a few procedural animations. The real, hand-made worm replaces
it later; the camera, lights, render settings and the action conventions stay.

Units: 1 Blender unit = the worm's collision radius (8 game pixels). The collision circle is
centred on the origin, so a standing worm's ground is z = -1. The camera looks along +Y, so the
screen is the XZ plane (x right, z up). The worm faces +X; the game mirrors it to face left.

Action conventions (what art/scripts/render_sprites.py reads):
  action["sprite"] = True       render this action into the sprite sheet
  action["fps"] = 24            playback speed in the game
  action["weapon"] = "bazooka"  show the object "weapon.bazooka" (other "weapon.*" are hidden)
  Manual Frame Range            the frames to render; with Cyclic Animation on, the last frame
                                repeats the first and isn't rendered
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Spine from the tail tip to the top of the head: (x, z) and the body's radius there.
SPINE = [
    ((-1.40, -0.85), 0.15),
    ((-0.95, -0.70), 0.30),
    ((-0.45, -0.56), 0.44),
    ((0.00, -0.47), 0.52),
    ((0.18, 0.05), 0.53),
    ((0.15, 0.60), 0.55),
    ((0.08, 1.05), 0.57),
    ((0.02, 1.35), 0.52),
]
# Deforming bones: name, first and last spine point, parent, connected to the parent.
BONES = [
    ("hips", 3, 2, "root", False),
    ("tail.01", 2, 1, "hips", True),
    ("tail.02", 1, 0, "tail.01", True),
    ("spine", 3, 4, "hips", False),
    ("neck", 4, 5, "spine", True),
    ("head", 5, 7, "neck", True),
]
RING = 16  # vertices around the body
CAP_RINGS = 4  # rings that round off each end
SAMPLES = 56  # rings along the body
BLEND = 0.15  # how far a bone's influence fades past its joint
FACE_TURN = math.radians(55)  # the face turns this much toward the camera (3/4 view)
PUPIL_TURN = math.radians(25)  # and the pupils look this much further toward where it's going
AIM_PIVOT = (0.10, 0.35)  # chest height; the bazooka's barrel passes through it
OUTLINE = 0.05

SKIN = "#f2a29a"
OUTLINE_COLOR = "#5a2230"
TOWARD_CAMERA = Vector((0, -1, 0))


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.name = "Worm"
    mats = make_materials()
    rig = make_rig()
    body = make_body(rig, mats)
    make_eyes(rig, mats)
    make_bazooka(rig, mats)
    setup_render(scene)
    make_actions(rig)
    rig.animation_data.action = bpy.data.actions["idle"]
    scene.frame_start, scene.frame_end = 1, 48
    scene.frame_set(1)
    return {"objects": [o.name for o in scene.objects], "actions": [a.name for a in bpy.data.actions], "body_verts": len(body.data.vertices)}


MADE = {
    "objects": ["WormRig", "WormBody", "WormEye.L", "WormEye.R", "weapon.bazooka", "SpriteCamera", "KeyLight", "FillLight", "RimLight"],
    "meshes": ["WormBody", "WormEye", "Bazooka"],
    "armatures": ["WormRig"],
    "cameras": ["SpriteCamera"],
    "lights": ["KeyLight", "FillLight", "RimLight"],
    "materials": ["Skin", "EyeWhite", "Pupil", "Olive", "DarkMetal", "Outline"],
    "actions": ["idle", "walk", "jump", "fly_up", "fly_down", "aim_bazooka"],
}


def clear_scene():
    """Removes the startup file's cube, light and camera, and whatever an earlier run of this
    script made, so it can be run again after a tweak."""
    for name in ("Cube", "Light", "Camera"):
        if obj := bpy.data.objects.get(name):
            bpy.data.objects.remove(obj)
    for kind, names in MADE.items():
        collection = getattr(bpy.data, kind)
        for name in names:
            if block := collection.get(name):
                collection.remove(block)


# --- Body ----------------------------------------------------------------------------------------


def spine_samples():
    """Points along a Catmull-Rom curve through SPINE, evenly spaced, with radius and arc length.
    Also returns the arc length at each control point (where the bones' joints are)."""
    pts = [Vector((x, 0, z)) for (x, z), _ in SPINE]
    radii = [r for _, r in SPINE]
    ext = [2 * pts[0] - pts[1], *pts, 2 * pts[-1] - pts[-2]]
    dense, dense_r, joint_s = [], [], [0.0]
    s = 0.0
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for k in range(40):
            t = k / 40
            p = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)
            if dense:
                s += (p - dense[-1][0]).length
            dense.append((p, s))
            u = t * t * (3 - 2 * t)
            dense_r.append(radii[i] + (radii[i + 1] - radii[i]) * u)
        # Arc length at the next control point.
        s_next = s + (pts[i + 1] - dense[-1][0]).length
        joint_s.append(s_next)
    s += (pts[-1] - dense[-1][0]).length
    dense.append((pts[-1], s))
    dense_r.append(radii[-1])
    length = s

    samples = []
    j = 0
    for k in range(SAMPLES):
        target = length * k / (SAMPLES - 1)
        while j < len(dense) - 2 and dense[j + 1][1] < target:
            j += 1
        (pa, sa), (pb, sb) = dense[j], dense[j + 1]
        f = 0 if sb == sa else (target - sa) / (sb - sa)
        samples.append((pa.lerp(pb, f), dense_r[j] + (dense_r[j + 1] - dense_r[j]) * f, target))
    return samples, joint_s


def make_body(rig, mats):
    samples, joint_s = spine_samples()
    verts, vert_s, faces = [], [], []

    def tangent(k):
        a = samples[max(k - 1, 0)][0]
        b = samples[min(k + 1, len(samples) - 1)][0]
        return (b - a).normalized()

    def ring(center, t, r, s):
        n = Vector((-t.z, 0, t.x))  # perpendicular to the spine, in the screen plane
        start = len(verts)
        for i in range(RING):
            a = 2 * math.pi * i / RING
            verts.append(center + r * (math.cos(a) * n + math.sin(a) * TOWARD_CAMERA))
            vert_s.append(s)
        return start

    rings = []
    # Tail cap: from the pole out to the first full ring.
    p0, r0, _ = samples[0]
    t0 = tangent(0)
    verts.append(p0 - t0 * r0)
    vert_s.append(0.0)
    tail_pole = 0
    for c in range(CAP_RINGS, 0, -1):
        a = math.pi / 2 * c / (CAP_RINGS + 1)
        rings.append(ring(p0 - t0 * r0 * math.sin(a), t0, r0 * math.cos(a), 0.0))
    for k, (p, r, s) in enumerate(samples):
        rings.append(ring(p, tangent(k), r, s))
    p1, r1, s1 = samples[-1]
    t1 = tangent(len(samples) - 1)
    for c in range(1, CAP_RINGS + 1):
        a = math.pi / 2 * c / (CAP_RINGS + 1)
        rings.append(ring(p1 + t1 * r1 * math.sin(a), t1, r1 * math.cos(a), s1))
    verts.append(p1 + t1 * r1)
    vert_s.append(s1)
    head_pole = len(verts) - 1

    for i in range(RING):
        j = (i + 1) % RING
        faces.append((tail_pole, rings[0] + j, rings[0] + i))
        faces.append((head_pole, rings[-1] + i, rings[-1] + j))
        for a, b in zip(rings, rings[1:]):
            faces.append((a + i, a + j, b + j, b + i))

    mesh = bpy.data.meshes.new("WormBody")
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(mats["skin"])
    mesh.materials.append(mats["outline"])
    body = bpy.data.objects.new("WormBody", mesh)
    bpy.context.scene.collection.objects.link(body)
    body.parent = rig

    # Weights: each bone owns a stretch of the spine, blending into its neighbours at the joints.
    groups = {name: body.vertex_groups.new(name=name) for name, *_ in BONES}
    spans = {name: (joint_s[a], joint_s[b]) if a < b else (joint_s[b], joint_s[a]) for name, a, b, *_ in BONES}
    first = min(spans, key=lambda n: spans[n][0])
    last = max(spans, key=lambda n: spans[n][1])
    for v, s in enumerate(vert_s):
        for name, (lo, hi) in spans.items():
            w_lo = 1.0 if name == first else min(max((s - lo) / (2 * BLEND) + 0.5, 0), 1)
            w_hi = 1.0 if name == last else min(max((hi - s) / (2 * BLEND) + 0.5, 0), 1)
            w = min(w_lo, w_hi)
            if w > 0:
                groups[name].add([v], w, "REPLACE")

    body.modifiers.new("Armature", "ARMATURE").object = rig
    sub = body.modifiers.new("Subdivision", "SUBSURF")
    sub.levels, sub.render_levels = 1, 2
    add_outline(body, OUTLINE, material_offset=1)
    return body


def add_outline(obj, thickness, material_offset):
    """Inverted hull: a slightly bigger, inside-out copy whose front faces are culled."""
    mod = obj.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = material_offset


# --- Rig -----------------------------------------------------------------------------------------


def make_rig():
    arm = bpy.data.armatures.new("WormRig")
    rig = bpy.data.objects.new("WormRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None, connect=False, deform=True):
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.align_roll(TOWARD_CAMERA)  # local Z toward the camera: rotating about Z bends in the screen plane
        eb.use_deform = deform
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = connect
        return eb

    pts = [Vector((x, 0, z)) for (x, z), _ in SPINE]
    bone("root", (0, 0, -1), (0, 0, -0.6), deform=False)
    for name, a, b, parent, connect in BONES:
        bone(name, pts[a], pts[b], parent, connect)
    # The weapon pivots near the worm's centre so the barrel lines up with the game's crosshair,
    # and ignores the body's lean so its angle is exactly the aim angle.
    ax, az = AIM_PIVOT
    aim = bone("aim", (ax, 0, az), (ax + 0.5, 0, az), "spine", deform=False)
    aim.use_inherit_rotation = False
    eye = eye_center()
    bone("eyes", eye, eye + Vector((0, 0, 0.3)), "head", deform=False)

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
    rig.show_in_front = True
    return rig


def eye_center():
    (hx, hz), r = SPINE[6]
    face = Vector((math.cos(FACE_TURN), -math.sin(FACE_TURN), 0))
    return Vector((hx, 0, hz + 0.08)) + face * r * 0.72


# --- Eyes and weapon -----------------------------------------------------------------------------


def make_eyes(rig, mats):
    bm = bmesh.new()
    white = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1)["verts"]
    bmesh.ops.scale(bm, vec=(0.22, 0.21, 0.30), verts=white)
    pupil = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.085)["verts"]
    # The pupils look a bit past the camera, toward where the worm is going (+X).
    look = Vector((math.cos(PUPIL_TURN), math.sin(PUPIL_TURN), 0))
    bmesh.ops.translate(bm, vec=look * 0.16 + Vector((0, 0, 0.03)), verts=pupil)
    pupil_set = set(pupil)
    for f in bm.faces:
        f.material_index = 1 if f.verts[0] in pupil_set else 0
        f.smooth = True
    mesh = bpy.data.meshes.new("WormEye")
    bm.to_mesh(mesh)
    bm.free()
    for m in (mats["eye"], mats["pupil"], mats["outline"], mats["outline"]):
        mesh.materials.append(m)

    face = Vector((math.cos(FACE_TURN), -math.sin(FACE_TURN), 0))
    side = Vector((math.sin(FACE_TURN), math.cos(FACE_TURN), 0))
    center = eye_center()
    for suffix, sign in (("L", -1), ("R", 1)):
        eye = bpy.data.objects.new(f"WormEye.{suffix}", mesh)
        bpy.context.scene.collection.objects.link(eye)
        parent_to_bone(eye, rig, "eyes")
        eye.matrix_world = Matrix.Translation(center + side * sign * 0.21 + face * 0.02) @ Matrix.Rotation(-FACE_TURN, 4, "Z")
        add_outline(eye, 0.025, material_offset=2)


def make_bazooka(rig, mats):
    bm = bmesh.new()

    def tube(r, x0, x1, mat):
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r, depth=x1 - x0)
        bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
        bmesh.ops.translate(bm, vec=((x0 + x1) / 2, 0, 0), verts=geom["verts"])
        for f in {f for v in geom["verts"] for f in v.link_faces}:
            f.material_index = mat

    tube(0.13, -0.55, 0.95, 0)
    tube(0.165, 0.80, 0.97, 1)  # muzzle
    tube(0.155, -0.58, -0.45, 1)  # back end
    mesh = bpy.data.meshes.new("Bazooka")
    bm.to_mesh(mesh)
    bm.free()
    for m in (mats["olive"], mats["metal"], mats["outline"], mats["outline"]):
        mesh.materials.append(m)
    gun = bpy.data.objects.new("weapon.bazooka", mesh)
    bpy.context.scene.collection.objects.link(gun)
    parent_to_bone(gun, rig, "aim")
    # In front of the body (toward the camera), barrel through the pivot.
    gun.matrix_world = Matrix.Translation((AIM_PIVOT[0], -0.75, AIM_PIVOT[1]))
    add_outline(gun, 0.035, material_offset=2)


def parent_to_bone(obj, rig, bone):
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()


# --- Materials -----------------------------------------------------------------------------------


def srgb(hex_color):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def make_materials():
    def principled(name, color, roughness=0.5, specular=0.5):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = srgb(color)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Specular IOR Level"].default_value = specular
        return mat

    outline = bpy.data.materials.new("Outline")
    outline.use_nodes = True
    nodes = outline.node_tree.nodes
    nodes.remove(nodes["Principled BSDF"])
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = srgb(OUTLINE_COLOR)
    outline.node_tree.links.new(emit.outputs[0], nodes["Material Output"].inputs["Surface"])
    outline.use_backface_culling = True
    outline.use_backface_culling_shadow = True  # or the shell shadows the body it surrounds
    return {
        "skin": principled("Skin", SKIN, roughness=0.45, specular=0.35),
        "eye": principled("EyeWhite", "#fbfbf7", roughness=0.25),
        "pupil": principled("Pupil", "#111111", roughness=0.2),
        "olive": principled("Olive", "#6f7d3c", roughness=0.6),
        "metal": principled("DarkMetal", "#34363a", roughness=0.4, specular=0.6),
        "outline": outline,
    }


# --- Camera, lights, render ----------------------------------------------------------------------


def setup_render(scene):
    cam_data = bpy.data.cameras.new("SpriteCamera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 6.0  # 48 game pixels across the frame
    cam = bpy.data.objects.new("SpriteCamera", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam

    def sun(name, toward, energy):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.angle = math.radians(8)
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.rotation_euler = Vector((0, 0, -1)).rotation_difference(Vector(toward).normalized()).to_euler()

    sun("KeyLight", (0.45, 0.6, -0.65), 3.2)  # from the upper left, in front
    sun("FillLight", (-0.7, 0.6, -0.2), 0.8)  # from the right, in front
    sun("RimLight", (-0.35, -0.75, -0.55), 3.5)  # from behind, upper right

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb("#7c8aa3")
    bg.inputs["Strength"].default_value = 0.7

    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x = r.resolution_y = 144  # 3 sprite pixels per game pixel
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.fps = 24
    scene.eevee.taa_render_samples = 32
    scene.view_settings.view_transform = "Standard"  # colours in the game match the hex values here
    scene.view_settings.look = "None"


# --- Animations ----------------------------------------------------------------------------------


def make_actions(rig):
    rig.animation_data_create()
    sin, tau = math.sin, 2 * math.pi

    def idle(p):
        t = tau * p
        pose = {
            "spine": rot(3 * sin(t)),
            "neck": rot(-2 * sin(t + 0.6)),
            "head": rot(2 * sin(t + 1.2)),
            "tail.01": rot(2 * sin(t + 2)),
            "tail.02": rot(4 * sin(t + 2.6)),
        }
        # A blink near the end of the loop.
        f = p * 48
        if 30 <= f <= 34:
            pose["eyes"] = {"scale": (1, [1, 0.5, 0.1, 0.5, 1][round(f) - 30], 1)}
        return pose

    def walk(p):
        t = tau * p
        return {
            "root": {"loc": (0, 0.06 * abs(sin(t)), 0)},
            "hips": rot(-4 * sin(t)),
            "tail.01": rot(10 * sin(t)),
            "tail.02": rot(14 * sin(t - 0.8)),
            "spine": rot(5 * sin(t + 0.5) - 6),
            "neck": rot(-3 * sin(t + 1)),
            "head": rot(3 * sin(t + 1.5)),
        }

    def crouch(p):
        return {
            "root": {"loc": (0, -0.15 * p, 0)},
            "hips": rot(-6 * p),
            "tail.01": rot(-8 * p),
            "spine": {"rot": -18 * p, "scale": (1, 1 - 0.12 * p, 1)},
            "neck": rot(12 * p),
            "head": rot(6 * p),
        }

    def fly_up(p):
        t = tau * p
        return {
            "tail.01": rot(30 + 5 * sin(t)),
            "tail.02": rot(20 + 8 * sin(t - 1)),
            "spine": {"rot": -5, "scale": (1, 1.08, 1)},
            "head": rot(5),
        }

    def fly_down(p):
        t = tau * p
        return {
            "spine": rot(10 * sin(t)),
            "neck": rot(-12 * sin(t + 1)),
            "head": rot(8 * sin(t + 2)),
            "tail.01": rot(20 + 20 * sin(t + 0.5)),
            "tail.02": rot(15 + 25 * sin(t)),
        }

    def aim(p):
        a = -90 + 180 * p  # frame 0 aims straight down, the last straight up
        return {"aim": rot(a), "spine": rot(0.12 * a), "neck": rot(0.12 * a), "head": rot(0.1 * a)}

    make_action(rig, "idle", 48, idle, loop=True)
    make_action(rig, "walk", 16, walk, loop=True)
    make_action(rig, "jump", 6, crouch, loop=False)
    make_action(rig, "fly_up", 12, fly_up, loop=True)
    make_action(rig, "fly_down", 12, fly_down, loop=True)
    make_action(rig, "aim_bazooka", 33, aim, loop=False, weapon="bazooka")


def rot(degrees):
    return {"rot": degrees}


def make_action(rig, name, frames, fn, loop, fps=24, weapon=None):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    # A loop gets one extra key equal to the first so it cycles cleanly in Blender too.
    count = frames + 1 if loop else frames
    for i in range(count):
        p = i / frames if loop else i / max(frames - 1, 1)
        pose = fn(p % 1.0 if loop else p)
        for pb in rig.pose.bones:
            spec = pose.get(pb.name, {})
            pb.rotation_euler = (0, 0, math.radians(spec.get("rot", 0)))
            pb.location = spec.get("loc", (0, 0, 0))
            pb.scale = spec.get("scale", (1, 1, 1))
            for path in ("rotation_euler", "location", "scale"):
                pb.keyframe_insert(path, frame=i + 1, group=pb.name)
    action.use_frame_range = True
    action.frame_start = 1
    action.frame_end = count
    action.use_cyclic = loop
    action["sprite"] = True
    action["fps"] = fps
    if weapon:
        action["weapon"] = weapon


result = main()
