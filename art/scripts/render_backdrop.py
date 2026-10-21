"""
Renders each layer of a backdrop .blend into a PNG strip, for client/scripts/build-backdrops.ts.

    blender --background art/backdrop/seaside.blend --python art/scripts/render_backdrop.py -- OUT_DIR

Writes OUT_DIR/<layer>.png for every collection named "layer.<layer>", and OUT_DIR/layers.json
listing them back to front with their placement and scrolling (see backdrop_kit.py for the
conventions). Each layer renders on its own, so layers don't shade or hide one another.
"""
import json
import os
import sys

import bpy

PX = 16  # game pixels per Blender unit
WIDTH = 2048


def main():
    out = sys.argv[sys.argv.index("--") + 1]
    scene = bpy.context.scene
    cam = scene.camera
    layers = sorted((c for c in bpy.data.collections if c.name.startswith("layer.")), key=lambda c: c["order"])
    listed = []
    for layer in layers:
        name = layer.name.removeprefix("layer.")
        for other in layers:
            other.hide_render = other is not layer
        height = layer["height"]
        scene.render.resolution_x = WIDTH
        scene.render.resolution_y = height
        cam.data.ortho_scale = WIDTH / PX
        # z = 0 is the anchor line; a "top" strip hangs below it, the others sit above it.
        if layer["anchor"] == "top":
            cam.location.z = -(layer["offset"] + height / 2) / PX
        else:
            cam.location.z = (layer["offset"] + height / 2) / PX
        scene.render.filepath = os.path.join(out, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        listed.append({"name": name} | {key: layer[key] for key in ("anchor", "offset", "height", "parallax", "blur", "drift")})
        print(f"backdrop: {name} ({WIDTH} x {height})")
    with open(os.path.join(out, "layers.json"), "w") as f:
        json.dump(listed, f, indent=2)


main()
