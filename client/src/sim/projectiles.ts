import { DT, PHYS, TICK_RATE } from './constants';
import { bounceOff, moveDisc, pushOut } from './physics';
import type { Terrain, Vec2 } from './terrain';
import { BLASTS, type Blast, type WeaponId } from './weapons';
import type { SimEvent } from './world';
import type { Worm } from './worm';

export type ProjectileKind =
  | 'shell'
  | 'missile'
  | 'fragment'
  | 'bomblet'
  | 'grenade'
  | 'cluster'
  | 'banana'
  | 'dynamite'
  | 'mine'
  | 'oldWoman'
  | 'petrol'
  | 'flame'
  | 'homing'
  | 'dragonBall'
  | 'holy'
  | 'sheep'
  | 'superSheep';

/**
 * How each kind of projectile behaves. fly: explodes on the first ground or worm it touches.
 * roll: falls, bounces and rolls until its fuse runs out (mines wait for a worm instead).
 * walk: falls like `roll`, then walks along the ground, turning at walls, until its fuse runs out.
 */
interface KindSpec {
  radius: number;
  motion: 'fly' | 'roll' | 'walk';
  /** fly only: pulled down by gravity, pushed by the wind. */
  gravity?: boolean;
  wind?: boolean;
  /**
   * Seconds until it goes off; 'launch' takes the launch's fuse (the one picked with Tab for
   * grenades). None for mines.
   */
  fuse?: number | 'launch';
  /** When the fuse runs out it just goes out, no blast (dragon ball, flames). */
  fizzle?: boolean;
  /** Share of speed kept bouncing off ground; the grenade's tuning value when left out. */
  bounce?: number;
  blast: Blast;
  /** Breaks into these when it goes off; `life` gives each a fuse in this range (flames). */
  split?: { kind: ProjectileKind; count: number; speed: number; life?: () => [number, number] };
  /** walk only: pixels per second, and seconds between hops (sheep). */
  walk?: { speed: () => number; hopEvery?: () => number };
  /** Burns worms close to it (petrol bomb flames). */
  burns?: boolean;
  /** Turns toward its target after a moment (homing missile). */
  homing?: boolean;
  /** Steered by its owner: Space sets it off, or makes it take off if it `flies` (super sheep). */
  remote?: boolean;
  flies?: boolean;
}

export const KINDS: Record<ProjectileKind, KindSpec> = {
  shell: { radius: 2, motion: 'fly', gravity: true, wind: true, blast: BLASTS.bazooka },
  missile: { radius: 2, motion: 'fly', blast: BLASTS.airstrike },
  fragment: { radius: 2, motion: 'fly', gravity: true, blast: BLASTS.clusterFragment },
  bomblet: { radius: 3, motion: 'fly', gravity: true, blast: BLASTS.banana },
  grenade: { radius: 3, motion: 'roll', fuse: 'launch', blast: BLASTS.grenade },
  cluster: {
    radius: 3,
    motion: 'roll',
    fuse: 'launch',
    blast: BLASTS.grenade,
    split: { kind: 'fragment', count: 5, speed: 220 },
  },
  banana: {
    radius: 3,
    motion: 'roll',
    fuse: 'launch',
    blast: BLASTS.banana,
    split: { kind: 'bomblet', count: 5, speed: 280 },
  },
  dynamite: { radius: 3, motion: 'roll', fuse: 5, bounce: 0.2, blast: BLASTS.dynamite },
  mine: { radius: 3, motion: 'roll', bounce: 0.2, blast: BLASTS.mine },
  oldWoman: { radius: 5, motion: 'walk', fuse: 5, bounce: 0.2, blast: BLASTS.oldWoman, walk: { speed: () => 30 } },
  /** Bursts on whatever it hits into flames that burn for a few seconds. */
  petrol: {
    radius: 3,
    motion: 'fly',
    gravity: true,
    wind: true,
    blast: BLASTS.petrol,
    split: { kind: 'flame', count: 12, speed: 110, life: () => [PHYS.flameLifeMin, PHYS.flameLifeMax] },
  },
  flame: { radius: 2, motion: 'roll', fuse: 'launch', fizzle: true, bounce: 0, burns: true, blast: BLASTS.petrol },
  homing: { radius: 2, motion: 'fly', gravity: true, wind: true, homing: true, blast: BLASTS.bazooka },
  dragonBall: { radius: 4, motion: 'fly', fuse: 'launch', fizzle: true, blast: BLASTS.dragonBall },
  holy: { radius: 3, motion: 'roll', fuse: 3, bounce: 0.15, blast: BLASTS.holy },
  sheep: {
    radius: 5,
    motion: 'walk',
    fuse: 'launch',
    bounce: 0.2,
    blast: BLASTS.sheep,
    walk: { speed: () => PHYS.sheepSpeed, hopEvery: () => PHYS.sheepHopEvery },
    remote: true,
  },
  superSheep: {
    radius: 5,
    motion: 'walk',
    fuse: 'launch',
    bounce: 0.2,
    blast: BLASTS.sheep,
    walk: { speed: () => PHYS.sheepSpeed, hopEvery: () => PHYS.sheepHopEvery },
    remote: true,
    flies: true,
  },
};

