/** The simulation runs at a fixed rate so physics behaves the same on every machine. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/**
 * Physics tuning. Units are pixels and seconds.
 * Kept as a plain mutable object so a live tuning panel can tweak it later.
 */
export const PHYS = {
  gravity: 600,
  maxFallSpeed: 1000,

  wormRadius: 7,
  walkSpeed: 55,
  /** Pixels a worm may step up per pixel walked; sets the steepest walkable slope (~70°). */
  maxClimb: 3,
  /** Pixels a worm follows the ground down per pixel walked before it starts falling. */
  maxSnapDown: 3,
  jump: { vx: 150, vy: -210 },
  /** vx is relative to facing, so negative means backwards. */
  backflip: { vx: -45, vy: -330 },
  aimSpeed: 1.8,

  /** Landing faster than this hurts (roughly a 90px drop). */
  safeLandingSpeed: 330,
  fallDamagePerSpeed: 0.1,

  /** A surface counts as floor when its normal points up more steeply than this. */
  floorNormalY: -0.55,
  wallBounce: 0.3,
  /** Worms thrown by explosions bounce and slide before they settle. */
  knockBounce: 0.35,
  knockFriction: 0.7,
  knockLandSpeed: 140,
  /** Below this speed an airborne worm that touches ground just settles. */
  settleSpeed: 40,

  blastKnockback: 450,
  blastLift: 120,
};
