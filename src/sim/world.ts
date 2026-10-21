import { PHYS } from './constants';
import { findSpawnPoints, type GeneratedMap } from './mapgen';
import {
  blastProjectile,
  createProjectile,
  stepProjectile,
  type Launch,
  type Projectile,
  type ProjectileContext,
} from './projectiles';
import { mulberry32 } from './rng';
import type { Terrain } from './terrain';
import { useWeapons, type Blast, type WeaponContext } from './weapons';
import { createWorm, NO_INPUT, stepWorm, type Worm, type WormInput } from './worm';

/**
 * Everything that happened during a tick that the outside world (renderer now, network later)
 * needs to know about. Positions are read from state directly; events cover the one-off changes.
 */
export type SimEvent =
  | { type: 'carve'; x: number; y: number; r: number }
  | { type: 'explosion'; x: number; y: number; r: number }
  | { type: 'damage'; wormId: number; amount: number }
  | { type: 'death'; wormId: number; cause: 'drowned' | 'killed' }
  | { type: 'sink'; x: number; y: number }
  | { type: 'mineTriggered'; id: number }
  | { type: 'dud'; x: number; y: number };

export interface TeamSetup {
  name: string;
  worms: string[];
}

/** While charging a shot the worm stands still (it can still aim). */
const CHARGING_LOCK: Partial<WormInput> = { left: false, right: false, jump: false, backflip: false };

/** The whole game state. Pure TypeScript with no rendering, so it can be tested and synced. */
export class World implements ProjectileContext, WeaponContext {
  readonly worms: Worm[] = [];
  projectiles: Projectile[] = [];
  activeWormId = -1;
  /** -1 (full left) .. 1 (full right); pushes bazooka shells. */
  wind = 0;
  tick = 0;
  private events: SimEvent[] = [];
  private nextProjectileId = 0;

  constructor(
    readonly terrain: Terrain,
    readonly waterLevel: number,
    readonly rng: () => number = mulberry32(1),
  ) {}

  addWorm(name: string, team: number, x: number, y: number): Worm {
    const worm = createWorm(this.worms.length, name, team, x, y);
    this.worms.push(worm);
    if (this.activeWormId < 0) this.activeWormId = worm.id;
    return worm;
  }

  get activeWorm(): Worm | undefined {
    const worm = this.worms[this.activeWormId];
    return worm?.alive ? worm : undefined;
  }