/** Fuse of a mine set off by a nearby explosion: chain reactions. */
const CHAIN_FUSE = 0.3;
/** Grenades and mines slower than this when touching the floor come to rest. */
const SETTLE_SPEED = 20;
/** Moving less than this (px) in a tick while touching ground counts as stuck. */
const STUCK_DISTANCE = 0.1;
/** The steepest step a walker takes (px per px). */
const WALK_CLIMB = 3;
/** A walker's hop sideways speed (sheep). */
const HOP_VX = 50;
/** Ticks a super sheep can't hit its owner after taking off (it starts right beside it). */
const TAKEOFF_GRACE = 20;
/** Fragments fly out upwards, spread over this angle either side of straight up (radians). */
const SPLIT_SPREAD = 1.05;

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
  /** Ticks until it goes off (fused kinds, or a triggered mine); null while a mine waits. */
  fuseTicks: number | null;
  /** Ticks until a mine is armed. */
  armTicks: number;
  /** A mine that fizzled; only an explosion can still set it off. */
  dud: boolean;
  /** Which way a walker is heading, and its sub-pixel progress. */
  dir: 1 | -1;
  walked: number;
  /** The worm that set it off, for ones it steers (sheep); -1 for none. */
  owner: number;
  /** Where a homing missile is going; null when it isn't (or gave up). */
  target: Vec2 | null;
  /** Ticks since it was launched. */
  age: number;
  /** A super sheep's flight direction in radians once it takes off; null before. */
  heading: number | null;
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
  owner?: number;
  target?: Vec2 | null;
}

export function createProjectile(id: number, launch: Launch): Projectile {
  const { kind, x, y, vx, vy } = launch;
  const fuse = KINDS[kind].fuse;
  const seconds = fuse === 'launch' ? (launch.fuse ?? (kind === 'sheep' || kind === 'superSheep' ? PHYS.sheepFuse : 3)) : fuse;
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
    fuseTicks: seconds === undefined ? null : Math.round(seconds * TICK_RATE),
    armTicks: kind === 'mine' && !launch.armed ? Math.round(PHYS.mineArmTime * TICK_RATE) : 0,
    dud: false,
    dir: vx < 0 ? -1 : 1,
    walked: 0,
    owner: launch.owner ?? -1,
    target: launch.target ?? null,
    age: 0,
    heading: null,
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
  explode(x: number, y: number, blast: Blast, heading?: number): void;
  /** A flame at (x, y) burns worms near it, and with `dig` eats a little of the ground. */
  burn(x: number, y: number, dig: boolean): void;
  spawn(launch: Launch): void;
  emit(event: SimEvent): void;
}

/** Ticks between a flame's burns, and how many burns between bites out of the ground. */
const burnTicks = () => Math.max(1, Math.round(PHYS.flameTick * TICK_RATE));
const DIG_EVERY = 8;

/** Advances one projectile by one tick. Sets `dead` when it explodes or sinks. */
export function stepProjectile(p: Projectile, ctx: ProjectileContext): void {
  p.prevX = p.x;
  p.prevY = p.y;
  p.age++;
  const spec = KINDS[p.kind];
  if (p.heading !== null) flyHeaded(p, ctx);
  else if (spec.motion === 'fly') fly(p, ctx);
  else if (spec.motion === 'walk' && !p.resting) walk(p, ctx);
  else roll(p, ctx);
  if (p.dead) return;

  if (p.y > ctx.waterLevel) {
    p.dead = true;
    ctx.emit({ type: 'sink', x: p.x, y: ctx.waterLevel });
    if (spec.remote) released(p, ctx);
    return;
  }
  if (spec.burns && p.age % burnTicks() === 0) ctx.burn(p.x, p.y, (p.age / burnTicks()) % DIG_EVERY === 0);
  if (p.kind === 'mine') tickMine(p, ctx);
  else if (p.fuseTicks !== null && --p.fuseTicks <= 0) {
    if (spec.fizzle) p.dead = true;
    else explodeProjectile(p, ctx);
  }
}

