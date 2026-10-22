import { DT, PHYS, TICK_RATE } from './constants';
import { bounceOff, moveDisc, pushOut } from './physics';
import { advanceHook, swingOnRope, type Rope } from './rope';
import type { Terrain, Vec2 } from './terrain';
import type { WeaponId } from './weapons';

export interface WormInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** True only on the tick the key was pressed. A second jump during the crouch makes a flip. */
  jump: boolean;
  /** Shortcut straight to a backflip. */
  backflip: boolean;
  /** Space pressed this tick... */
  fire: boolean;
  /** ...and whether it's still held (for charging shots). */
  fireHeld: boolean;
  /** Tab (WR's Toggle): cycle the selected weapon's option, e.g. the fuse or the strike direction. */
  toggle: boolean;
  /** Enter (WR's AltFire): drop the selected weapon while on the rope. */
  altFire: boolean;
  /** A fuse picked with the number keys 1–5 this tick (WR's Fuse). */
  fuse: number | null;
  /** A weapon picked from the weapon menu this tick. */
  select: WeaponId | null;
  /** The map was clicked this tick at this x: calls in an air strike there. */
  target: number | null;
}

export const NO_INPUT: WormInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  backflip: false,
  fire: false,
  fireHeld: false,
  toggle: false,
  altFire: false,
  fuse: null,
  select: null,
  target: null,
};

export interface Worm {
  id: number;
  name: string;
  team: number;
  x: number;
  y: number;
  /** Position at the start of the last tick, for smooth rendering between ticks. */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Radians from horizontal, positive is up, in -PI/2..PI/2. */
  aim: number;
  grounded: boolean;
  /** Thrown by an explosion: bounces instead of landing on first contact. */
  knocked: boolean;
  /** Sub-pixel walking distance carried between ticks. */
  walkProgress: number;
  /** Sliding along the ground after a hard landing (px/s, negative is left); 0 when not. */
  slide: number;
  /** Seconds spent in the current slide. */
  slideTime: number;
  /** A jump being wound up (the worm crouches first): what it becomes and ticks until take-off. */
  pendingJump: { kind: 'jump' | 'backflip'; ticksLeft: number } | null;
  /** How strongly ← → steer this flight, as a fraction of gravity; 0 when it can't be steered. */
  afterTouch: number;
  rope: Rope | null;
  /** Let go of the rope and not landed yet: Space shoots the rope again, Enter drops weapons. */
  ropeChain: boolean;
  weapon: WeaponId;
  /** Grenade fuse in seconds. */
  fuse: number;
  /** Which way an air strike comes in (Tab flips it): 1 from the left, -1 from the right. */
  strikeDir: 1 | -1;
  /** Shot power (0..1) while Space is held; null when not charging. */
  charge: number | null;
  hp: number;
  alive: boolean;
}

export function createWorm(id: number, name: string, team: number, x: number, y: number, hp = 100): Worm {
  return {
    id,
    name,
    team,
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    facing: 1,
    aim: 0,
    grounded: false,
    knocked: false,
    walkProgress: 0,
    slide: 0,
    slideTime: 0,
    pendingJump: null,
    afterTouch: 0,
    rope: null,
    ropeChain: false,
    weapon: 'rope',
    fuse: 3,
    strikeDir: 1,
    charge: null,
    hp,
    alive: true,
  };
}

