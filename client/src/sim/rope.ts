import { DT, PHYS } from './constants';
import { bounceOff, moveDisc } from './physics';
import type { Terrain, Vec2 } from './terrain';
import type { Worm, WormInput } from './worm';

/**
 * A point the rope runs through. `side` records which way the worm was swinging when the
 * rope bent here (±1); swinging back past the bend straightens the rope again.
 */
export interface Pivot extends Vec2 {
  side: number;
}

export type Rope =
  /** The hook is flying out from where it was fired. */
  | { phase: 'shooting'; x: number; y: number; dirX: number; dirY: number; traveled: number }
  /**
   * Hooked into the ground. `pivots` holds the anchor first, then every corner the rope
   * bends around; `length` is the free segment from the last pivot to the worm.
   */
  | { phase: 'attached'; pivots: Pivot[]; length: number };

export type AttachedRope = Extract<Rope, { phase: 'attached' }>;

/** How far inside full length (px) the worm may be and still count as hanging on a tight rope. */
const SLACK_TOLERANCE = 0.5;
/** Ignore ground this close (px) to a pivot when checking whether the rope catches on a corner. */
const WRAP_SKIP = 2;
/** How far past straight (as a sine) the rope must swing back before a bend comes undone. */
const UNWRAP_THRESHOLD = 0.001;

/** Lets go of the rope. The worm keeps its swing speed and can shoot the rope again mid-air. */
export function releaseRope(worm: Worm): void {
  worm.rope = null;
  worm.ropeChain = true;
}

/** Shoots the hook out at the aim angle. */
export function shootRope(worm: Worm): void {
  worm.rope = {
    phase: 'shooting',
    x: worm.x,
    y: worm.y,
    dirX: Math.cos(worm.aim) * worm.facing,
    dirY: -Math.sin(worm.aim),
    traveled: 0,
  };
}

export function attachRope(worm: Worm, x: number, y: number): void {
  worm.rope = {
    phase: 'attached',
    pivots: [{ x, y, side: 0 }],
    length: Math.max(1, Math.hypot(worm.x - x, worm.y - y)),
  };
  // Hooking in while standing hops the worm up so it swings free instead of dragging.
  if (worm.grounded) worm.vy = -PHYS.ropeAutoHop;
  worm.grounded = false;
  worm.knocked = false;
  worm.walkProgress = 0;
  worm.pendingJump = null;
  worm.afterTouch = 0;
}

/** Moves a flying hook. It grabs the first ground it touches, or gives up at full length. */
export function advanceHook(worm: Worm, terrain: Terrain): void {
  const rope = worm.rope;
  if (rope?.phase !== 'shooting') return;
  const travel = Math.min(PHYS.ropeShotSpeed * DT, PHYS.ropeMaxLength - rope.traveled);
  const nx = rope.x + rope.dirX * travel;
  const ny = rope.y + rope.dirY * travel;
  const hit = terrain.raycast(rope.x, rope.y, nx, ny);
  if (hit) {
    attachRope(worm, hit.before.x, hit.before.y);
    return;
  }
  rope.x = nx;
  rope.y = ny;
  rope.traveled += travel;
  if (rope.traveled >= PHYS.ropeMaxLength) worm.rope = null; // missed
}

/** One tick of hanging on the rope: ↑ ↓ climb, ← → swing. */
export function swingOnRope(worm: Worm, rope: AttachedRope, input: WormInput, terrain: Terrain): void {
  const swing = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const reel = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (swing) worm.facing = swing > 0 ? 1 : -1;
  if (reel) reelRope(worm, rope, reel, terrain);
  if (isTaut(worm, rope)) swingTaut(worm, rope, swing, terrain);
  else fallSlack(worm, rope, terrain);
}

/** Total rope in use: the bent segments between pivots plus the free segment. */
export function ropeLength(rope: AttachedRope): number {
  return bentLength(rope) + rope.length;
}

function bentLength(rope: AttachedRope): number {
  let total = 0;
  for (let i = 1; i < rope.pivots.length; i++) total += distance(rope.pivots[i - 1], rope.pivots[i]);
  return total;
}

/** Climbs (dir -1) or descends (dir +1) the rope. */
function reelRope(worm: Worm, rope: AttachedRope, dir: number, terrain: Terrain): void {
  const pivot = last(rope.pivots);
  const dist = distance(worm, pivot);
  const reelSpeed = dir < 0 ? PHYS.ropeReelInSpeed : PHYS.ropeReelOutSpeed;
  let target = Math.max(PHYS.ropeMinLength, rope.length + dir * reelSpeed * DT);
  if (dir > 0) target = Math.min(target, Math.max(rope.length, PHYS.ropeMaxLength - bentLength(rope)));
  if (target === rope.length || dist < 0.001) return;

  if (dist < rope.length - SLACK_TOLERANCE && target >= dist) {
    rope.length = target; // loose rope: nothing to pull on yet
    return;
  }

  // Move the worm along the rope to the new length.
  const ux = (worm.x - pivot.x) / dist;
  const uy = (worm.y - pivot.y) / dist;
  const nx = pivot.x + ux * target;
  const ny = pivot.y + uy * target;
  if (!terrain.discFree(nx, ny, PHYS.wormRadius)) return;

  // Climbing speeds up the swing and descending slows it, like a skater pulling in their arms.
  const swingSpeed = (worm.vx * uy - worm.vy * ux) * Math.pow(dist / target, PHYS.ropeReelMomentum);
  worm.vx = swingSpeed * uy;
  worm.vy = -swingSpeed * ux;
  worm.x = nx;
  worm.y = ny;
  rope.length = target;
}