/**
 * Its owner pressed Space: a super sheep still on its feet takes off (straight up), anything
 * else it steers goes off.
 */
export function triggerProjectile(p: Projectile, ctx: ProjectileContext): void {
  if (KINDS[p.kind].flies && p.heading === null) {
    p.heading = -Math.PI / 2;
    p.resting = false;
    p.armTicks = TAKEOFF_GRACE;
    p.fuseTicks = Math.round(PHYS.superSheepFlight * TICK_RATE);
  } else explodeProjectile(p, ctx);
}

/** ← → turn a flying super sheep (-1 left, 1 right). */
export function steerProjectile(p: Projectile, turn: number): void {
  if (p.heading !== null) p.heading += turn * PHYS.superSheepTurn * DT;
}

/** A steered weapon is spent (gone off or sunk): the turn moves on to retreat time. */
function released(p: Projectile, ctx: ProjectileContext): void {
  if (p.owner >= 0) ctx.emit({ type: 'weaponUsed', weapon: p.kind as WeaponId, ammoTaken: true });
}

/** A flying super sheep: straight ahead at a steady speed until it hits something. */
function flyHeaded(p: Projectile, ctx: ProjectileContext): void {
  const r = KINDS[p.kind].radius;
  p.vx = Math.cos(p.heading!) * PHYS.superSheepSpeed;
  p.vy = Math.sin(p.heading!) * PHYS.superSheepSpeed;
  const steps = Math.max(1, Math.ceil(PHYS.superSheepSpeed * DT));
  const others = p.armTicks > 0 ? ctx.worms.filter((w) => w.id !== p.owner) : ctx.worms;
  if (p.armTicks > 0) p.armTicks--;
  for (let i = 0; i < steps; i++) {
    p.x += (p.vx * DT) / steps;
    p.y += (p.vy * DT) / steps;
    const outside = p.x < -r || p.x > ctx.terrain.width + r;
    if (outside || !ctx.terrain.discFree(p.x, p.y, r) || touchesWorm(p.x, p.y, r, others)) {
      explodeProjectile(p, ctx);
      return;
    }
  }
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

/** Shells, missiles and fragments fly until they touch ground or a worm, then explode. */
function fly(p: Projectile, ctx: ProjectileContext): void {
  const spec = KINDS[p.kind];
  if (spec.homing && p.target && p.age > PHYS.homingLife * TICK_RATE) p.target = null; // gives up
  if (spec.homing && p.target && p.age > PHYS.homingDelay * TICK_RATE) home(p, p.target);
  else {
    if (spec.gravity) p.vy = Math.min(p.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
    if (spec.wind) p.vx += ctx.wind * PHYS.windMax * DT;
  }
  const r = spec.radius;
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

/** Turns toward the target as fast as it may, settling to its cruising speed. */
function home(p: Projectile, target: Vec2): void {
  const speed = Math.hypot(p.vx, p.vy);
  const current = Math.atan2(p.vy, p.vx);
  const wanted = Math.atan2(target.y - p.y, target.x - p.x);
  let turn = wanted - current;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // -PI..PI
  const max = PHYS.homingTurn * DT;
  const angle = current + Math.max(-max, Math.min(max, turn));
  const cruise = speed + (PHYS.homingSpeed - speed) * (1 - Math.exp(-4 * DT));
  p.vx = Math.cos(angle) * cruise;
  p.vy = Math.sin(angle) * cruise;
}

/** Grenades, mines and dynamite fall, bounce (off worms too) and roll until they come to rest. */
function roll(p: Projectile, ctx: ProjectileContext): void {
  const spec = KINDS[p.kind];
  const r = spec.radius;
  if (p.resting) {
    if (!ctx.terrain.discFree(p.x, p.y + 1, r)) return;
    p.resting = false; // the ground under it was blown away
  }
  p.vy = Math.min(p.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
  pushOut(p, r, ctx.terrain);
  const n = moveDisc(p, r, ctx.terrain);
  const bounce = spec.bounce ?? PHYS.grenadeBounce;
  bounceOffWorms(p, r, bounce, ctx.worms);
  if (!n) return;
  const into = -(p.vx * n.x + p.vy * n.y);
  bounceOff(p, n, into < PHYS.grenadeMinBounceSpeed ? 0 : bounce, PHYS.grenadeFriction);
  // At rest once it's slow on a floor, or wedged where it can't go anywhere (on steep pixel
  // slopes the bounce can leave some speed that never turns into movement).
  const moved = Math.hypot(p.x - p.prevX, p.y - p.prevY);
  if ((n.y < -0.5 && Math.hypot(p.vx, p.vy) < SETTLE_SPEED) || moved < STUCK_DISTANCE) {
    p.vx = 0;
    p.vy = 0;
    p.resting = true;
  }
}

/**
 * The old woman and sheep: thrown about like a grenade, but on firm ground they walk, turning
 * at walls; sheep hop every so often.
 */
function walk(p: Projectile, ctx: ProjectileContext): void {
  const spec = KINDS[p.kind];
  const r = spec.radius;
  const { terrain } = ctx;
  const standing = !terrain.discFree(p.x, p.y + 1, r) && Math.hypot(p.vx, p.vy) < SETTLE_SPEED;
  if (!standing) {
    p.vy = Math.min(p.vy + PHYS.gravity * DT, PHYS.maxFallSpeed);
    pushOut(p, r, terrain);
    const n = moveDisc(p, r, terrain);
    if (n) bounceOff(p, n, KINDS[p.kind].bounce!, PHYS.grenadeFriction);
    return;
  }
  p.vx = 0;
  p.vy = 0;
  const hopEvery = spec.walk?.hopEvery?.();
  if (hopEvery && p.age % Math.max(1, Math.round(hopEvery * TICK_RATE)) === 0) {
    p.vx = p.dir * HOP_VX;
    p.vy = -PHYS.sheepHop;
    return;
  }
  p.walked += (spec.walk?.speed() ?? 30) * DT;
  while (p.walked >= 1) {
    p.walked -= 1;
    if (!stepAlong(p, r, terrain)) p.dir = p.dir === 1 ? -1 : 1;
  }
}

/** Moves a walker one pixel along the ground, up or down slopes. False if a wall blocks it. */
function stepAlong(p: Projectile, r: number, terrain: Terrain): boolean {
  const nx = p.x + p.dir;
  for (let up = 0; up <= WALK_CLIMB; up++) {
    if (!terrain.discFree(nx, p.y - up, r)) continue;
    p.x = nx;
    p.y -= up;
    for (let down = 0; down < WALK_CLIMB && terrain.discFree(p.x, p.y + 1, r); down++) p.y += 1;
    return true;
  }
  return false;
}

/** Bounces a projectile off any worm it has run into, as if the worm were a solid disc. */
function bounceOffWorms(p: Projectile, r: number, bounce: number, worms: Worm[]): void {
  for (const w of worms) {
    if (!w.alive) continue;
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    const dist = Math.hypot(dx, dy);
    const min = PHYS.wormRadius + r;
    if (dist >= min) continue;
    // Dead centre on top: nudge it off to one side so it rolls off instead of balancing.
    const n = dist > 0.5 ? { x: dx / dist, y: dy / dist } : { x: p.id % 2 ? 0.3 : -0.3, y: -0.95 };
    p.x = w.x + n.x * min;
    p.y = w.y + n.y * min;
    bounceOff(p, n, bounce, PHYS.grenadeFriction);
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
      const fuse = PHYS.mineFuseMin + ctx.rng() * (PHYS.mineFuseMax - PHYS.mineFuseMin);
      p.fuseTicks = Math.round(fuse * TICK_RATE);
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
  const spec = KINDS[p.kind];
  // Only things in flight have a heading; a grenade or mine lying still throws worms either way.
  const heading = Math.hypot(p.vx, p.vy) > SETTLE_SPEED ? Math.sign(p.vx) || undefined : undefined;
  ctx.explode(p.x, p.y, spec.blast, heading);
  if (spec.remote) released(p, ctx);
  if (!spec.split) return;
  // Cluster fragments, banana bomblets and flames fan out upwards from the crater.
  const { kind, count, speed, life } = spec.split;
  for (let i = 0; i < count; i++) {
    const angle = ((i / (count - 1)) * 2 - 1) * SPLIT_SPREAD + (ctx.rng() - 0.5) * 0.3;
    const s = speed * (0.75 + ctx.rng() * 0.5);
    const range = life?.();
    const fuse = range ? range[0] + ctx.rng() * (range[1] - range[0]) : undefined;
    ctx.spawn({ kind, x: p.x, y: p.y, vx: Math.sin(angle) * s, vy: -Math.cos(angle) * s, fuse });
  }
}

function touchesWorm(x: number, y: number, r: number, worms: Worm[]): boolean {
  return worms.some((w) => w.alive && Math.hypot(w.x - x, w.y - y) < PHYS.wormRadius + r);
}
