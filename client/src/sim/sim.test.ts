import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { findSpawnPoints, generateMap, MAP_PRESETS, mapFromImage } from './mapgen';
import { mulberry32 } from './rng';
import { Terrain } from './terrain';
import { roundBlast } from './weapons';
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
    run(world, Math.ceil((200 / PHYS.walkSpeed) * 60), { right: true }); // long enough to reach the wall
    expect(worm.grounded).toBe(true);
    expect(worm.y).toBeLessThan(restingY(GROUND) - 60); // went up the ramp
    expect(worm.x).toBeLessThan(600 - R + 1); // didn't pass the wall
  });

  /** Lands a jump started by `presses` (tick offsets of Jump presses) and returns the worm. */
  function jumpWith(presses: number[], hold: Partial<WormInput> = {}) {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, restingY(GROUND));
    run(world, 10);
    for (let t = 0; t < 180; t++) world.step({ ...NO_INPUT, ...hold, jump: presses.includes(t) });
    return worm;
  }

  it('crouches first, then jumps forward and lands further along', () => {
    const world = flatWorld();
    const worm = world.addWorm('A', 0, 400, restingY(GROUND));
    run(world, 10);
    run(world, 1, { jump: true });
    run(world, Math.round(PHYS.jumpDelay * 60) - 2);
    expect(worm.grounded).toBe(true); // still winding up
    run(world, 3);
    expect(worm.grounded).toBe(false);
    run(world, 120);
    expect(worm.grounded).toBe(true);
    expect(worm.x).toBeGreaterThan(450);
    expect(worm.hp).toBe(100);
  });

  it('flips backwards when Jump is tapped twice quickly', () => {
    const jump = jumpWith([0]);
    const flip = jumpWith([0, 5]);
    expect(jump.x).toBeGreaterThan(400);
    expect(flip.x).toBeLessThan(400);
  });

  it('can be steered in the air by holding a direction', () => {
    const forward = jumpWith([0], { right: true });
    const back = jumpWith([0], { left: true });
    const plain = jumpWith([0]);
    expect(forward.x).toBeGreaterThan(plain.x + 3);
    expect(back.x).toBeLessThan(plain.x - 3);
  });

  it('takes fall damage from a big drop but not a small one, up to the cap', () => {
    const terrain = new Terrain(800, 3000);
    for (let y = 2900; y < 3000; y++) for (let x = 0; x < 800; x++) terrain.mask[y * 800 + x] = 1;
    const world = new World(terrain, 5000);
    const small = world.addWorm('A', 0, 100, 2900 - 60);
    const big = world.addWorm('B', 0, 400, 2900 - 300);
    const huge = world.addWorm('C', 0, 700, 100);
    run(world, 600);
    expect(small.hp).toBe(100);
    expect(big.hp).toBeLessThan(100);
    expect(huge.hp).toBe(100 - PHYS.maxFallDamage);
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
    world.explode(410, GROUND, roundBlast(40, 40, 48, 1));

    expect(world.terrain.isSolid(410, GROUND + 10)).toBe(false);
    expect(near.hp).toBeLessThan(100);
    expect(near.knocked).toBe(true);
    expect(near.vx).toBeLessThan(0); // thrown away from the blast
    expect(far.hp).toBe(100);

    run(world, 60 * 6);
    expect(near.grounded).toBe(true); // eventually settles
  });
});

describe('Image maps', () => {
  it('turns dark pixels into air and colored ones into ground, keeping two materials', () => {
    // 4x1 RGBA image: black, pink, cyan, near-black.
    const rgba = [0, 0, 0, 255, 220, 120, 250, 255, 150, 235, 250, 255, 30, 30, 30, 255];
    const { terrain } = mapFromImage(rgba, 4, 1);
    expect([...terrain.mask]).toEqual([0, 1, 2, 0]);
    expect(terrain.isSolid(2, 0)).toBe(true);
  });

  it('scales the image', () => {
    const rgba = [255, 255, 255, 255, 0, 0, 0, 255];
    const { terrain } = mapFromImage(rgba, 2, 1, 2);
    expect(terrain.width).toBe(4);
    expect([...terrain.mask]).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('counts as a cave when ground covers most of the top edge', () => {
    const W = [255, 255, 255, 255];
    const B = [0, 0, 0, 255];
    // 3x2 images: the top row is the roof (or not); the bottom row doesn't matter.
    expect(mapFromImage([...W, ...W, ...B, ...B, ...B, ...B], 3, 2).enclosed).toBe(true);
    expect(mapFromImage([...W, ...B, ...B, ...W, ...W, ...W], 3, 2).enclosed).toBe(false);
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

  it('squeezes worms closer together when there is no room to spread them out', () => {
    const world = flatWorld(); // 800 px of ground: room for 9 worms at the usual spacing
    const spots = findSpawnPoints(world.terrain, 1000, 16, R, mulberry32(2));
    expect(spots).toHaveLength(16);
    for (const a of spots) {
      for (const b of spots) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * R);
    }
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