/** Advances one worm by one tick. Returns fall damage taken on landing (0 if none). */
export function stepWorm(worm: Worm, input: WormInput, terrain: Terrain): number {
  advanceHook(worm, terrain);
  if (worm.rope?.phase === 'attached') {
    swingOnRope(worm, worm.rope, input, terrain);
    return 0;
  }

  if (input.up) worm.aim = Math.min(Math.PI / 2, worm.aim + PHYS.aimSpeed * DT);
  if (input.down) worm.aim = Math.max(-Math.PI / 2, worm.aim - PHYS.aimSpeed * DT);

  if (worm.grounded && worm.slide !== 0) {
    slide(worm, terrain); // no control until it stops
  } else if (worm.grounded) {
    if (input.backflip) queueJump(worm, 'backflip');
    else if (input.jump) queueJump(worm, 'jump');

    if (worm.pendingJump) crouch(worm, input);
    else if (input.left !== input.right) walk(worm, input.left ? -1 : 1, terrain);
    else worm.walkProgress = 0;
  }

  if (worm.grounded) {
    // Ground can vanish under a worm (explosions), so re-check support every tick.
    if (worm.grounded && terrain.discFree(worm.x, worm.y + 1, PHYS.wormRadius)) {
      worm.grounded = false;
      worm.pendingJump = null;
    }
  }

  return worm.grounded ? 0 : fly(worm, input, terrain);
}

/** The first Jump press starts a crouch; another press during it turns the jump into a flip. */
function queueJump(worm: Worm, kind: 'jump' | 'backflip'): void {
  if (worm.pendingJump) worm.pendingJump.kind = 'backflip';
  else worm.pendingJump = { kind, ticksLeft: Math.round(PHYS.jumpDelay * TICK_RATE) };
}

/** Winds up a jump: ← → can still turn the worm around, and it takes off when the crouch ends. */
function crouch(worm: Worm, input: WormInput): void {
  const pending = worm.pendingJump!;
  if (input.left !== input.right) worm.facing = input.left ? -1 : 1;
  worm.walkProgress = 0;
  if (--pending.ticksLeft > 0) return;
  worm.pendingJump = null;
  if (pending.kind === 'jump') launch(worm, PHYS.jumpVx, PHYS.jumpVy, PHYS.jumpAfterTouch);
  else launch(worm, PHYS.backflipVx, PHYS.backflipVy, PHYS.backflipAfterTouch);
}

function launch(worm: Worm, vx: number, vy: number, afterTouch: number): void {
  worm.vx = worm.facing * vx;
  worm.vy = vy;
  worm.grounded = false;
  worm.afterTouch = afterTouch;
}

function walk(worm: Worm, dir: 1 | -1, terrain: Terrain): void {
  worm.facing = dir;
  worm.walkProgress += PHYS.walkSpeed * DT;
  while (worm.walkProgress >= 1 && worm.grounded) {
    worm.walkProgress -= 1;
    if (!stepSideways(worm, dir, terrain)) {
      worm.walkProgress = 0;
      return;
    }
  }
}

/** Moves one pixel sideways, stepping up or down slopes. Returns false when blocked by a wall. */
function stepSideways(worm: Worm, dir: 1 | -1, terrain: Terrain): boolean {
  const r = PHYS.wormRadius;
  const nx = worm.x + dir;
  for (let up = 0; up <= PHYS.maxClimb; up++) {
    if (!terrain.discFree(nx, worm.y - up, r)) continue;
    worm.x = nx;
    worm.y -= up;
    for (let down = 0; down < PHYS.maxSnapDown && terrain.discFree(worm.x, worm.y + 1, r); down++) {
      worm.y += 1;
    }
    if (terrain.discFree(worm.x, worm.y + 1, r)) {
      // Walked off a ledge.
      worm.grounded = false;
      worm.vx = dir * PHYS.walkSpeed;
      worm.vy = 0;
    }
    return true;
  }
  return false;
}

function fly(worm: Worm, input: WormInput, terrain: Terrain): number {
  worm.vy = Math.min(worm.vy + PHYS.gravity * DT, PHYS.wormMaxFallSpeed);
  if (worm.afterTouch > 0 && input.left !== input.right) {
    worm.vx += (input.left ? -1 : 1) * worm.afterTouch * PHYS.gravity * DT;
  }
  pushOut(worm, PHYS.wormRadius, terrain);
  const n = moveDisc(worm, PHYS.wormRadius, terrain);
  return n ? collide(worm, n) : 0;
}

