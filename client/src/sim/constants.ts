/** The simulation runs at a fixed rate so physics behaves the same on every machine. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/**
 * Physics tuning defaults. Units are pixels and seconds; a worm is 16px tall (2 × radius).
 *
 * Movement is modelled on Worms Revolution, converted to worm heights so it doesn't depend
 * on its internal units: gravity and the forward jump were measured from the game's movement
 * tutorial video, and the rest follows the ratios in its Soldier class data (jump vs.
 * backflip vs. walk, 70° slope limit, fall damage capped at 25).
 */
const defaults = {
  /** ~25 worm heights/s², measured from Worms Revolution footage. */
  gravity: 395,
  maxFallSpeed: 900,

  wormRadius: 8,
  /** ~1.3 worm heights/s, as in Worms Revolution. */
  walkSpeed: 21,
  /** Pixels a worm may step up per pixel walked; sets the steepest walkable slope (~70°). */
  maxClimb: 3,
  /** Pixels a worm follows the ground down per pixel walked before it starts falling. */
  maxSnapDown: 3,
  /** Forward jump: rises ~1.7 worm heights. */
  jumpVx: 94,
  jumpVy: -154,
  /** Relative to facing, so negative means backwards. Rises ~3.2 worm heights. */
  backflipVx: -30,
  backflipVy: -212,
  /** Crouch before leaving the ground; a second Jump press within it turns the jump into a flip. */
  jumpDelay: 0.3,
  /** Steering in the air while holding ← →, as a fraction of gravity ("after-touch"). */
  jumpAfterTouch: 0.1,
  backflipAfterTouch: 0.28,
  aimSpeed: 1.8,

  /** Landings slower than this are free (a drop of ~5.5 worm heights). */
  safeLandingSpeed: 264,
  /** Fall damage grows with landing speed up to the cap, reached at this speed. */
  maxDamageLandingSpeed: 763,
  maxFallDamage: 25,

  /** A surface counts as floor when its normal points up more steeply than this. */
  floorNormalY: -0.55,
  wallBounce: 0.3,
  /** Worms thrown by explosions bounce and slide before they settle. */
  knockBounce: 0.5,
  knockFriction: 0.75,
  /** Thrown worms hitting the floor slower than this land (and slide) instead of bouncing: WR's SlideMaxImpactSpeed. */
  knockLandSpeed: 290,
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
  slideFromRopeMinSpeed: 231,
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
   * Speed a worm gets at the heart of a bazooka blast; other blasts scale from it. WR's push
   * force 130 in its velocity units, converted like the jump (80 → 154 px/s): 130 × 1.93.
   * A direct hit throws a worm ~4.5 worm heights up.
   */
  blastKnockback: 250,
  /** Extra upward speed at that strength, so thrown worms fly in a slight arc. */
  blastLift: 30,

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
  ropeAutoHop: 231,

  /** Seconds of holding Space to reach full power. */
  chargeTime: 1.2,
  /** Launch speed at full power. */
  bazookaSpeed: 650,
  grenadeSpeed: 520,
  /** Push on bazooka shells at full wind strength (wind ranges -1..1). */
  windMax: 120,
  grenadeBounce: 0.45,
  grenadeFriction: 0.85,
  /** Seconds after placing before a mine can be set off, so its owner can get away. */
  mineArmTime: 2,
  /** A worm this close sets an armed mine off... */
  mineTriggerRadius: 24,
  /** ...and it explodes this many seconds later. */
  mineFuse: 1.2,
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
