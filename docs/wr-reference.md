# Worms Revolution reference

Numbers taken from a personal data export of Worms Revolution (level outlines, the
`StoryLexicon`/`StoryGrammar` parameter tables, game text, tutorial videos). Only numbers and
observations live here; the game's files themselves are Team17's and are never committed.
The level outlines go in `maps/wr/` (git-ignored, served by the dev server only).

## Scale

- A WR worm is about **11 × 19.5 px** in level-outline pixels: its collision box is 2.26 × 3.9
  units at ~5 px per unit, and corridors in the castle levels are mostly 42–45 px tall
  (≈ 2.2 worm heights).
- Our worm is 16 px tall (radius 8), so WR outlines are scaled by 16 / 19.5 ≈ **0.82** on import
  (`src/game/maps.ts`). That keeps worms, rope and explosions in WR proportions.

## Movement

WR's velocity units don't match its distance units, so absolute values come from measuring the
movement tutorial video (25 fps), and the data supplies the ratios. "wh" = worm heights.

| | Worms Revolution | Ours (16 px worm) | Source |
|---|---|---|---|
| Gravity | 24.6 wh/s² | 395 px/s² | Parabola fit to a jump, rms error 2 px |
| Walk speed | 1.25 wh/s | 21 px/s | Video (data ratio walk/jump gives 1.4) |
| Jump up | 9.6 wh/s, rises 1.7 wh, ~0.8 s in the air | 154 px/s | Video |
| Jump forward | JumpX / JumpY = 49 / 80 | 94 px/s | Data ratio |
| Backflip | X / Y = 15.5 / 110 (vs jump 80) | 30 / 212 px/s | Data ratio |
| Crouch before take-off | JumpDelay 300 ms | 0.3 s | Data, visible in video |
| Air steering ("after-touch") | jump 0.1, flip 0.28, rope hop 0.3 | fraction of gravity | Data (our interpretation) |
| Steepest walkable slope | 70° | ~71° (step-up 3 px per px) | Data |
| Fall damage | capped at 25; impact velocity 4.5–13 (unknown units) | 0 at 264 px/s → 25 at 763 px/s | Data cap and ratio |
| Rope hop when hooking in | NinjaRopeAutoHopY 120 (1.5 × jump) | 231 px/s | Data |

Also in the data but not used yet: landing from the rope makes the worm slide
(`SlideInitialSpeedMultiplierFromRope 0.4`, `SlideMinImpactSpeedFromRope 120`, slides on
slopes up to 40°), `NumNinjaRopeSwings 1` (meaning unclear), worm bounce `Elasticity 0.5`,
`Friction 0.75`, `Drag 0.99`.

**Not in the export:** gravity, wind, the rope's length / swing / climb constants, and the
default key bindings. Those live in the game's executable or an encrypted script file.

## Explosions

In WR level-outline pixels (multiply lengths by 0.82 for ours). Damage and push fade from the
max at the centre to ~1 at the edge of their range.

| Weapon | Crater radius | Max damage | Damage reach | Push reach | Push force |
|---|---|---|---|---|---|
| Bazooka | 26 | 45 | 47 | 46 | 130 |
| Dynamite | 34 | 65 | 63 | 62 | 170 |
| Old Woman | 52 | 75 | 73 | 70 | 230 |
| Armageddon (one meteor) | 32 | 50 | 48 | | 80 |
| Cluster bomb (one fragment) | 15 | 15 | 15 | 14 | 15 |
| Worm death blast | 12 | 25 | 22 | 20 | 60 |

Water reduces push to 60%. Grenade values weren't found, and the "MineRound" block repeats the
Old Woman's numbers (probably a parsing slip), so both need tuning by feel.

The debug click explosion uses the bazooka row: crater 21, damage 45, reach 39 px.

## Worm classes

| | Soldier | Heavy | Scientist | Scout |
|---|---|---|---|---|
| Walk | 12 | 8 | 10 | 16 |
| Jump X × Y | 49 × 80 | 33 × 78 | 40 × 79 | 65 × 82 |
| Backflip X × Y | 15.5 × 110 | 14 × 90 | 15 × 100 | 16 × 120 |
| Max fall damage | 25 | 30 | 25 | 20 |
| Collision box | 2.26 × 3.9 | 3 × 4.4 | 2 × 4 | 1.8 × 3 |

We currently play everyone as a Soldier.

## Controls (PC)

The game text names these actions: **WormMove**, **Aim**, **Jump** (tap = forward jump, tap twice
quickly = flip, hold a direction to change the distance), **Fire** (also attaches and detaches
the rope; hold to charge weapons), **AltFire** (drop a weapon from the rope, jetpack or
parachute), **Toggle** (cycle a weapon's option: fuse, direction, polarity, worm), **Fuse**,
**WeaponPanel**, **CameraMove**, **CameraZoomIn/Out**, **Accept**, **Pause**.

Ninja rope, in the game's words: aim with Aim, attach and detach with Fire, lengthen and
shorten with Aim once attached, drop a weapon with AltFire, and it doesn't end the turn.

Our bindings: ← → WormMove, ↑ ↓ Aim, **Space = Fire**, **Enter = Jump** (as the player uses
them in WR). AltFire, Toggle and WeaponPanel get keys when weapons arrive (milestone 3).