function collide(worm: Worm, n: Vec2): number {
  const vn = worm.vx * n.x + worm.vy * n.y; // negative when moving into the surface
  const isFloor = n.y < PHYS.floorNormalY;
  const speed = Math.hypot(worm.vx, worm.vy);

  if (isFloor && (!worm.knocked || speed < PHYS.knockLandSpeed)) {
    // Hitting the floor hard hurts, thrown or not.
    const damage = fallDamage(-vn);
    // Like WR, thrown worms slide on after landing, and so do worms coming in fast off the rope.
    const share = worm.knocked
      ? PHYS.slideShare
      : worm.ropeChain && speed >= PHYS.slideFromRopeMinSpeed
        ? PHYS.slideFromRopeShare
        : 0;
    const along = worm.vx * -n.y + worm.vy * n.x; // speed along the floor, positive is right
    land(worm);
    const angle = (Math.atan2(-vn, Math.abs(along)) * 180) / Math.PI; // 0 = skimming the floor
    if (share > 0 && angle <= PHYS.slideMaxImpactAngle) startSlide(worm, along * share);
    return damage;
  }

  if (worm.knocked) bounceOff(worm, n, PHYS.knockBounce, PHYS.knockFriction);
  else bounceOff(worm, n, PHYS.wallBounce);
  // Wedged in a crevice or barely moving: settle so the player can walk or jump out.
  const moved = Math.hypot(worm.x - worm.prevX, worm.y - worm.prevY);
  if ((n.y < 0 && Math.hypot(worm.vx, worm.vy) < PHYS.settleSpeed) || moved < 0.1) land(worm);
  return 0;
}

function land(worm: Worm): void {
  worm.vx = 0;
  worm.vy = 0;
  worm.grounded = true;
  worm.knocked = false;
  worm.slide = 0;
  worm.afterTouch = 0;
  worm.ropeChain = false;
}

function startSlide(worm: Worm, speed: number): void {
  if (Math.abs(speed) < PHYS.slideStopSpeed) return;
  worm.slide = Math.sign(speed) * Math.min(Math.abs(speed), PHYS.slideMaxSpeed);
  worm.slideTime = 0;
  worm.walkProgress = 0;
  worm.facing = speed < 0 ? -1 : 1;
}

/**
 * Slides along the ground, following slopes like walking, and slows down harder the longer it
 * slides (WR's friction ramp). Stops at a wall, when slow, or after the longest slide.
 * Sliding off a ledge turns into a fall with the slide's speed.
 */
function slide(worm: Worm, terrain: Terrain): void {
  worm.slideTime += DT;
  const ramp = Math.min(1, worm.slideTime / PHYS.slideDecelRamp);
  const decel = PHYS.slideDecelStart + (PHYS.slideDecelEnd - PHYS.slideDecelStart) * ramp;
  const speed = Math.abs(worm.slide) - decel * DT;
  if (speed < PHYS.slideStopSpeed || worm.slideTime >= PHYS.slideMaxTime) {
    worm.slide = 0;
    worm.walkProgress = 0;
    return;
  }
  const dir = worm.slide < 0 ? -1 : 1;
  worm.slide = dir * speed;
  worm.walkProgress += speed * DT;
  while (worm.walkProgress >= 1) {
    worm.walkProgress -= 1;
    if (!stepSideways(worm, dir, terrain)) {
      worm.slide = 0; // hit a wall
      worm.walkProgress = 0;
      return;
    }
    if (!worm.grounded) {
      worm.vx = dir * speed;
      worm.slide = 0;
      return;
    }
  }
}

/** Grows from nothing at the safe landing speed up to the cap. */
function fallDamage(impactSpeed: number): number {
  const t = (impactSpeed - PHYS.safeLandingSpeed) / (PHYS.maxDamageLandingSpeed - PHYS.safeLandingSpeed);
  return t <= 0 ? 0 : Math.round(PHYS.maxFallDamage * Math.min(1, t));
}
