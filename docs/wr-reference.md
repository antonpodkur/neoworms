# Worms Revolution reference

Numbers taken from a personal data export of Worms Revolution (level outlines, the
`StoryLexicon`/`StoryGrammar` parameter tables, game text, tutorial videos) and from footage the
user recorded on a **calibration map**: a level they drew in WR's Landscape Editor (a thick flat
floor, a bar for the rope, blocks to fall from) whose exact shape we decoded from the saved
`UserLandscapes/*.wul` file, so every clip can be scaled from the level's own edges. Only
numbers and observations live here; the game's files themselves are Team17's and are never
committed.
The level outlines go in `client/maps/wr/` (git-ignored, served by the dev server only).

## Scale

- A WR worm is about **11 × 19.5 px** in level-outline pixels: its collision box is 2.26 × 3.9
  units at ~5 px per unit, and corridors in the castle levels are mostly 42–45 px tall
  (≈ 2.2 worm heights).
- Our worm is 16 px tall (radius 8), so WR outlines are scaled by 16 / 19.5 ≈ **0.82** on import
  (`src/game/maps.ts`). That keeps worms, rope and explosions in WR proportions.

## Movement

Measured on the calibration map (game updates at ~30 Hz; arcs fitted per update). "wh" = worm
heights. WR's velocity units come out at 110 / 80 ≈ 1.38 of our px/s (its jump).

| | Worms Revolution (measured) | Ours (16 px worm) |
|---|---|---|
| Gravity | ~20 wh/s²: five arcs (jumps, a flip, thrown worms, grenades) at 300–340 px/s² | 320 px/s² |
| Walk speed | 1.17 wh/s | 19 px/s |
| Jump | 80 forward, 106–112 up (px/s); rises 1.3 wh, 0.72 s in the air, lands 3.7 wh on | 80 / 110 px/s |
| Backflip | 25 back, 162 up; rises 2.55 wh, ~1.03 s | 25 / 162 px/s |
| Falling | stops speeding up at 340–395 px/s (three falls) | 380 px/s for worms (projectiles 900) |
| Fall damage | 15 from 23 wh, 17 from 26 wh; no bounce or slide after; thrown worms too (17 after a dynamite throw) | 0 at 180 → 25 at 490 px/s, so 16 at top fall speed; jumps and flips land free |
| Crouch before take-off | JumpDelay 300 ms (data) | 0.3 s |
| Air steering ("after-touch") | jump 0.1, flip 0.28, rope hop 0.3 (data) | fraction of gravity |
| Steepest walkable slope | 70° (data) | ~71° (step-up 3 px per px) |
| Rope hop when hooking in | NinjaRopeAutoHopY 120 = 1.5 × jump (data) | 165 px/s |

An earlier estimate from the movement tutorial video put everything ~20% faster (gravity 395):
its scale was off, which only showed once a map of known shape was on screen.

