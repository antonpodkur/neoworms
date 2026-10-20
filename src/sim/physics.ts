import { DT } from './constants';
import type { Terrain, Vec2 } from './terrain';

/** Anything that moves through the terrain as a disc: worms now, projectiles later. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Moves a disc by one tick of its velocity in half-pixel sub-steps, so fast bodies can't
 * tunnel through thin ground. Stops at the first contact and returns the surface normal
 * there, or null if the way was clear.
 */
export function moveDisc(body: Body, radius: number, terrain: Terrain): Vec2 | null {
  const steps = Math.max(1, Math.ceil((Math.hypot(body.vx, body.vy) * DT) / 0.5));
  const sx = (body.vx * DT) / steps;
  const sy = (body.vy * DT) / steps;
  for (let i = 0; i < steps; i++) {
    if (!terrain.discFree(body.x + sx, body.y + sy, radius)) {
      return terrain.normalAt(body.x, body.y, radius + 2) ?? { x: 0, y: -1 };
    }
    body.x += sx;
    body.y += sy;
  }
  return null;
}

/**
 * Reflects velocity off a surface with normal n. `bounce` is the share of the speed into
 * the surface that comes back out; `friction` is the share of the speed along it that's kept.
 */
export function bounceOff(body: Body, n: Vec2, bounce: number, friction = 1): void {
  const vn = body.vx * n.x + body.vy * n.y;
  if (vn >= 0) return; // already moving away
  const tx = body.vx - vn * n.x;
  const ty = body.vy - vn * n.y;
  body.vx = tx * friction - vn * bounce * n.x;
  body.vy = ty * friction - vn * bounce * n.y;
}

/** Nudges a disc that ended up inside ground back out toward open air. */
export function pushOut(body: Body, radius: number, terrain: Terrain): void {
  for (let i = 0; i < 12 && !terrain.discFree(body.x, body.y, radius); i++) {
    const n = terrain.normalAt(body.x, body.y, radius + 1) ?? { x: 0, y: -1 };
    body.x += n.x;
    body.y += n.y;
  }
}
