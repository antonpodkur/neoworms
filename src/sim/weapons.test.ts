import { afterEach, describe, expect, it } from 'vitest';
import { PHYS, resetPhys } from './constants';
import { attachRope } from './rope';
import { Terrain } from './terrain';
import { NO_INPUT, type Worm, type WormInput } from './worm';
import { World, type SimEvent } from './world';

const GROUND = 500;
const restingY = (top: number) => top - PHYS.wormRadius - 0.5;

/** 1200x600 with flat ground from y=GROUND down and water far below. */
function groundWorld(): World {
  const terrain = new Terrain(1200, 600);
  for (let y = GROUND; y < 600; y++) for (let x = 0; x < 1200; x++) terrain.mask[y * 1200 + x] = 1;
  return new World(terrain, 5000);
}

/** A worm standing on the ground, settled, holding `weapon`. */
function standingWorm(world: World, x: number, weapon: Worm['weapon']): Worm {
  const worm = world.addWorm(`W${x}`, 0, x, restingY(GROUND));
  worm.weapon = weapon;
  run(world, 5);
  return worm;
}

function run(world: World, ticks: number, input: Partial<WormInput> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    world.step({ ...NO_INPUT, ...input });
    events.push(...world.drainEvents());
  }
  return events;
}

/** Steps until an explosion happens (or the limit), returning the explosion and ticks taken. */
function untilExplosion(world: World, limit = 600) {
  for (let t = 1; t <= limit; t++) {
    const boom = run(world, 1).find((e) => e.type === 'explosion');
    if (boom) return { ...(boom as Extract<SimEvent, { type: 'explosion' }>), ticks: t };
  }
  return null;
}

/** Holds Space for `ticks` ticks then lets go. */
function chargeAndFire(world: World, ticks: number): void {
  run(world, 1, { fire: true, fireHeld: true });
  run(world, ticks - 1, { fireHeld: true });
  run(world, 1);
}

afterEach(resetPhys);

describe('Charging and firing', () => {
  it('charges while Space is held and fires on release', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'bazooka');
    run(world, 1, { fire: true, fireHeld: true });
    run(world, 30, { fireHeld: true });
    expect(worm.charge).toBeCloseTo(30 / (PHYS.chargeTime * 60), 2);
    expect(world.projectiles).toHaveLength(0);
    run(world, 1);
    expect(worm.charge).toBeNull();
    expect(world.projectiles).toHaveLength(1);
    const shell = world.projectiles[0];
    expect(Math.hypot(shell.vx, shell.vy)).toBeCloseTo(PHYS.bazookaSpeed * (31 / (PHYS.chargeTime * 60)), -1);
  });

  it('fires by itself at full power', () => {
    const world = groundWorld();
    standingWorm(world, 200, 'bazooka');
    run(world, 1, { fire: true, fireHeld: true });
    run(world, PHYS.chargeTime * 60 + 5, { fireHeld: true });
    expect(world.projectiles).toHaveLength(1);
    expect(Math.hypot(world.projectiles[0].vx, world.projectiles[0].vy)).toBeGreaterThan(PHYS.bazookaSpeed * 0.95);
  });

  it('stands still while charging', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'bazooka');
    run(world, 1, { fire: true, fireHeld: true });
    run(world, 30, { fireHeld: true, right: true });
    expect(worm.x).toBe(200);
  });

  it('only fires weapons from solid ground', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'bazooka');
    worm.y -= 100;
    worm.grounded = false;
    run(world, 1, { fire: true, fireHeld: true });
    expect(worm.charge).toBeNull();
  });
});

describe('Bazooka', () => {
  it('explodes where it hits and hurts worms nearby', () => {
    const world = groundWorld();
    for (let y = 0; y < GROUND; y++) for (let x = 500; x < 520; x++) world.terrain.mask[y * 1200 + x] = 1; // a wall
    const shooter = standingWorm(world, 200, 'bazooka');
    shooter.aim = 0.15; // a little upward, so the shot doesn't graze the floor
    const target = world.addWorm('T', 1, 488, restingY(GROUND));
    chargeAndFire(world, 80);
    world.wind = 0;
    const boom = untilExplosion(world)!;
    expect(boom.x).toBeGreaterThan(470);
    expect(target.hp).toBeLessThan(100);
    expect(world.projectiles).toHaveLength(0);
  });

  it('is pushed by the wind', () => {
    const landing = (wind: number) => {
      const world = groundWorld();
      const worm = standingWorm(world, 600, 'bazooka');
      worm.aim = Math.PI / 2; // straight up
      chargeAndFire(world, 36);
      world.wind = wind;
      return untilExplosion(world)!.x;
    };
    expect(landing(1)).toBeGreaterThan(700);
    expect(landing(-1)).toBeLessThan(500);
  });
});

