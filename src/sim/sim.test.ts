import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { findSpawnPoints, generateMap, MAP_PRESETS } from './mapgen';
import { mulberry32 } from './rng';
import { Terrain } from './terrain';
import { NO_INPUT, type WormInput } from './worm';
import { World } from './world';

const R = PHYS.wormRadius;
const GROUND = 300;

/** 800x400 map with flat ground from y=GROUND down, water far below. */
function flatWorld(): World {
  const terrain = new Terrain(800, 400);
  for (let y = GROUND; y < 400; y++) for (let x = 0; x < 800; x++) terrain.mask[y * 800 + x] = 1;
  return new World(terrain, 1000);
}

/** Center height at which a worm rests on ground whose top row is `top`. */
const restingY = (top: number) => top - R - 0.5;

function run(world: World, ticks: number, input: Partial<WormInput> = {}): void {
  for (let i = 0; i < ticks; i++) world.step({ ...NO_INPUT, ...input });
}

describe('Terrain', () => {
  it('carves a round hole and reports open space', () => {
    const terrain = new Terrain(100, 100);
    terrain.fillCircle(50, 50, 30, true);
    expect(terrain.isSolid(50, 50)).toBe(true);
    terrain.carve(50, 50, 10);
    expect(terrain.isSolid(50, 50)).toBe(false);
    expect(terrain.isSolid(50, 35)).toBe(true);
    expect(terrain.discFree(50, 50, 5)).toBe(true);
    expect(terrain.discFree(50, 50, 15)).toBe(false);
  });

  it('treats everything outside the map as air', () => {
    const terrain = new Terrain(10, 10);
    terrain.mask.fill(1);
    expect(terrain.isSolid(-1, 5)).toBe(false);
    expect(terrain.isSolid(5, 10)).toBe(false);
  });

  it('points the normal away from flat ground', () => {
    const world = flatWorld();
    const n = world.terrain.normalAt(400, GROUND - 3, 8)!;
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-1);
  });
});

describe('Worm movement', () => {
  it('drops onto the ground and stays put', () => {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, GROUND - 40);
    run(world, 120);
    expect(worm.grounded).toBe(true);
    expect(worm.y).toBeCloseTo(restingY(GROUND), 0);
    expect(worm.hp).toBe(100);
  });

  it('walks along flat ground at walking speed', () => {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, restingY(GROUND));
    run(world, 10);
    run(world, 60, { right: true });
    expect(worm.x).toBeGreaterThan(400 + PHYS.walkSpeed - 3);
    expect(worm.x).toBeLessThan(400 + PHYS.walkSpeed + 3);
    expect(worm.y).toBeCloseTo(restingY(GROUND), 0);
    expect(worm.facing).toBe(1);
  });

  it('climbs a gentle slope but is stopped by a wall', () => {
    const world = flatWorld();
    const { terrain } = world;
    // A 1:2 ramp rising to the right from x=450, then a tall wall at x=600.
    for (let x = 450; x < 600; x++) {
      const top = GROUND - Math.floor((x - 450) / 2);
      for (let y = top; y < GROUND; y++) terrain.mask[y * 800 + x] = 1;
    }
    for (let x = 600; x < 620; x++) for (let y = 0; y < GROUND; y++) terrain.mask[y * 800 + x] = 1;

    const worm = world.addWorm('A', 0, 420, restingY(GROUND));
    run(world, 10);
    run(world, 60 * 5, { right: true });
    expect(worm.grounded).toBe(true);
    expect(worm.y).toBeLessThan(restingY(GROUND) - 60); // went up the ramp
    expect(worm.x).toBeLessThan(600 - R + 1); // didn't pass the wall
  });

  it('jumps forward and lands further along', () => {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, restingY(GROUND));
    run(world, 10);
    run(world, 1, { jump: true });
    expect(worm.grounded).toBe(false);
    run(world, 120);
    expect(worm.grounded).toBe(true);
    expect(worm.x).toBeGreaterThan(460);
    expect(worm.hp).toBe(100);
  });

  it('takes fall damage from a big drop but not a small one', () => {
    const world = flatWorld();
    const small = world.addWorm('A', 0, 200, GROUND - 60);
    const big = world.addWorm('B', 0, 600, GROUND - 380);
    run(world, 240);
    expect(small.hp).toBe(100);
    expect(big.hp).toBeLessThan(100);
    expect(big.alive).toBe(true);
  });

  it('falls when the ground under it is blown away', () => {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, restingY(GROUND));
    run(world, 10);
    world.terrain.carve(400, GROUND + 20, 40);
    run(world, 1);
    expect(worm.grounded).toBe(false);
  });

  it('drowns below the water line', () => {
    const terrain = new Terrain(400, 400);
    const world = new World(terrain, 300);
    const worm = world.addWorm('A', 0, 200, 250);
    run(world, 120);
    expect(worm.alive).toBe(false);
    expect(world.drainEvents()).toContainEqual({ type: 'death', wormId: worm.id, cause: 'drowned' });
  });
});

describe('Explosions', () => {
  it('carves terrain, damages and throws nearby worms, and ignores far ones', () => {
    const world = flatWorld();
    const near = world.addWorm('A', 0, 400, restingY(GROUND));
    const far = world.addWorm('B', 0, 700, restingY(GROUND));
    run(world, 10);
    world.explode(410, GROUND, 40, 40);

    expect(world.terrain.isSolid(410, GROUND + 10)).toBe(false);
    expect(near.hp).toBeLessThan(100);
    expect(near.knocked).toBe(true);
    expect(near.vx).toBeLessThan(0); // thrown away from the blast
    expect(far.hp).toBe(100);

    run(world, 60 * 6);
    expect(near.grounded).toBe(true); // eventually settles
  });

  it('switches to the next worm when the active one dies', () => {
    const world = flatWorld();
    const a = world.addWorm('A', 0, 400, restingY(GROUND));
    const b = world.addWorm('B', 1, 700, restingY(GROUND));
    expect(world.activeWormId).toBe(a.id);
    world.explode(400, GROUND - R, 30, 500);
    expect(a.alive).toBe(false);
    expect(world.activeWormId).toBe(b.id);
  });
});

describe('Map generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateMap('one-island', 42);
    const b = generateMap('one-island', 42);
    const c = generateMap('one-island', 43);
    expect(a.terrain.mask).toEqual(b.terrain.mask);
    expect(a.terrain.mask).not.toEqual(c.terrain.mask);
  });

  it('never spawns worms inside a sealed cave pocket', () => {
    const world = flatWorld();
    // Ground from y=300 is solid; hollow out a big sealed pocket inside it.
    for (let y = 320; y < 390; y++) for (let x = 20; x < 780; x++) world.terrain.mask[y * 800 + x] = 0;
    const spots = findSpawnPoints(world.terrain, 1000, 6, R, mulberry32(3), 40);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) expect(s.y).toBeLessThan(GROUND);
  });

  it.each(MAP_PRESETS.map((p) => p.id))('%s has room for 8 worms on dry land', (preset) => {
    const { terrain, waterLevel } = generateMap(preset, 7);
    const spots = findSpawnPoints(terrain, waterLevel, 8, R, mulberry32(1));
    expect(spots).toHaveLength(8);
    for (const s of spots) {
      expect(s.y).toBeLessThan(waterLevel);
      expect(terrain.discFree(s.x, s.y, R)).toBe(true);
      expect(terrain.discFree(s.x, s.y + 1, R)).toBe(false); // standing on ground
    }
  });
});
