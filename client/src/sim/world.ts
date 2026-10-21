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
import { mulberry32, nextRandom } from './rng';
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
  | { type: 'dud'; x: number; y: number }
  | { type: 'weaponUsed' };

/** Everything about a World that changes as the game is played (all but the terrain). */
export interface WorldState {
  worms: Worm[];
  projectiles: Projectile[];
  activeWormId: number;
  wind: number;
  tick: number;
  waterLevel: number;
  nextProjectileId: number;
  rngState: number;
}

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
  private rngState: number;

  constructor(
    readonly terrain: Terrain,
    public waterLevel: number,
    seed = 1,
  ) {
    this.rngState = seed >>> 0;
  }

  /** Random number in 0..1 from the world's own seeded sequence. */
  readonly rng = (): number => {
    const [value, next] = nextRandom(this.rngState);
    this.rngState = next;
    return value;
  };

  /** A deep copy of the changing state; the terrain travels separately as carve events. */
  snapshot(): WorldState {
    return structuredClone({
      worms: this.worms,
      projectiles: this.projectiles,
      activeWormId: this.activeWormId,
      wind: this.wind,
      tick: this.tick,
      waterLevel: this.waterLevel,
      nextProjectileId: this.nextProjectileId,
      rngState: this.rngState,
    });
  }

  /** Takes over a snapshot (not copied, so don't reuse it). */
  restore(state: WorldState): void {
    this.worms.splice(0, this.worms.length, ...state.worms);
    this.projectiles = state.projectiles;
    this.activeWormId = state.activeWormId;
    this.wind = state.wind;
    this.tick = state.tick;
    this.waterLevel = state.waterLevel;
    this.nextProjectileId = state.nextProjectileId;
    this.rngState = state.rngState;
  }

  addWorm(name: string, team: number, x: number, y: number, hp = 100): Worm {
    const worm = createWorm(this.worms.length, name, team, x, y, hp);
    this.worms.push(worm);
    if (this.activeWormId < 0) this.activeWormId = worm.id;
    return worm;
  }

  get activeWorm(): Worm | undefined {
    const worm = this.worms[this.activeWormId];
    return worm?.alive ? worm : undefined;
  }

  /**
   * Advances the game by one fixed tick; `input` drives the active worm. With `canFire`
   * false (retreat time) it can still move and use the rope, but not fire weapons.
   */
  step(input: WormInput, canFire = true): void {
    this.tick++;
    const active = this.activeWorm;
    if (active) useWeapons(active, input, this, canFire);

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

  weaponUsed(): void {
    this.events.push({ type: 'weaponUsed' });
  }

  changeWind(): void {
    this.wind = Math.round((this.rng() * 2 - 1) * 10) / 10;
  }

  /** Sudden death: the sea creeps up. */
  raiseWater(amount: number): void {
    this.waterLevel -= amount;
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
    worm.rope = null;
    worm.charge = null;
    this.events.push({ type: 'death', wormId: worm.id, cause });
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
export function createWorld(map: GeneratedMap, seed: number, teams: TeamSetup[], wormHp = 100): World {
  const { terrain, waterLevel } = map;
  const world = new World(terrain, waterLevel, seed ^ 0x3a7);
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
    world.addWorm(entry.name, entry.team, spot.x, spot.y, wormHp);
  });

  // Mines go on other floor spots, never right next to a worm.
  const clearOfWorms = (s: { x: number; y: number }) =>
    world.worms.every((w) => Math.hypot(w.x - s.x, w.y - s.y) > PHYS.mineTriggerRadius * 2);
  findSpawnPoints(terrain, waterLevel, PHYS.mapMines * 3, PHYS.wormRadius, rng, 40)
    .filter(clearOfWorms)
    .slice(0, PHYS.mapMines)
    .forEach((s) => world.spawn({ kind: 'mine', x: s.x, y: s.y, vx: 0, vy: 0, armed: true }));
  return world;
}
