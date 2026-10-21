# Art

The look is modelled on Worms Revolution: soft 3D worms rendered in Blender and played back
in the game as sprites, the way the 2D Worms games were made. The game itself stays 2D.

Each piece of art is a **Blender source** in `art/` plus the **sprite sheet the game loads** in
`client/sprites/`. Edit the `.blend`, then run `npm run sprites` to rebuild the sheet. The
built sheet is committed, so playing or working on the game doesn't need Blender.

## The worm

- `art/worm/worm.blend`: the worm, its rig and animations, the sprite camera and the lights.
  It's a placeholder built by `art/scripts/placeholder_worm.py`; the hand-made worm replaces
  the model and animations but keeps the camera, lights and conventions below.
- `npm run sprites` renders every sprite action in Blender (headless, about 20 s), packs the
  frames into `client/sprites/worm.png` + `worm.json`, and lists each animation's frame count,
  speed and looping in the JSON. `WormView` picks the animation from the worm's state.

### Conventions

- 1 Blender unit = the worm's collision radius (8 game px). The collision circle is centred on
  the origin, so the ground under a standing worm is at z = −1.
- The camera looks along +Y (the screen is the XZ plane) and frames 6 × 6 units in 144 × 144 px,
  3 sprite pixels per game pixel. The worm faces +X; the game mirrors it to face left.
- Bones bend in the screen plane: their Z axis points at the camera, so rotating about Z leans
  the worm forward or back.
- An action becomes an animation when it has the custom property `sprite` (true). `fps` sets
  its speed (default 24), and the Manual Frame Range sets its frames. With Cyclic Animation on,
  the last frame repeats the first and isn't rendered.
- `weapon` (e.g. `bazooka`) shows the object `weapon.bazooka` and hides the other `weapon.*`.
- `aim_<weapon id>` is an aiming pose: one frame per aim angle, from straight down to straight
  up. The game shows it for the worm whose turn it is while that weapon is selected.

| Animation | When the game plays it |
|---|---|
| `idle` | standing still |
| `walk` | walking |
| `jump` | crouching before a jump, and sliding after a hard landing |
| `fly_up` / `fly_down` | in the air, rising / falling; `fly_up` also hangs from the rope |
| `aim_bazooka` | aiming the bazooka |

Thrown worms tumble (the game spins the sprite) and worms on the rope turn toward the rope.

## Working in Blender with Claude

Claude edits the open Blender file through Blender Lab's MCP server
([blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/)), so changes show up in
the viewport as they happen and Claude can see what you change by hand. Setup: install the MCP
add-on in Blender 5.1+, turn on Preferences → System → Network → Allow Online Access (the add-on
won't start its server without it), and register the server with Claude Code (see the add-on's
setup page). `npm run sprites` doesn't need any of this; it runs Blender directly.
