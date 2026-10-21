"""
Shared pieces for the backdrop scene scripts (seaside_backdrop.py, cave_backdrop.py): layers,
materials, meshes, seamless wrapping, and the camera, light and render settings.

Units: 1 Blender unit = 16 game pixels. The camera looks along +Y, so the screen is the XZ plane
(x right, z up). A layer's strip is STRIP units wide (2048 pixels); every object is copied one
strip to the left and to the right, so the strip's edges match and it repeats seamlessly.

Layer conventions (what render_backdrop.py reads), on each collection named "layer.<name>":
  order     back to front
  anchor    the line the strip is placed by, which is z = 0 in the scene:
              "horizon"  the sea's horizon; the strip's lower edge is `offset` px above it
              "water"    the water's surface; the strip's lower edge is `offset` px above it
              "top"      the top of the map; the strip's upper edge is `offset` px below it
  offset    see `anchor` (negative: the other way)
  height    the strip's height in pixels
  parallax  how fast it scrolls with the camera (1 = with the terrain, 0 = not at all)
  blur      softening the game adds, in pixels, for distance
  drift     pixels per second it slides sideways on its own
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

PX = 16  # game pixels per Blender unit
STRIP = 2048 / PX
# Everything the scripts make is tagged, so a rerun removes exactly that and nothing else.
TAG = "backdrop"


def tag(block):
    block[TAG] = True
    return block


def clear_scene():
    """Removes the startup file's cube, light and camera, and whatever an earlier run made."""
    for name in ("Cube", "Light", "Camera"):
        if obj := bpy.data.objects.get(name):
            bpy.data.objects.remove(obj)
    kinds = (bpy.data.objects, bpy.data.meshes, bpy.data.metaballs, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.collections)
    for kind in kinds:
        for block in [b for b in kind if b.get(TAG)]:
            kind.remove(block)


def make_layers(scene, layers):
    """One collection per layer, carrying its conventions (see the top of this file)."""
    made = {}
    for order, (name, props) in enumerate(layers.items()):
        layer = tag(bpy.data.collections.new(f"layer.{name}"))
        scene.collection.children.link(layer)
        layer["order"] = order
        layer["blur"] = 0.0
        layer["drift"] = 0.0
        for key, value in props.items():
            layer[key] = value
        made[name] = layer
    return made


# --- Materials -----------------------------------------------------------------------------------


def srgb(hex_color):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def material(name, color, haze=0.0, haze_color="#ffffff", roughness=0.85, glow=0.0):
    """A matte surface mixed `haze` of the way toward the air's colour, for distance.
    `glow` adds some of its own colour as light, so the shaded side never goes dark."""
    mat = tag(bpy.data.materials.new(name))
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Specular IOR Level"].default_value = 0.15
    if glow:
        bsdf.inputs["Emission Color"].default_value = srgb(color)
        bsdf.inputs["Emission Strength"].default_value = glow
    if haze:
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Color"].default_value = srgb(haze_color)
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = haze
        links.new(bsdf.outputs[0], mix.inputs[1])
        links.new(emit.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], nodes["Material Output"].inputs["Surface"])
    return mat


# --- Meshes --------------------------------------------------------------------------------------


def add_object(layer, name, data, location=(0, 0, 0), materials=()):
    for mat in materials:
        data.materials.append(mat)
    obj = tag(bpy.data.objects.new(name, data))
    obj.location = location
    layer.objects.link(obj)
    return obj


def mesh_from(name, build, smooth=True):
    """A mesh made by `build(bm)` on a fresh bmesh."""
    bm = bmesh.new()
    build(bm)
    mesh = tag(bpy.data.meshes.new(name))
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    return mesh


def reflect(layer, mat, waterline):
    """Mirrors everything in the layer about the waterline, drawn with `mat`, for the water's reflection."""
    flip = Matrix.Translation((0, 0, 2 * waterline)) @ Matrix.Scale(-1, 4, (0, 0, 1))
    for obj in list(layer.objects):
        copy = obj.copy()
        copy.name = f"{obj.name}.reflection"
        copy.matrix_basis = flip @ obj.matrix_basis  # (matrix_world isn't computed yet)
        for slot in copy.material_slots:
            slot.link = "OBJECT"
            slot.material = mat
        layer.objects.link(copy)


def wrap(layer):
    """Copies everything one strip to the left and right, so the strip's edges match up."""
    for obj in list(layer.objects):
        for shift in (-STRIP, STRIP):
            copy = obj.copy()  # shares the mesh: a linked duplicate
            copy.location.x += shift
            layer.objects.link(copy)


# --- Camera, lights, render ----------------------------------------------------------------------


def setup_render(scene, sun_energy, sun_color, world_color, world_strength):
    cam_data = tag(bpy.data.cameras.new("BackdropCamera"))
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = STRIP  # the strip's width; render_backdrop.py sets the height per layer
    cam_data.clip_end = 500
    cam = tag(bpy.data.objects.new("BackdropCamera", cam_data))
    scene.collection.objects.link(cam)
    cam.location = (STRIP / 2, -100, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam

    # The same light as the terrain in the game: sun from the upper left, in front.
    light = tag(bpy.data.lights.new("Sun", "SUN"))
    light.energy = sun_energy
    light.color = srgb(sun_color)[:3]
    light.angle = math.radians(10)
    sun = tag(bpy.data.objects.new("Sun", light))
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((0, 0, -1)).rotation_difference(Vector((0.45, 0.6, -0.65)).normalized()).to_euler()

    # The air's colour as fill light, so shaded sides take it on rather than going grey.
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = srgb(world_color)
    bg.inputs["Strength"].default_value = world_strength

    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x = 2048
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    scene.eevee.taa_render_samples = 64
    scene.view_settings.view_transform = "Standard"  # colours in the game match the hex values here
    scene.view_settings.look = "None"


def finish(built):
    """Prints what was built and, when run from the command line with a path after `--`, saves there."""
    print(f"backdrop: built {built}")
    if bpy.app.background and "--" in sys.argv:
        bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index("--") + 1], compress=True)
