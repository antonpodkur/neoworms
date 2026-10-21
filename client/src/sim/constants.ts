/** The simulation runs at a fixed rate so physics behaves the same on every machine. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/**
 * Physics tuning defaults. Units are pixels and seconds; a worm is 16px tall (2 × radius).
 *
 * Movement is modelled on Worms Revolution, converted to worm heights so it doesn't depend
 * on its internal units. Gravity, walking, jumps and falls were measured from WR footage
 * recorded on a calibration map whose exact shape we decoded (docs/wr-reference.md); the rest
 * follows the ratios in its Soldier class data (70° slope limit, fall damage capped at 25).
 * WR velocity units convert to ours at 110 / 80 ≈ 1.38 (its jump).
 */
const defaults = {
  /** ~20 worm heights/s², measured from jumps, falls and thrown worms and grenades. */
  gravity: 320,
  /** Projectiles' top falling speed. */
  maxFallSpeed: 900,
  /** Worms stop speeding up when falling at about this speed (340–395 px/s measured in WR). */
  wormMaxFallSpeed: 380,

  wormRadius: 8,
  /** ~1.17 worm heights/s, measured. */
  walkSpeed: 19,
  /** Pixels a worm may step up per pixel walked; sets the steepest walkable slope (~70°). */
  maxClimb: 3,
  /** Pixels a worm follows the ground down per pixel walked before it starts falling. */
  maxSnapDown: 3,
  /** Forward jump: rises ~1.3 worm heights, ~0.72 s in the air (measured). */
  jumpVx: 80,
  jumpVy: -110,
  /** Relative to facing, so negative means backwards. Rises ~2.5 worm heights, ~1 s (measured). */
  backflipVx: -25,
  backflipVy: -162,
  /** Crouch before leaving the ground; a second Jump press within it turns the jump into a flip. */
  jumpDelay: 0.3,
  /** Steering in the air while holding ← →, as a fraction of gravity ("after-touch"). */
  jumpAfterTouch: 0.1,
  backflipAfterTouch: 0.28,
  aimSpeed: 1.8,

  /** Landings slower than this are free: a drop of ~3 worm heights, so jumps and backflips (~162) don't hurt. */
  safeLandingSpeed: 180,
  /**
   * Fall damage grows with landing speed up to the cap, reached at this speed. Fitted to WR
   * footage: 15 and 17 damage from 23 and 26 worm-height drops, landing at ~345 and ~390 px/s.
   * A long drop lands at wormMaxFallSpeed and does 16; free falls never reach the cap of 25.
   * Worms thrown by blasts take it too (a dynamite victim took 17 on landing).
   */
  maxDamageLandingSpeed: 490,
  maxFallDamage: 25,

  /** A surface counts as floor when its normal points up more steeply than this. */
  floorNormalY: -0.55,
  wallBounce: 0.3,
  /** Worms thrown by explosions bounce and slide before they settle. */
  knockBounce: 0.5,
  knockFriction: 0.75,
  /**
   * Thrown worms hitting the floor slower than this land (and slide) instead of bouncing. In WR
   * footage none bounced off a floor, even after long drops, so this is above any fall speed.
   */
  knockLandSpeed: 600,
  /** Below this speed an airborne worm that touches ground just settles. */
  settleSpeed: 35,

  /**
   * Sliding after a landing, from WR's Soldier data (its speeds x 1.93 to our px/s, the same
   * ratio as its jump). A thrown worm keeps 60% of its speed along the floor, a worm coming in
   * fast off the rope 40%; it slows down harder the longer it slides, for at most 1.5 s.
   * The top speed and the slowing down are by feel (WR's converted 145 px/s and 77 → 193 px/s²
   * slid too far): the export doesn't make WR's deceleration units clear.
   */
  slideShare: 0.6,
  slideFromRopeShare: 0.4,
  /** WR SlideMinImpactSpeedFromRope 120 × 1.38. */
  slideFromRopeMinSpeed: 165,
  slideMaxSpeed: 100,
  /** Only landings that come in at most this many degrees from the floor turn into a slide. */
  slideMaxImpactAngle: 70,
  slideDecelStart: 154,
  slideDecelEnd: 386,
  /** Seconds for the slowing down to build up from start to end. */
  slideDecelRamp: 2.1,
  slideMaxTime: 1.5,
  slideStopSpeed: 4,

  /**
   * Speed a worm gets at the heart of a bazooka blast; other blasts scale from it. Measured on
   * the calibration map: a dead-on bazooka hit threw a worm at ~229 px/s and dynamite's centre
   * at ~290, which this plus the lift gives (~228 and ~305).
   */
  blastKnockback: 210,
  /** Extra upward speed at that strength, so thrown worms fly in a slight arc. */
  blastLift: 25,
  /**
   * Blasts throw things at least this many degrees above horizontal, even from the side:
   * WR footage shows worms leaving at 64–73° (docs/wr-reference.md).
   */
  blastMinAngle: 65,

  /*
   * Ninja rope. Not calibrated yet: these values were tuned by feel against the old, ~20%
   * faster movement, and the WR rope clip recorded so far didn't hold still enough to measure
   * (it only showed 3 rope shots per turn). Rope length, swing, climb speed and letting go
   * still need footage on the calibration map; until then expect the rope to feel a bit off
   * next to the slower gravity.
   */
  /** Total rope length, including the parts bent around corners. */
  ropeMaxLength: 380,
  ropeMinLength: 16,
  ropeShotSpeed: 2400,
  ropeReelSpeed: 160,
  /** Sideways push while swinging (← →). */
  ropeSwingAccel: 170,
  ropeMaxSpeed: 800,
  /**
   * How much reeling in speeds up the swing: 0 keeps the speed, 1 is real physics
   * (angular momentum is conserved, like a skater pulling in their arms).
   */
  ropeReelMomentum: 0.5,
  /** Share of speed kept when a swinging worm hits a wall. */
  ropeBounce: 0.3,
  /** A real rope can go slack (worm falls when above the anchor); off makes it a rigid rod. */
  ropeCanGoSlack: true,
  /** Upward hop when the rope hooks in while standing, so the worm lifts off (1.5× a jump). */
  ropeAutoHop: 165,

  /** Seconds of holding Space to reach full power. */
  chargeTime: 1.2,
  /** Launch speed at full power. */
  bazookaSpeed: 650,
  grenadeSpeed: 520,
  /** Push on bazooka shells at full wind strength (wind ranges -1..1). */
  windMax: 120,
  /** Share of speed into a surface that bounces back, and of speed along it kept (measured). */
  grenadeBounce: 0.38,
  grenadeFriction: 0.6,
  /** Hitting a surface slower than this, they don't bounce at all (a soft landing in WR footage). */
  grenadeMinBounceSpeed: 130,
  /** Seconds after placing before a mine can be set off, so its owner can get away. */
  mineArmTime: 2,
  /** A worm this close sets an armed mine off (~1.7 worm heights, measured)... */
  mineTriggerRadius: 27,
  /** ...and it explodes after a random fuse in this range (1.07 and 2.25 s measured; WR's text says 1–5 s). */
  mineFuseMin: 1,
  mineFuseMax: 3,
  mineDudChance: 0.1,
  /** Mines scattered on the map at the start. */
  mapMines: 6,
};

export type Physics = typeof defaults;

export const DEFAULT_PHYS: Readonly<Physics> = Object.freeze({ ...defaults });

/** Live physics values. A plain mutable object so the tuning panel can tweak it. */
export const PHYS: Physics = { ...defaults };

export function resetPhys(): void {
  Object.assign(PHYS, DEFAULT_PHYS);
}
