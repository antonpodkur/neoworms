import { DT, PHYS } from './constants';
import type { Terrain } from './terrain';

export interface WormInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** True only on the tick the key was pressed. */
  jump: boolean;
  backflip: boolean;
}

export const NO_INPUT: WormInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  backflip: false,
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
    hp,
    alive: true,
  };
}

/** Advances one worm by one tick. Returns fall damage taken on landing (0 if none). */
export function stepWorm(worm: Worm, input: WormInput, terrain: Terrain): number {
  if (input.up) worm.aim = Math.min(Math.PI / 2, worm.aim + PHYS.aimSpeed * DT);
  if (input.down) worm.aim = Math.max(-Math.PI / 2, worm.aim - PHYS.aimSpeed * DT);

  if (worm.grounded) {
    if (input.jump) launch(worm, PHYS.jump.vx, PHYS.jump.vy);
    else if (input.backflip) launch(worm, PHYS.backflip.vx, PHYS.backflip.vy);
    else if (input.left !== input.right) walk(worm, input.left ? -1 : 1, terrain);
    else worm.walkProgress = 0;

    // Ground can vanish under a worm (explosions), so re-check support every tick.
    if (worm.grounded && terrain.discFree(worm.x, worm.y + 1, PHYS.wormRadius)) {
      worm.grounded = false;
    }
  }

  return worm.grounded ? 0 : fly(worm, terrain);
}

function launch(worm: Worm, vx: number, vy: number): void {
  worm.vx = worm.facing * vx;
  worm.vy = vy;
  worm.grounded = false;
  worm.walkProgress = 0;
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

/** Ballistic movement in half-pixel sub-steps so fast worms can't tunnel through thin ground. */
function fly(worm: Worm, terrain: Terrain): number {
  worm.vy = Math.min(worm.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
  pushOut(worm, terrain);

  const steps = Math.max(1, Math.ceil((Math.hypot(worm.vx, worm.vy) * DT) / 0.5));
  const sx = (worm.vx * DT) / steps;
  const sy = (worm.vy * DT) / steps;
  for (let i = 0; i < steps; i++) {
    if (!terrain.discFree(worm.x + sx, worm.y + sy, PHYS.wormRadius)) return collide(worm, terrain);
    worm.x += sx;
    worm.y += sy;
  }
  return 0;
}

function collide(worm: Worm, terrain: Terrain): number {
  const n = terrain.normalAt(worm.x, worm.y, PHYS.wormRadius + 2) ?? { x: 0, y: -1 };
  const vn = worm.vx * n.x + worm.vy * n.y; // negative when moving into the surface
  const isFloor = n.y < PHYS.floorNormalY;

  if (isFloor && (!worm.knocked || Math.hypot(worm.vx, worm.vy) < PHYS.knockLandSpeed)) {
    // Thrown worms already took blast damage, so only regular falls hurt.
    const damage = worm.knocked ? 0 : fallDamage(-vn);
    land(worm);
    return damage;
  }

  if (vn < 0) {
    const bounce = worm.knocked ? PHYS.knockBounce : PHYS.wallBounce;
    const friction = worm.knocked ? PHYS.knockFriction : 1;
    const tx = worm.vx - vn * n.x;
    const ty = worm.vy - vn * n.y;
    worm.vx = tx * friction - vn * bounce * n.x;
    worm.vy = ty * friction - vn * bounce * n.y;
  }
  // Wedged in a crevice or barely moving: settle so the player can walk or jump out.
  if (n.y < 0 && Math.hypot(worm.vx, worm.vy) < PHYS.settleSpeed) land(worm);
  return 0;
}

function land(worm: Worm): void {
  worm.vx = 0;
  worm.vy = 0;
  worm.grounded = true;
  worm.knocked = false;
}

function fallDamage(impactSpeed: number): number {
  if (impactSpeed <= PHYS.safeLandingSpeed) return 0;
  return Math.round((impactSpeed - PHYS.safeLandingSpeed) * PHYS.fallDamagePerSpeed);
}

/** Nudges a worm that ended up inside ground back out toward open air. */
function pushOut(worm: Worm, terrain: Terrain): void {
  const r = PHYS.wormRadius;
  for (let i = 0; i < 12 && !terrain.discFree(worm.x, worm.y, r); i++) {
    const n = terrain.normalAt(worm.x, worm.y, r + 1) ?? { x: 0, y: -1 };
    worm.x += n.x;
    worm.y += n.y;
  }
}
