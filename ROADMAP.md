# NeoWorms roadmap

A browser Worms clone to play online with friends: one player hosts, others join with a room code.
Top priority is the **ninja rope** (rope parkour); first weapons are bazooka, grenade and mines.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **Phaser 4 + TypeScript + Vite** | Rendering, camera, input, sound, particles, tweens come for free. |
| Physics | **Custom, pixel-mask terrain** (`src/sim`) | Destructible terrain is a bitmap; physics engines need polygons rebuilt after every explosion. Worm walking and the Worms rope aren't realistic physics anyway. |
| Simulation | Pure TS, fixed 60 Hz tick, no Phaser imports | Testable with Vitest, and the same code can run for every player online. |
| Netcode | **Active player simulates, others watch** | Only one worm acts per turn, so the active player runs physics with zero lag and streams positions + events (`SimEvent`). Full state is sent at turn end. No lockstep determinism needed. |
| Hosting | **Relay server** with room codes | Works on any network. The server only forwards messages; the host's browser runs the match rules. Check an off-the-shelf room server (e.g. Colyseus) before writing one. |

## Milestones

Each milestone ends with something playable.

- [x] **0 · Skeleton**: Vite + Phaser, fixed-tick loop, camera pan/zoom, input
- [x] **1 · Terrain + worm**: generated maps (One Island, Two Islands, Archipelago, Cavern), click-to-explode with craters, walking/slope climbing, jump, backflip, fall damage, knockback, drowning
- [ ] **2 · Ninja rope**: fire at aim angle, swing, reel in/out, wrap around corners, release with momentum, re-fire mid-air; "Rope Gym" map + live tuning sliders
- [ ] **3 · Weapons**: aim + hold to charge, weapon menu; bazooka (wind), grenade (1–5 s fuse, bounces), mines (proximity, arming delay, duds); chain reactions
- [ ] **4 · Same-screen match**: teams, turn timer, retreat time, wind, sudden death (rising water), win screen
- [ ] **5 · Online**: lobby with room codes, team/worm names, host picks map + settings, streaming, disconnect handling
- [ ] **6 · Maps & content**: themes, import a map from an image, more weapons, crates, barrels
- [ ] **7 · Polish**: sprites, animations, sound, particles, gamepad

## Rope design notes (milestone 2)

- Worm hangs on a distance constraint from the current pivot; gravity + left/right swing force, up/down reel.
- Wrapping: when the line from pivot to worm hits terrain, push a new pivot at that corner; pop it when the
  worm swings back past the previous segment's line.
- Release keeps velocity; firing again mid-air chains swings. Later: drop weapons from the rope, knock worms.