  /** Advances the game by one fixed tick; `input` drives the active worm. */
  step(input: WormInput): void {
    this.tick++;
    const active = this.activeWorm;
    if (active) useWeapons(active, input, this);

    for (const worm of this.worms) {
      if (!worm.alive) continue;
      worm.prevX = worm.x;
      worm.prevY = worm.y;
      let wormInput = worm === active ? input : NO_INPUT;
      if (worm.charge !== null) wormInput = { ...wormInput, ...CHARGING_LOCK };
      const fallDamage = stepWorm(worm, wormInput, this.terrain);
      if (fallDamage > 0) this.damage(worm, fallDamage);
      if (worm.alive && worm.y - PHYS.wormRadius > this.waterLevel) this.kill(worm, 'drowned');
    }

    for (const p of this.projectiles) if (!p.dead) stepProjectile(p, this);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  spawn(launch: Launch): void {
    this.projectiles.push(createProjectile(this.nextProjectileId++, launch));
  }

  changeWind(): void {
    this.wind = Math.round((this.rng() * 2 - 1) * 10) / 10;
  }

  /**
   * Blows a crater in the terrain. Worms and projectiles within the blast's reach get thrown
   * (worms also take damage), fading out with distance; mines in reach go off too.
   */
  explode(x: number, y: number, blast: Blast): void {
    this.terrain.carve(x, y, blast.radius);
    this.events.push({ type: 'carve', x, y, r: blast.radius }, { type: 'explosion', x, y, r: blast.radius });

    for (const worm of this.worms) {
      if (!worm.alive) continue;
      const push = blastPush(worm.x - x, worm.y - y, blast);
      if (!push) continue;
      worm.vx += push.vx;
      worm.vy += push.vy;
      worm.grounded = false;
      worm.knocked = true;
      worm.afterTouch = 0;
      worm.pendingJump = null;
      worm.ropeChain = false;
      worm.rope = null; // blasts knock worms off their rope
      this.damage(worm, Math.max(1, Math.round(blast.damage * push.power)));
    }
    for (const p of this.projectiles) {
      const push = p.dead ? null : blastPush(p.x - x, p.y - y, blast);
      if (push) blastProjectile(p, push.vx, push.vy);
    }
  }

  emit(event: SimEvent): void {
    this.events.push(event);
  }

  /** Makes the next living worm (in id order) the active one. */
  selectNextWorm(): void {
    const current = this.activeWorm;
    if (current) current.charge = null;
    const count = this.worms.length;
    for (let i = 1; i <= count; i++) {
      const worm = this.worms[(this.activeWormId + i) % count];
      if (worm.alive) {
        this.activeWormId = worm.id;
        return;
      }
    }
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private damage(worm: Worm, amount: number): void {
    worm.hp = Math.max(0, worm.hp - amount);
    this.events.push({ type: 'damage', wormId: worm.id, amount });
    if (worm.hp === 0) this.kill(worm, 'killed');
  }

  private kill(worm: Worm, cause: 'drowned' | 'killed'): void {
    worm.alive = false;
    this.events.push({ type: 'death', wormId: worm.id, cause });
    if (worm.id === this.activeWormId) this.selectNextWorm();
  }
}

/**
 * How hard a blast throws something at offset (dx, dy) from its centre, or null if out of
 * reach. `power` is 1 at the centre and 0 at the edge of the reach.
 */
function blastPush(dx: number, dy: number, blast: Blast): { vx: number; vy: number; power: number } | null {
  const dist = Math.hypot(dx, dy);
  if (dist >= blast.reach) return null;
  const power = 1 - dist / blast.reach;
  const speed = PHYS.blastKnockback * blast.push * power;
  const ux = dist > 0.001 ? dx / dist : 0;
  const uy = dist > 0.001 ? dy / dist : -1;
  // A little extra lift makes things fly in an arc instead of sliding along the ground.
  return { vx: ux * speed, vy: uy * speed - PHYS.blastLift * power, power };
}

/** Places every team's worms on the map (alternating teams across it) and scatters mines. */
export function createMatch(map: GeneratedMap, seed: number, teams: TeamSetup[]): World {
  const { terrain, waterLevel } = map;
  const world = new World(terrain, waterLevel, mulberry32(seed ^ 0x3a7));
  const rng = mulberry32(seed ^ 0x5eed);

  const roster: { name: string; team: number }[] = [];
  const longest = Math.max(...teams.map((t) => t.worms.length));
  for (let i = 0; i < longest; i++) {
    teams.forEach((team, t) => {
      if (i < team.worms.length) roster.push({ name: team.worms[i], team: t });
    });
  }

  const spots = findSpawnPoints(terrain, waterLevel, roster.length, PHYS.wormRadius, rng);
  roster.forEach((entry, i) => {
    const spot = spots[i] ?? { x: terrain.width / 2, y: 0 };
    world.addWorm(entry.name, entry.team, spot.x, spot.y);
  });

  // Mines go on other floor spots, never right next to a worm.
  const clearOfWorms = (s: { x: number; y: number }) =>
    world.worms.every((w) => Math.hypot(w.x - s.x, w.y - s.y) > PHYS.mineTriggerRadius * 2);
  findSpawnPoints(terrain, waterLevel, PHYS.mapMines * 3, PHYS.wormRadius, rng, 40)
    .filter(clearOfWorms)
    .slice(0, PHYS.mapMines)
    .forEach((s) => world.spawn({ kind: 'mine', x: s.x, y: s.y, vx: 0, vy: 0, armed: true }));
  world.changeWind();
  return world;
}