describe('Grenade', () => {
  it('cycles its fuse with Tab', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'grenade');
    expect(worm.fuse).toBe(3);
    run(world, 1, { toggle: true });
    run(world, 1, { toggle: true });
    expect(worm.fuse).toBe(5);
    run(world, 1, { toggle: true });
    expect(worm.fuse).toBe(1);
  });

  it('bounces around and explodes when its fuse runs out', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'grenade');
    worm.fuse = 2;
    worm.aim = Math.PI / 4;
    chargeAndFire(world, 40);
    const boom = untilExplosion(world)!;
    expect(boom.ticks).toBeGreaterThan(2 * 60 - 3);
    expect(boom.ticks).toBeLessThan(2 * 60 + 3);
    expect(boom.x).toBeGreaterThan(260); // thrown forward
  });
});

describe('Mines', () => {
  it('can be placed with Space', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'mine');
    run(world, 1, { fire: true });
    expect(world.projectiles).toMatchObject([{ kind: 'mine' }]);
    expect(world.projectiles[0].x).toBeGreaterThan(worm.x);
  });

  it('arm, wait for a worm to come close, then explode', () => {
    PHYS.mineDudChance = 0;
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'rope');
    world.spawn({ kind: 'mine', x: 200 + PHYS.mineTriggerRadius - 6, y: restingY(GROUND), vx: 0, vy: 0 });
    const early = run(world, PHYS.mineArmTime * 60 - 5);
    expect(early.some((e) => e.type === 'mineTriggered')).toBe(false);
    const armed = run(world, 10);
    expect(armed.some((e) => e.type === 'mineTriggered')).toBe(true);
    const boom = untilExplosion(world)!;
    expect(boom.ticks).toBeLessThanOrEqual(PHYS.mineFuse * 60);
    expect(worm.hp).toBeLessThan(100);
  });

  it('sometimes fizzle out as duds', () => {
    PHYS.mineDudChance = 1;
    const world = groundWorld();
    standingWorm(world, 200, 'rope');
    world.spawn({ kind: 'mine', x: 210, y: restingY(GROUND), vx: 0, vy: 0, armed: true });
    const events = run(world, 120);
    expect(events.some((e) => e.type === 'dud')).toBe(true);
    expect(events.some((e) => e.type === 'explosion')).toBe(false);
    expect(world.projectiles).toHaveLength(1);
  });

  it('are set off by nearby explosions (chain reaction)', () => {
    PHYS.mineDudChance = 0;
    const world = groundWorld();
    standingWorm(world, 1000, 'rope'); // far away, so only the blast can set them off
    world.spawn({ kind: 'mine', x: 300, y: restingY(GROUND), vx: 0, vy: 0, armed: true });
    world.spawn({ kind: 'mine', x: 330, y: restingY(GROUND), vx: 0, vy: 0, armed: true });
    run(world, 30);
    world.explode(290, GROUND, { radius: 15, damage: 10, reach: 30, push: 1 });
    const events = run(world, 120);
    expect(events.filter((e) => e.type === 'explosion')).toHaveLength(3); // the first blast, then both mines
  });
});

describe('Weapons on the rope', () => {
  /** A worm hanging from a ceiling, holding `weapon`. */
  function hanging(weapon: Worm['weapon']) {
    const terrain = new Terrain(1000, 800);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 1000; x++) terrain.mask[y * 1000 + x] = 1;
    const world = new World(terrain, 5000);
    const worm = world.addWorm('A', 0, 500, 250);
    attachRope(worm, 500, 100);
    run(world, 1, { select: weapon });
    return { world, worm };
  }

  it('Enter drops the selected grenade and the rope stays on', () => {
    const { world, worm } = hanging('grenade');
    run(world, 1, { jump: true });
    expect(world.projectiles).toMatchObject([{ kind: 'grenade' }]);
    expect(worm.rope?.phase).toBe('attached');
  });

  it('Enter does nothing with a weapon that can\'t be dropped', () => {
    const { world, worm } = hanging('bazooka');
    run(world, 1, { jump: true });
    expect(world.projectiles).toHaveLength(0);
    expect(worm.rope?.phase).toBe('attached');
  });

  it('after letting go, Space shoots the rope again whatever is selected', () => {
    const { world, worm } = hanging('grenade');
    run(world, 1, { fire: true });
    expect(worm.rope).toBeNull();
    expect(worm.ropeChain).toBe(true);
    run(world, 1, { fire: true });
    expect(worm.rope?.phase).toBe('shooting');
    expect(world.projectiles).toHaveLength(0);
  });
});
