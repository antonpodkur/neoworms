import { PHYS } from './constants';
import { findSpawnPoints, generateMap, type MapPreset } from './mapgen';
import { mulberry32 } from './rng';
import type { Terrain } from './terrain';
import { createWorm, NO_INPUT, stepWorm, type Worm, type WormInput } from './worm';

/**
 * Everything that happened during a tick that the outside world (renderer now, network later)
 * needs to know about. Positions are read from state directly; events cover the one-off changes.
 */
export type SimEvent =
  | { type: 'carve'; x: number; y: number; r: number }
  | { type: 'explosion'; x: number; y: number; r: number }
  | { type: 'damage'; wormId: number; amount: number }
  | { type: 'death'; wormId: number; cause: 'drowned' | 'killed' };

export interface TeamSetup {
  name: string;
  worms: string[];
}

/** The whole game state. Pure TypeScript with no rendering, so it can be tested and synced. */
export class World {
  readonly worms: Worm[] = [];
  activeWormId = -1;
  tick = 0;
  private events: SimEvent[] = [];

  constructor(
    readonly terrain: Terrain,
    readonly waterLevel: number,
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
    for (const worm of this.worms) {
      if (!worm.alive) continue;
      worm.prevX = worm.x;
      worm.prevY = worm.y;
      const fallDamage = stepWorm(worm, worm.id === this.activeWormId ? input : NO_INPUT, this.terrain);
      if (fallDamage > 0) this.damage(worm, fallDamage);
      if (worm.alive && worm.y - PHYS.wormRadius > this.waterLevel) this.kill(worm, 'drowned');
    }
  }

  /** Blows a hole in the terrain and damages and throws worms in range. */
  explode(x: number, y: number, radius: number, damage: number): void {
    this.terrain.carve(x, y, radius);
    this.events.push({ type: 'carve', x, y, r: radius }, { type: 'explosion', x, y, r: radius });

    const reach = radius + PHYS.wormRadius;
    for (const worm of this.worms) {
      if (!worm.alive) continue;
      const dx = worm.x - x;
      const dy = worm.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist >= reach) continue;
      const power = 1 - dist / reach;
      const ux = dist > 0.001 ? dx / dist : 0;
      const uy = dist > 0.001 ? dy / dist : -1;
      // A little extra lift makes worms fly in an arc instead of sliding along the ground.
      worm.vx += ux * PHYS.blastKnockback * power;
      worm.vy += uy * PHYS.blastKnockback * power - PHYS.blastLift * power;
      worm.grounded = false;
      worm.knocked = true;
      this.damage(worm, Math.max(1, Math.round(damage * power)));
    }
  }

  /** Makes the next living worm (in id order) the active one. */
  selectNextWorm(): void {
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

/** Generates a map and places every team's worms on it, alternating teams across the map. */
export function createMatch(preset: MapPreset, seed: number, teams: TeamSetup[]): World {
  const { terrain, waterLevel } = generateMap(preset, seed);
  const world = new World(terrain, waterLevel);
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
  return world;
}
