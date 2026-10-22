import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { attachRope, ropeLength, type AttachedRope } from './rope';
import { Terrain } from './terrain';
import { roundBlast } from './weapons';
import { NO_INPUT, type Worm, type WormInput } from './worm';
import { World } from './world';

const ANCHOR = { x: 500, y: 100 };

/** 1000x800 of open air with a solid ceiling above y=ANCHOR.y, water far below. */
function openWorld(): World {
  const terrain = new Terrain(1000, 800);
  for (let y = 0; y < ANCHOR.y; y++) for (let x = 0; x < 1000; x++) terrain.mask[y * 1000 + x] = 1;
  return new World(terrain, 5000);
}

/** A worm hanging from ANCHOR on a rope of `length`, `degrees` off straight down (+ = right). */
function hangingWorm(world: World, length: number, degrees: number): Worm {
  const a = (degrees * Math.PI) / 180;
  const worm = world.addWorm('A', 0, ANCHOR.x + Math.sin(a) * length, ANCHOR.y + Math.cos(a) * length);
  attachRope(worm, ANCHOR.x, ANCHOR.y);
  return worm;
}

const rope = (worm: Worm) => worm.rope as AttachedRope;
/** Ticks for a pendulum of this length to swing across and back up (with a margin for wide swings). */
const halfSwingTicks = (length: number) => Math.ceil(Math.PI * Math.sqrt(length / PHYS.ropeGravity) * 1.15 * 60);
const angleOf = (worm: Worm) => (Math.atan2(worm.x - ANCHOR.x, worm.y - ANCHOR.y) * 180) / Math.PI;

function run(world: World, ticks: number, input: Partial<WormInput> = {}): void {
  for (let i = 0; i < ticks; i++) world.step({ ...NO_INPUT, ...input });
}