/**
 * A rope can pull but not push: it stays tight only while the worm is pulled outward, and
 * nothing stops the worm moving toward the anchor (e.g. hopping up as the hook catches).
 */
function isTaut(worm: Worm, rope: AttachedRope): boolean {
  const pivot = last(rope.pivots);
  const dx = worm.x - pivot.x;
  const dy = worm.y - pivot.y;
  const dist = Math.hypot(dx, dy);
  if (dist < rope.length - SLACK_TOLERANCE) return false;
  if (!PHYS.ropeCanGoSlack) return true;
  if ((worm.vx * dx + worm.vy * dy) / dist < -1) return false; // moving inward
  const swingSpeed = (worm.vx * dy - worm.vy * dx) / dist;
  const outwardGravity = (PHYS.ropeGravity * dy) / dist;
  return (swingSpeed * swingSpeed) / dist + outwardGravity >= 0;
}

/**
 * Swings along the circle around the current pivot, one pixel of arc at a time, bending
 * the rope around corners it catches on and straightening it when the worm swings back.
 * The angle is measured from straight below the pivot; positive speed swings rightward
 * when hanging below it.
 */
function swingTaut(worm: Worm, rope: AttachedRope, swing: number, terrain: Terrain): void {
  let pivot = last(rope.pivots);
  let angle = angleFrom(pivot, worm);
  let speed = worm.vx * Math.cos(angle) - worm.vy * Math.sin(angle);
  speed += (swing * PHYS.ropeSwingAccel * Math.cos(angle) - PHYS.ropeGravity * Math.sin(angle)) * DT;
  speed = Math.max(-PHYS.ropeMaxSpeed, Math.min(PHYS.ropeMaxSpeed, speed));

  for (let remaining = Math.abs(speed) * DT; remaining > 0; remaining -= 1) {
    const next = angle + (Math.sign(speed) * Math.min(1, remaining)) / rope.length;
    const nx = pivot.x + Math.sin(next) * rope.length;
    const ny = pivot.y + Math.cos(next) * rope.length;
    if (!terrain.discFree(nx, ny, PHYS.wormRadius)) {
      speed = -speed * PHYS.ropeBounce;
      break;
    }
    const motion = { x: nx - worm.x, y: ny - worm.y };
    worm.x = nx;
    worm.y = ny;
    if (unwrap(worm, rope) || wrap(worm, rope, motion, terrain)) pivot = last(rope.pivots);
    angle = angleFrom(pivot, worm);
  }

  worm.vx = speed * Math.cos(angle);
  worm.vy = -speed * Math.sin(angle);
}

/** Loose rope: the worm falls freely until the rope reaches full length and catches it. */
function fallSlack(worm: Worm, rope: AttachedRope, terrain: Terrain): void {
  worm.vy = Math.min(worm.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
  const n = moveDisc(worm, PHYS.wormRadius, terrain);
  if (n) bounceOff(worm, n, PHYS.ropeBounce);

  const pivot = last(rope.pivots);
  const dist = distance(worm, pivot);
  if (dist <= rope.length) return;
  const ux = (worm.x - pivot.x) / dist;
  const uy = (worm.y - pivot.y) / dist;
  const nx = pivot.x + ux * rope.length;
  const ny = pivot.y + uy * rope.length;
  if (terrain.discFree(nx, ny, PHYS.wormRadius)) {
    worm.x = nx;
    worm.y = ny;
  }
  const outward = worm.vx * ux + worm.vy * uy;
  if (outward > 0) {
    worm.vx -= outward * ux;
    worm.vy -= outward * uy;
  }
}

/** If the rope now passes through ground, bend it around the corner it caught on. */
function wrap(worm: Worm, rope: AttachedRope, motion: Vec2, terrain: Terrain): boolean {
  const pivot = last(rope.pivots);
  const hit = terrain.raycast(pivot.x, pivot.y, worm.x, worm.y, WRAP_SKIP);
  if (!hit) return false;
  const corner = hit.before;
  if (distance(corner, pivot) < 1) return false;
  const side = Math.sign(cross(corner.x - pivot.x, corner.y - pivot.y, motion.x, motion.y));
  rope.pivots.push({ x: corner.x, y: corner.y, side });
  rope.length = distance(worm, corner);
  return true;
}

/** If the worm swung back past the last bend, straighten the rope there. */
function unwrap(worm: Worm, rope: AttachedRope): boolean {
  if (rope.pivots.length < 2) return false;
  const bend = rope.pivots[rope.pivots.length - 1];
  const prev = rope.pivots[rope.pivots.length - 2];
  const ax = bend.x - prev.x;
  const ay = bend.y - prev.y;
  const bx = worm.x - bend.x;
  const by = worm.y - bend.y;
  const sine = cross(ax, ay, bx, by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  if (sine * bend.side > -UNWRAP_THRESHOLD) return false;
  rope.pivots.pop();
  rope.length = distance(worm, prev);
  return true;
}

function angleFrom(pivot: Vec2, p: Vec2): number {
  return Math.atan2(p.x - pivot.x, p.y - pivot.y);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function last<T>(items: T[]): T {
  return items[items.length - 1];
}
