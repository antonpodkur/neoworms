"""
Keys worm animations from Python, the way they were made for art/worm/worm.blend. Run it in the
open Blender (e.g. through the MCP server: exec(open(path).read())), then call key_action().

    key_action("wave", 16, {
        ("spine", "rot"): [(1, 0), (9, -12)],          # degrees; positive leans back
        ("spine", "stretch"): [(1, 1.0), (9, 1.08)],   # scale along the bone, keeping volume
        ("root", "y"): [(1, 0), (5, 0.1)],             # location along the bone (root: up)
        ("aim", "scale"): [(1, 0.01), (5, 1.0)],       # uniform scale (pops a weapon in)
        ("face", "mouth_grin"): [(1, 0.8)],            # a face slider (docs/art.md)
    }, loop=True)

Each channel keeps its own keys, so a blink can be keyed without touching the body. A loop gets
a closing key equal to its first and Cycles modifiers, so it wraps smoothly. See docs/art.md for
the action conventions (sprite, fps, weapon, aim_/hold_/draw_ names).
"""
import math

import bpy
from bpy_extras import anim_utils

rig = bpy.data.objects["WormRig"]


def reset_pose():
    """Puts every bone and face slider back to rest."""
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
        for key in pb.keys():
            pb[key] = pb.id_properties_ui(key).as_dict().get("default", 0.0)


def key_action(name, length, tracks, loop, fps=24, weapon=None, linear=(), constant=()):
    """Replaces the action `name` with these keys. `linear` and `constant` list data-path
    fragments (e.g. '"aim"') whose keys interpolate linearly or step."""
    if old := bpy.data.actions.get(name):
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    reset_pose()
    for (bone, channel), keys in tracks.items():
        keys = sorted(keys)
        if loop and keys[0][0] == 1 and keys[-1][0] != length + 1:
            keys.append((length + 1, keys[0][1]))
        pb = rig.pose.bones[bone]
        for frame, value in keys:
            if bone == "face":
                pb[channel] = float(value)
                pb.keyframe_insert(f'["{channel}"]', frame=frame, group="face")
            elif channel == "rot":
                pb.rotation_euler = (0, 0, math.radians(value))
                pb.keyframe_insert("rotation_euler", index=2, frame=frame, group=bone)
            elif channel in ("x", "y"):
                i = "xy".index(channel)
                loc = list(pb.location)
                loc[i] = value
                pb.location = loc
                pb.keyframe_insert("location", index=i, frame=frame, group=bone)
            elif channel == "stretch":
                side = 1 / math.sqrt(value)
                pb.scale = (side, value, side)
                pb.keyframe_insert("scale", frame=frame, group=bone)
            elif channel == "scale":
                pb.scale = (value, value, value)
                pb.keyframe_insert("scale", frame=frame, group=bone)
    bag = anim_utils.action_get_channelbag_for_slot(act, rig.animation_data.action_slot)
    for fc in bag.fcurves:
        if any(s in fc.data_path for s in constant):
            mode = "CONSTANT"
        elif any(s in fc.data_path for s in linear):
            mode = "LINEAR"
        else:
            mode = "BEZIER"
        for kp in fc.keyframe_points:
            kp.interpolation = mode
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if loop:
            fc.modifiers.new("CYCLES")
        fc.update()
    act.use_frame_range = True
    act.frame_start = 1
    act.frame_end = length + 1 if loop else length
    act.use_cyclic = loop
    act["sprite"] = True
    act["fps"] = fps
    if weapon:
        act["weapon"] = weapon
    return act


def about(point, degrees):
    """Root rotation and location (x, y) that turn the whole worm about `point` (x, z), e.g. a
    flip about the body's middle or a swing about the top of the head."""
    t = math.radians(degrees)
    root = rig.data.bones["root"].head_local
    hx, hz = point[0] - root.x, point[1] - root.z
    rx, rz = hx * math.cos(t) - hz * math.sin(t), hx * math.sin(t) + hz * math.cos(t)
    return degrees, hx - rx, hz - rz