describe('Ninja rope', () => {
  it('shoots up, hooks into the ceiling and holds the worm', () => {
    const world = openWorld();
    const worm = world.addWorm('A', 0, 500, 300);
    worm.aim = Math.PI / 2;
    run(world, 1, { fire: true });
    run(world, 10);
    expect(worm.rope?.phase).toBe('attached');
    const anchor = rope(worm).pivots[0];
    expect(anchor.x).toBeCloseTo(500, 0);
    expect(anchor.y).toBeGreaterThanOrEqual(ANCHOR.y); // first open pixel row under the ceiling
    expect(anchor.y).toBeLessThan(ANCHOR.y + 1);
    run(world, 120);
    expect(worm.y).toBeLessThan(ANCHOR.y + rope(worm).length + 1); // hanging, not falling
  });

  it('hops the worm off the ground when it hooks in while standing', () => {
    const world = openWorld();
    for (let y = 400; y < 450; y++) for (let x = 0; x < 1000; x++) world.terrain.mask[y * 1000 + x] = 1;
    const worm = world.addWorm('A', 0, 500, 400 - PHYS.wormRadius - 0.5);
    run(world, 10);
    expect(worm.grounded).toBe(true);
    worm.aim = Math.PI / 2;
    run(world, 1, { fire: true });
    for (let t = 0; t < 60 && worm.rope?.phase !== 'attached'; t++) run(world, 1); // hook flying up
    expect(worm.rope?.phase).toBe('attached');
    run(world, 8);
    expect(worm.y).toBeLessThan(400 - PHYS.wormRadius - 10);
  });

  it('misses when the ceiling is out of reach', () => {
    const world = openWorld();
    const worm = world.addWorm('A', 0, 500, ANCHOR.y + PHYS.ropeMaxLength + 100);
    worm.aim = Math.PI / 2;
    run(world, 1, { fire: true });
    run(world, 30);
    expect(worm.rope).toBeNull();
  });

  it('swings like a pendulum without gaining or losing much height', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, -60);
    let maxAngle = -90;
    for (let i = 0; i < halfSwingTicks(150); i++) {
      run(world, 1);
      maxAngle = Math.max(maxAngle, angleOf(worm));
    }
    expect(maxAngle).toBeGreaterThan(56);
    expect(maxAngle).toBeLessThan(64);
    expect(rope(worm).length).toBeCloseTo(150, 5);
  });

  it('builds up a swing when the player pushes', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, 0);
    run(world, 60, { right: true });
    expect(angleOf(worm)).toBeGreaterThan(10);
  });

  it('climbs and descends within the rope limits', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, 0);
    run(world, 30, { up: true });
    expect(rope(worm).length).toBeCloseTo(150 - PHYS.ropeReelInSpeed * 0.5, 0);
    expect(worm.y).toBeCloseTo(ANCHOR.y + rope(worm).length, 0);
    run(world, 300, { up: true });
    expect(rope(worm).length).toBe(PHYS.ropeMinLength);
    run(world, 600, { down: true });
    expect(ropeLength(rope(worm))).toBeCloseTo(PHYS.ropeMaxLength, 5);
  });

  it('bends around a corner and straightens when swinging back', () => {
    const world = openWorld();
    world.terrain.fillCircle(520, 200, 4, true); // a peg the rope catches on
    const worm = hangingWorm(world, 200, -60);
    let maxPivots = 1;
    let leftmost = Infinity;
    for (let i = 0; i < halfSwingTicks(200) * 2.5; i++) {
      run(world, 1);
      maxPivots = Math.max(maxPivots, rope(worm).pivots.length);
      if (worm.vx > 0 && rope(worm).pivots.length === 1) leftmost = Math.min(leftmost, worm.x);
    }
    expect(maxPivots).toBeGreaterThan(1);
    // Back on the left, swinging right again, the rope runs straight from the anchor once more.
    expect(leftmost).toBeLessThan(ANCHOR.x - 100);
    const firstPivot = rope(worm).pivots[0];
    expect(firstPivot).toMatchObject({ x: ANCHOR.x, y: ANCHOR.y });
  });

  it('goes slack above the anchor and falls back down', () => {
    const world = openWorld();
    const worm = world.addWorm('A', 0, 500.5, 300);
    attachRope(worm, 500, 400);
    run(world, 15);
    expect(Math.hypot(worm.x - 500, worm.y - 400)).toBeLessThan(95);
  });

  it('lets go with the swing speed intact', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, -60);
    while (angleOf(worm) < 0) run(world, 1); // swing down to the bottom, where it's fastest
    const speed = worm.vx;
    expect(speed).toBeGreaterThan(0.9 * Math.sqrt(2 * PHYS.ropeGravity * 75)); // fell 75px
    run(world, 1, { fire: true });
    expect(worm.rope).toBeNull();
    expect(worm.vx).toBeGreaterThan(speed * 0.8);
  });

  it('is knocked off by explosions', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, 0);
    world.explode(worm.x + 10, worm.y, roundBlast(30, 10, 38, 1));
    expect(worm.rope).toBeNull();
  });
});

describe('Rope aim (as in WR)', () => {
  it('standing, it only aims at the upper half', () => {
    const world = openWorld();
    for (let x = 0; x < 1000; x++) for (let y = 600; y < 800; y++) world.terrain.mask[y * 1000 + x] = 1;
    const worm = world.addWorm('A', 0, 300, 600 - PHYS.wormRadius - 0.5);
    run(world, 5);
    worm.aim = 0.3;
    run(world, 120, { down: true });
    expect(worm.aim).toBe(0);
    worm.weapon = 'bazooka';
    run(world, 30, { down: true });
    expect(worm.aim).toBeLessThan(0);
  });

  it('after letting go, picks one of three directions: up-left, up-right or straight up', () => {
    const world = openWorld();
    const worm = hangingWorm(world, 150, 30);
    run(world, 1, { fire: true }); // let go
    expect(worm.ropeChain).toBe(true);
    expect(worm.aim).toBeCloseTo(Math.PI / 4);
    run(world, 1, { left: true });
    expect(worm.facing).toBe(-1);
    expect(worm.aim).toBeCloseTo(Math.PI / 4);
    run(world, 1, { up: true });
    expect(worm.aim).toBeCloseTo(Math.PI / 2);
    run(world, 1, { right: true });
    run(world, 1, { fire: true });
    const shot = worm.rope as Extract<Worm['rope'], { phase: 'shooting' }>;
    expect(shot.dirX).toBeCloseTo(Math.SQRT1_2);
    expect(shot.dirY).toBeCloseTo(-Math.SQRT1_2);
  });
});
