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
| Feel | **Modelled on Worms Revolution** | Movement measured from WR and converted to worm heights; WR controls (double-tap jump to flip, air steering); WR explosion table for weapons. See [docs/wr-reference.md](docs/wr-reference.md). |

## Milestones

Each milestone ends with something playable.

- [x] **0 · Skeleton**: Vite + Phaser, fixed-tick loop, camera pan/zoom, input
- [x] **1 · Terrain + worm**: generated maps (One Island, Two Islands, Archipelago, Cavern), click-to-explode with craters, walking/slope climbing, jump, backflip, fall damage, knockback, drowning
- [ ] **2 · Ninja rope**: fire at aim angle, swing, reel in/out, wrap around corners, release with momentum, re-fire mid-air; "Rope Gym" map + live tuning sliders
  - [x] Mechanics, Rope Gym map, tuning panel (`T`)
  - [ ] Tune the feel together, then bake the values into `constants.ts`
  - [ ] Later: drop weapons from the rope, knock other worms, limited shots per turn
- [ ] **3 · Weapons**: aim + hold to charge, weapon menu; bazooka (wind), grenade (1–5 s fuse, bounces), mines (proximity, arming delay, duds); chain reactions. Use the WR explosion table (separate crater, damage reach, push reach).
- [ ] **4 · Same-screen match**: teams, turn timer, retreat time, wind, sudden death (rising water), win screen
- [ ] **5 · Online**: lobby with room codes, team/worm names, host picks map + settings, streaming, disconnect handling
- [ ] **6 · Maps & content**: themes, import a map from an image, more weapons, crates, barrels
- [ ] **7 · Polish**: sprites, animations, sound, particles, gamepad

## Rope design notes (milestone 2)

See `src/sim/rope.ts`.
- While the rope is tight, the worm moves along a circle around the current pivot, one pixel of arc at a time.
  Gravity and the ← → push act along the circle, so swings keep their height (no artificial damping).
- The rope can go slack: it only pulls. Above the anchor without enough speed, the worm falls until the rope
  catches it again (toggle "can go slack" to compare with a rigid rod).
- Wrapping: when the line from pivot to worm hits terrain, a new pivot goes at that corner. It comes off again
  when the worm swings back past the line of the previous segment.
- Climbing conserves some angular momentum (tunable): climbing mid-swing speeds you up, like real pumping.
- Letting go keeps the worm's velocity; firing again mid-air chains swings.
