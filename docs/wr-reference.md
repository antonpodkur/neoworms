# Worms Revolution reference

Numbers taken from a personal data export of Worms Revolution (level outlines, the
`StoryLexicon`/`StoryGrammar` parameter tables, game text, tutorial videos). Only numbers and
observations live here; the game's files themselves are Team17's and are never committed.
The level outlines go in `client/maps/wr/` (git-ignored, served by the dev server only).

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

Sliding after landings (thrown, or fast off the rope) is in [Sliding](#sliding). Also in the
data but not used yet: `NumNinjaRopeSwings 1` (meaning unclear), worm bounce `Elasticity 0.5`,
`Friction 0.75`, `Drag 0.99`.

**Not in the export:** gravity, wind, the rope's length / swing / climb constants, and the
default key bindings. Those live in the game's executable or an encrypted script file.

## Explosions

In WR level-outline pixels (multiply lengths by 0.82 for ours, done by `wr()` in
`src/sim/weapons.ts`). Each row has an inner and outer range for damage and for push: full
strength within the inner range, fading evenly to the min at the outer range, nothing beyond.
Damage min is 1 for every explosion; push min is 5 unless noted.

| Payload | Crater | Damage max | Damage range | Push max | Push range | Extra lift |
|---|---|---|---|---|---|---|
| Bazooka | 26 | 45 | 6–47 | 130 | 4–46 | |
| Dynamite | 34 | 65 | 6–63 | 170 | 4–62 | 1.3 |
| Old Woman | 52 | 75 | 7–73 | 230 | 4–70 | |
| Banana bomblet | 34 | 65 | 6–63 | 165 | 4–62 | 1.3 |
| Cluster bomb fragment | 15 | 15 | 1–15 | 15 | 3–14 | 1.3 |
| Air strike missile | 14 | 45 | 6–20 | 70 | 3–19 | 1.3 |
| Armageddon (one meteor) | 32 | 50 | 6–48 | 80 | 3–47 | |
| Worm death blast | 12 | 25 | 4–22 | 60 (min 1) | 10–20 | |

"Extra lift" is `ArtificialExplosionPush`; we multiply the upward kick by it. Push is in WR force
units; `PHYS.blastKnockback` is the speed the bazooka's 130 gives, and the rest scale from it.
It's 250 px/s: 130 in WR's velocity units, converted like the jump (× 1.93). An earlier by-feel
365 px/s plus a 95 px/s upward kick threw worms 3–4× too high (a bazooka under a worm: 12
worm heights up, now 4.5; the bat: 106 worm heights away, wider than a WR level, now ~36).
The upward kick is now 30 px/s.
`Water-PushDampening` 0.6 cuts push when the blast is under water.

Melee rows have no fade: **Baseball bat** damage 30, push 200, reach 10; **Prod** damage 0,
push 50, reach 10 (reach is past touching, so 16 + 8 px between worm centres for us).

The export also has rows we don't use yet: Concrete Donkey (30 / 80 / 77 / 235), Hammer,
Boomerang, Skunk, Mole, Bunker Buster, Sentry gun, Dragon ball, Flame, Uzi. Grenade values
weren't found, and the "MineRound" block repeats the Old Woman's numbers (probably a parsing
slip), so the grenade uses the bazooka's row and the mine is by feel.

Worms brought to 0 HP stay on the map until the turn ends, then all blow up together with the
death blast; the match settles again after that, since those blasts can finish off more worms.

## Sliding

From the Soldier data, speeds converted with the jump ratio (154 / 80 ≈ 1.93 px/s per WR unit):

| | Worms Revolution | Ours |
|---|---|---|
| Thrown worm keeps along the floor | `SlideInitialSpeedMultiplier` 0.6 | 0.6 |
| Off the rope, if landing faster than | `SlideMinImpactSpeedFromRope` 120, keeps 0.4 | 231 px/s, 0.4 |
| Lands (slides) instead of bouncing below | `SlideMaxImpactSpeed` 150 | 290 px/s |
| Only if coming in at most | `SlideMaxImpactAngle` 70° from the floor | 70° |
| Top slide speed | `SlideMaxSlideSpeed` 75 | 100 px/s (converted: 145) |
| Slowing down, ramping up over 2.1 s | `SlideMin/MaxDeceleration` 40 → 100 | 154 → 386 px/s² (converted: 77 → 193) |
| Longest slide | `SlideMaxSlideDuration` 1.5 s | 1.5 s |

The converted top speed and deceleration made worms slide several worm heights after every
hit, so those two are by feel: the export doesn't make WR's deceleration units clear. Now a
bazooka hit from the side slides a worm about one worm height.

Not used: `SlideMaxSlideableSlope 40` and `SlideMaxSlopeForSlowDown 80` (our slide follows the
ground like walking, so it stops at steps it can't climb).

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

Our bindings (chosen by the player): ← → WormMove, ↑ ↓ Aim, **Space = Fire**, **Enter = Jump**,
**Shift = WeaponPanel**, **Tab = Toggle**, and **Enter on the rope = AltFire** (drop a weapon).
