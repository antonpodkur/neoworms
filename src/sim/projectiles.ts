import { DT, PHYS, TICK_RATE } from './constants';
import { bounceOff, moveDisc, pushOut } from './physics';
import type { Terrain } from './terrain';
import { BLASTS, type Blast } from './weapons';
import type { SimEvent } from './world';
import type { Worm } from './worm';

export type ProjectileKind = 'shell' | 'grenade' | 'mine';

export const PROJECTILE_RADIUS: Record<ProjectileKind, number> = { shell: 2, grenade: 3, mine: 3 };

/** Fuse of a mine set off by a nearby explosion: chain reactions. */
const CHAIN_FUSE = 0.3;
/** Grenades and mines slower than this when touching the floor come to rest. */
const SETTLE_SPEED = 20;

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the start of the last tick, for smooth rendering. */
  prevX: number;
  prevY: number;
  /** Lying still on the ground; wakes up when the ground goes or a blast pushes it. */
  resting: boolean;
  /** Ticks until a grenade or a triggered mine goes off; null while a mine waits. */
  fuseTicks: number | null;
  /** Ticks until a mine is armed. */
  armTicks: number;
  /** A mine that fizzled; only an explosion can still set it off. */
  dud: boolean;
  dead: boolean;
}

/** How a projectile enters the world. Grenades take `fuse` seconds; map mines start `armed`. */
export interface Launch {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse?: number;
  armed?: boolean;
}

export function createProjectile(id: number, launch: Launch): Projectile {
  const { kind, x, y, vx, vy } = launch;
  return {
    id,
    kind,
    x,
    y,
    vx,
    vy,
    prevX: x,
    prevY: y,
    resting: false,
    fuseTicks: kind === 'grenade' ? Math.round((launch.fuse ?? 3) * TICK_RATE) : null,
    armTicks: kind === 'mine' && !launch.armed ? Math.round(PHYS.mineArmTime * TICK_RATE) : 0,
    dud: false,
    dead: false,
  };
}

/** What projectiles need from the world. */
export interface ProjectileContext {
  readonly terrain: Terrain;
  readonly waterLevel: number;
  readonly worms: Worm[];
  readonly wind: number;
  readonly rng: () => number;
  explode(x: number, y: number, blast: Blast): void;
  emit(event: SimEvent): void;
}

/** Advances one projectile by one tick. Sets `dead` when it explodes or sinks. */
export function stepProjectile(p: Projectile, ctx: ProjectileContext): void {
  p.prevX = p.x;
  p.prevY = p.y;
  if (p.kind === 'shell') flyShell(p, ctx);
  else roll(p, ctx);
  if (p.dead) return;

  if (p.y > ctx.waterLevel) {
    p.dead = true;
    ctx.emit({ type: 'sink', x: p.x, y: ctx.waterLevel });
    return;
  }
  if (p.kind === 'grenade' && --p.fuseTicks! <= 0) explodeProjectile(p, ctx);
  if (p.kind === 'mine') tickMine(p, ctx);
}

/** A blast nearby throws a projectile and sets off mines (even duds) after a short delay. */
export function blastProjectile(p: Projectile, vx: number, vy: number): void {
  p.vx += vx;
  p.vy += vy;
  p.resting = false;
  if (p.kind === 'mine') {
    p.armTicks = 0;
    p.dud = false;
    p.fuseTicks = Math.min(p.fuseTicks ?? Infinity, Math.round(CHAIN_FUSE * TICK_RATE));
  }
}

/** Bazooka shells fly with gravity and wind and explode on the first ground or worm they touch. */
function flyShell(p: Projectile, ctx: ProjectileContext): void {
  p.vy = Math.min(p.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
  p.vx += ctx.wind * PHYS.windMax * DT;
  const r = PROJECTILE_RADIUS.shell;
  const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * DT));
  for (let i = 0; i < steps; i++) {
    const nx = p.x + (p.vx * DT) / steps;
    const ny = p.y + (p.vy * DT) / steps;
    p.x = nx;
    p.y = ny;
    if (!ctx.terrain.discFree(nx, ny, r) || touchesWorm(nx, ny, r, ctx.worms)) {
      explodeProjectile(p, ctx);
      return;
    }
    if (ny > ctx.waterLevel) return;
  }
}

/** Grenades and mines fall, bounce and roll until they come to rest. */
function roll(p: Projectile, ctx: ProjectileContext): void {
  const r = PROJECTILE_RADIUS[p.kind];
  if (p.resting) {
    if (!ctx.terrain.discFree(p.x, p.y + 1, r)) return;
    p.resting = false; // the ground under it was blown away
  }
  p.vy = Math.min(p.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
  pushOut(p, r, ctx.terrain);
  const n = moveDisc(p, r, ctx.terrain);
  if (!n) return;
  bounceOff(p, n, p.kind === 'mine' ? 0.2 : PHYS.grenadeBounce, PHYS.grenadeFriction);
  if (n.y < -0.5 && Math.hypot(p.vx, p.vy) < SETTLE_SPEED) {
    p.vx = 0;
    p.vy = 0;
    p.resting = true;
  }
}

/** Mines arm after a delay, wait for a worm to come close, then (usually) explode. */
function tickMine(p: Projectile, ctx: ProjectileContext): void {
  if (p.armTicks > 0) {
    p.armTicks--;
    return;
  }
  if (p.fuseTicks === null) {
    const near = (w: Worm) => w.alive && Math.hypot(w.x - p.x, w.y - p.y) < PHYS.mineTriggerRadius;
    if (!p.dud && ctx.worms.some(near)) {
      p.fuseTicks = Math.round(PHYS.mineFuse * TICK_RATE);
      ctx.emit({ type: 'mineTriggered', id: p.id });
    }
    return;
  }
  if (--p.fuseTicks > 0) return;
  if (ctx.rng() < PHYS.mineDudChance) {
    p.fuseTicks = null;
    p.dud = true;
    ctx.emit({ type: 'dud', x: p.x, y: p.y });
    return;
  }
  explodeProjectile(p, ctx);
}

function explodeProjectile(p: Projectile, ctx: ProjectileContext): void {
  p.dead = true;
  ctx.explode(p.x, p.y, p.kind === 'shell' ? BLASTS.bazooka : BLASTS[p.kind]);
}

function touchesWorm(x: number, y: number, r: number, worms: Worm[]): boolean {
  return worms.some((w) => w.alive && Math.hypot(w.x - x, w.y - y) < PHYS.wormRadius + r);
}