Sliding after landings (thrown, or fast off the rope) is in [Sliding](#sliding). Also in the
data but not used yet: `NumNinjaRopeSwings 1` (meaning unclear), worm bounce `Elasticity 0.5`,
`Friction 0.75`, `Drag 0.99`.

**Not in the export:** gravity, wind, the rope's length / swing / climb constants, and the
default key bindings. Those live in the game's executable or an encrypted script file.

## Explosions

In the table's own length units. They are **not** level-outline pixels: craters and the damage
around dynamite and mine blasts in the calibration footage come out ~1.85× the table's numbers,
so `wr()` in `src/sim/weapons.ts` converts lengths × 1.85 × 0.82 ≈ × 1.52 to our px (bazooka
crater 26 → 39.5 px; measured ~37). Each row has an inner and outer range for damage and for
push: full strength within the inner range, fading evenly to the min at the outer range,
nothing beyond. Damage min is 1 for every explosion; push min is 5 unless noted.

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
It's 210 px/s with a 25 px/s upward kick: measured, a dead-on bazooka hit threw a worm at
~229 px/s and dynamite's centre at ~290 (ours now ~228 and ~305). History: a by-feel 365 + 95
threw worms 3–4× too high; 250 + 30 from the tutorial-video scale was still ~15–30% strong.

Launch direction: in the calibration footage every thrown worm left at 64–73° above
horizontal, whatever its height relative to the blast, on the side it was on; a worm hit
dead-on went on the way the shell was travelling. So blasts never throw anything flatter than
`PHYS.blastMinAngle` (65°) above horizontal, and within 4 px sideways of a projectile's blast
the side comes from its heading. `Water-PushDampening` 0.6 cuts push when the blast is under
water.

Melee rows have no fade: **Baseball bat** damage 30, push 200, reach 10 (16 + 8 px between
worm centres for us). **Prod**, measured: no damage, connects about 0.75–1 worm height apart
and lifts the worm up and over at ~85 px/s, ~55° up, moving it ~1.5 wh in all; ours: reach
18 px, push 40, launched 55° up.

**Mine**, measured: it's the bazooka's row (45 damage; 15 at ~3.3 wh), not the "MineRound"
block, which repeats the Old Woman's numbers (a parsing slip). It starts blinking when a worm
is ~1.7 wh (27 px) away and goes off 1.07 s and 2.25 s later in two clips (the game's text
says fuses vary between one and five seconds), so ours picks 1–3 s at random.

**Grenade**, measured: a full-power throw leaves at ~630 px/s (ours now 630, was 520), the
power cone takes ~1.4 s to fill (our `chargeTime`, was 1.2, shared with the bazooka),
gravity as worms, hard bounces keep ~0.38 of the speed into a surface and ~0.57 along it
(ours 0.38 / 0.6), a soft landing (~114 px/s) doesn't bounce at all (ours: below 130 px/s), it
glances off worms keeping ~0.56, fuse as set. Its crater matches the bazooka's row, which it
uses (no row in the export).

The export also has rows we don't use yet: Concrete Donkey (30 / 80 / 77 / 235), Hammer,
Boomerang, Skunk, Mole, Bunker Buster, Sentry gun, Dragon ball, Flame, Uzi.

Worms brought to 0 HP stay on the map until the turn ends, then all blow up together with the
death blast; the match settles again after that, since those blasts can finish off more worms.

## Sliding

From the Soldier data (WR speeds × 1.38 to our px/s for the rope threshold; the rest as noted):

| | Worms Revolution | Ours |
|---|---|---|
| Thrown worm keeps along the floor | `SlideInitialSpeedMultiplier` 0.6 | 0.6 |
| Off the rope, if landing faster than | `SlideMinImpactSpeedFromRope` 120, keeps 0.4 | 165 px/s, 0.4 |
| Lands (slides) instead of bouncing below | `SlideMaxImpactSpeed` 150 | 600 px/s: no thrown worm bounced off a floor in the footage |
| Only if coming in at most | `SlideMaxImpactAngle` 70° from the floor | 70° |
| Top slide speed | `SlideMaxSlideSpeed` 75 | 100 px/s (converted: 145) |
| Slowing down, ramping up over 2.1 s | `SlideMin/MaxDeceleration` 40 → 100 | 154 → 386 px/s² (converted: 77 → 193) |
| Longest slide | `SlideMaxSlideDuration` 1.5 s | 1.5 s |

The converted top speed and deceleration made worms slide several worm heights after every
hit, so those two are by feel: the export doesn't make WR's deceleration units clear. In the
calibration footage thrown worms slid 0.5–2 wh on flat ground, which ours matches.

Not used: `SlideMaxSlideableSlope 40` and `SlideMaxSlopeForSlowDown 80` (our slide follows the
ground like walking, so it stops at steps it can't climb).

## Ninja rope

Measured from six rope clips on the calibration map (free fall after letting go fits 325 px/s²,
so the scale holds to ~5%):

| | Worms Revolution | Ours |
|---|---|---|
| Hook speed | ~1200 px/s | `ropeShotSpeed` 1200 (was 2400) |
| Climbing up | ~115 px/s | `ropeReelInSpeed` 115 |
| Letting out | ~150 px/s | `ropeReelOutSpeed` 150 (both were 160) |
| Swing | periods of 3.6 s at 229 px and 2.8 s at 139 px: a pendulum under ~700 px/s², 2.2× world gravity | `ropeGravity` 700 on a taut rope; slack and free flight use 320 |
| Swing push (← →) | ~200 px/s² (rough) | 170 |
| Letting go | keeps its velocity, normal gravity after | same |
| Longest rope | at least ~295 px (no miss recorded) | 380 |
| Ropes per turn | a match setting in WR | not limited yet |

Not seen yet: the rope wrapping around corners, going slack, bouncing off walls, a deliberate
miss (for the max length), a swing with no ← → (to confirm the swing gravity without the
player's push), and whether the hop when roping from the ground starts at the shot or on
attaching (ours: on attaching).

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
