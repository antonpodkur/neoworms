"""
Renders every sprite action of a .blend into PNG frames, for client/scripts/build-sprites.ts.

    blender --background art/worm/worm.blend --python art/scripts/render_sprites.py -- OUT_DIR

Writes OUT_DIR/<action>/0000.png, 0001.png, ... and OUT_DIR/anims.json with each action's frame
count, speed and whether it loops. See docs/art.md for the action conventions: only actions
with the custom property "sprite" are rendered, "fps" sets their speed, "weapon" picks which
"weapon.*" object is visible, and the Manual Frame Range (with Cyclic Animation) sets the frames.
"""
import json
import os
import sys

import bpy


def main():
    out = sys.argv[sys.argv.index("--") + 1]
    scene = bpy.context.scene
    rig = next(o for o in scene.objects if o.type == "ARMATURE")
    weapons = [o for o in scene.objects if o.name.startswith("weapon.")]
    anims = {}
    for action in sorted(bpy.data.actions, key=lambda a: a.name):
        if not action.get("sprite"):
            continue
        reset_pose(rig)
        rig.animation_data.action = action
        if rig.animation_data.action_slot is None and action.slots:
            rig.animation_data.action_slot = action.slots[0]
        weapon = action.get("weapon")
        for obj in weapons:
            obj.hide_render = obj.name.split(".")[1] != weapon  # weapon.<id> and its parts weapon.<id>.*
        start, end = (round(f) for f in action.frame_range)
        # In a cycle the last frame repeats the first.
        frames = range(start, end if action.use_cyclic else end + 1)
        for i, frame in enumerate(frames):
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(out, action.name, f"{i:04d}.png")
            bpy.ops.render.render(write_still=True)
        anims[action.name] = {
            "frames": len(frames),
            "fps": action.get("fps", scene.render.fps),
            "loop": action.use_cyclic,
        }
        print(f"sprites: {action.name} ({len(frames)} frames)")
    with open(os.path.join(out, "anims.json"), "w") as f:
        json.dump(anims, f, indent=2)


def reset_pose(rig):
    """Bones and face sliders an action doesn't key would otherwise keep the previous action's pose."""
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
        for key in pb.keys():
            pb[key] = pb.id_properties_ui(key).as_dict().get("default", 0.0)


main()
