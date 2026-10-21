import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { generateMap } from './mapgen';
import { mulberry32 } from './rng';
import { createMatch, DEFAULT_SETTINGS, Match, type MatchEvent, type MatchSettings } from './match';
import { Terrain } from './terrain';
import { roundBlast } from './weapons';
import { NO_INPUT, type WormInput } from './worm';
import { World } from './world';

const GROUND = 500;
const restingY = GROUND - PHYS.wormRadius - 0.5;

/**
 * Flat ground, two teams of `perTeam` worms spread far apart (out of each other's blast
 * range), quick turns and no sudden death unless overridden.
 */
function setup(perTeam = 2, overrides: Partial<MatchSettings> = {}): Match {
  const terrain = new Terrain(2000, 600);
  for (let y = GROUND; y < 600; y++) for (let x = 0; x < 2000; x++) terrain.mask[y * 2000 + x] = 1;
  const world = new World(terrain, 5000);
  for (let i = 0; i < perTeam; i++) {
    world.addWorm(`A${i + 1}`, 0, 200 + i * 400, restingY);
    world.addWorm(`B${i + 1}`, 1, 400 + i * 400, restingY);
  }
  const settings = { ...DEFAULT_SETTINGS, turnTime: 1, retreatTime: 1, suddenDeathAfter: 0, ...overrides };
  return started(new Match(world, settings));
}

/** Lets the worms land, then starts the first turn (and drops its start event). */
function started(match: Match): Match {
  for (let i = 0; i < 10; i++) match.world.step(NO_INPUT);
  match.world.drainEvents();
  match.start();
  match.drainEvents();
  return match;
}

function run(match: Match, ticks: number, input: Partial<WormInput> = {}): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    match.step({ ...NO_INPUT, ...input });
    events.push(...match.drainEvents());
  }
  return events;
}

/** Steps until the next turn starts (or the match ends), returning everything that happened. */
function untilNextTurn(match: Match, limit = 60 * 60): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 0; i < limit; i++) {
    const tick = run(match, 1);
    events.push(...tick);
    if (tick.some((e) => e.type === 'turnStart' || e.type === 'gameOver')) break;
  }
  return events;
}

const activeName = (match: Match) => match.world.worms[match.world.activeWormId].name;

describe('Turns', () => {
  it('alternate between teams, cycling through each team\'s worms', () => {
    const match = setup(2);
    const order = [activeName(match)];
    for (let i = 0; i < 4; i++) {
      untilNextTurn(match);
      order.push(activeName(match));
    }
    expect(order).toEqual(['A1', 'B1', 'A2', 'B2', 'A1']);
  });

  it('end when the timer runs out', () => {
    const match = setup(1, { turnTime: 2 });
    run(match, 2 * 60 - 1);
    expect(match.phase).toBe('playing');
    run(match, 1);
    expect(match.phase).toBe('settling');
  });

  it('skip worms that have died', () => {
    const match = setup(2);
    const a2 = match.world.worms.find((w) => w.name === 'A2')!;
    a2.hp = 0;
    a2.alive = false;
    untilNextTurn(match); // B1
    untilNextTurn(match);
    expect(activeName(match)).toBe('A1');
  });

  it('change the wind each turn, not each shot', () => {
    const match = setup(1, { turnTime: 5 });
    const worm = match.activeWorm!;
    worm.weapon = 'bazooka';
    const wind = match.world.wind;
    run(match, 1, { fire: true, fireHeld: true });
    run(match, 1);
    expect(match.world.projectiles.some((p) => p.kind === 'shell')).toBe(true);
    expect(match.world.wind).toBe(wind);
  });
});

describe('Retreat time', () => {
  it('starts when a weapon is used, and weapons stay locked during it', () => {
    const match = setup(1, { turnTime: 30, retreatTime: 2 });
    const worm = match.activeWorm!;
    worm.weapon = 'mine';
    run(match, 1, { fire: true });
    expect(match.phase).toBe('retreat');
    run(match, 10);
    run(match, 1, { fire: true }); // a second mine isn't allowed
    expect(match.world.projectiles.filter((p) => p.kind === 'mine')).toHaveLength(1);
    run(match, 10, { left: true }); // but walking away is
    expect(worm.x).toBeLessThan(200);
    run(match, 2 * 60);
    expect(match.phase).toBe('settling');
  });

  it("doesn't start for the ninja rope", () => {
    const match = setup(1, { turnTime: 30 });
    match.activeWorm!.aim = Math.PI / 2;
    run(match, 1, { fire: true });
    expect(match.activeWorm!.rope).not.toBeNull();
    expect(match.phase).toBe('playing');
  });
});

describe('Ending a turn', () => {
  it('happens at once when the active worm gets hurt', () => {
    const match = setup(1, { turnTime: 30 });
    const worm = match.activeWorm!;
    match.world.explode(worm.x + 20, worm.y, roundBlast(10, 10, 30, 1));
    run(match, 1);
    expect(match.phase).toBe('settling');
  });

  it('waits for a grenade to go off before the next turn', () => {
    const match = setup(1, { turnTime: 30, retreatTime: 1 });
    const worm = match.activeWorm!;
    worm.weapon = 'grenade';
    worm.fuse = 5;
    worm.facing = -1; // away from the other team
    run(match, 1, { fire: true, fireHeld: true });
    run(match, 20, { fireHeld: true });
    run(match, 1);
    const events = untilNextTurn(match);
    const boom = events.findIndex((e) => e.type === 'explosion');
    const next = events.findIndex((e) => e.type === 'turnStart');
    expect(boom).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThan(boom);
  });

  it('lets go of the rope so the worm falls before the next turn', () => {
    const terrain = new Terrain(1000, 800);
    for (let y = 0; y < 150; y++) for (let x = 0; x < 1000; x++) terrain.mask[y * 1000 + x] = 1; // ceiling
    for (let y = GROUND; y < 800; y++) for (let x = 0; x < 1000; x++) terrain.mask[y * 1000 + x] = 1; // floor
    const world = new World(terrain, 5000);
    world.addWorm('A1', 0, 300, restingY);
    world.addWorm('B1', 1, 800, restingY);
    const match = started(new Match(world, { ...DEFAULT_SETTINGS, turnTime: 2, suddenDeathAfter: 0 }));
    const worm = match.activeWorm!;
    worm.aim = Math.PI / 2;
    run(match, 1, { fire: true });
    run(match, 30, { up: true }); // hanging well above the floor
    expect(worm.rope?.phase).toBe('attached');
    untilNextTurn(match);
    expect(worm.rope).toBeNull();
    expect(worm.grounded).toBe(true);
  });
});

describe('Winning', () => {
  it('is over when only one team has worms left', () => {
    const match = setup(1, { turnTime: 30 });
    const b1 = match.world.worms.find((w) => w.name === 'B1')!;
    match.world.explode(b1.x, b1.y, roundBlast(20, 500, 30, 1));
    const events = untilNextTurn(match);
    expect(events).toContainEqual({ type: 'gameOver', winner: 0 });
    expect(match.phase).toBe('over');
  });

  it('ends straight away when the last enemy dies mid-turn', () => {
    const match = setup(1, { turnTime: 30 });
    const b1 = match.world.worms.find((w) => w.name === 'B1')!;
    match.world.explode(b1.x, b1.y, roundBlast(20, 500, 30, 1));
    run(match, 1);
    expect(match.phase).toBe('settling'); // not waiting out A1's remaining 29 seconds
  });

  it('is a draw when nobody is left', () => {
    const match = setup(1, { turnTime: 30 });
    for (const w of match.world.worms) {
      match.world.explode(w.x, w.y, roundBlast(20, 500, 30, 1));
    }
    const events = untilNextTurn(match);
    expect(events).toContainEqual({ type: 'gameOver', winner: null });
  });
});

describe('Sudden death', () => {
  it('starts after the set time, then the water rises every turn', () => {
    const match = setup(1, { suddenDeathAfter: 1 / 60 }); // one second
    const start = match.world.waterLevel;
    const first = untilNextTurn(match);
    expect(first).toContainEqual({ type: 'suddenDeath' });
    expect(match.world.waterLevel).toBe(start);
    untilNextTurn(match);
    expect(match.world.waterLevel).toBe(start - match.settings.waterRise);
  });

  it('drowns worms the water reaches before the next turn', () => {
    const match = setup(1, { suddenDeathAfter: 1 / 60, waterRise: 100 });
    match.world.waterLevel = GROUND + 40; // the next rise covers the worms
    untilNextTurn(match);
    const events = untilNextTurn(match);
    expect(events.filter((e) => e.type === 'death')).toHaveLength(2);
    expect(events).toContainEqual({ type: 'gameOver', winner: null });
  });
});

describe('Settling', () => {
  it('mines thrown anywhere come to rest, so turns change quickly', () => {
    // Mines used to get wedged on steep pixel slopes, "moving" without going anywhere,
    // which made every turn wait for the settle time-out.
    for (const preset of ['two-islands', 'one-island', 'cavern'] as const) {
      const match = createMatch(generateMap(preset, 960801), 960801, { ...DEFAULT_SETTINGS, wormsPerTeam: 1 });
      const { world } = match;
      const rng = mulberry32(7);
      for (let i = 0; i < 150; i++) {
        const x = 50 + rng() * (world.terrain.width - 100);
        const y = 50 + rng() * (world.waterLevel - 100);
        if (!world.terrain.discFree(x, y, 3)) continue;
        world.spawn({ kind: 'mine', x, y, vx: (rng() - 0.5) * 400, vy: (rng() - 0.5) * 400, armed: true });
      }
      for (const w of world.worms) w.alive = false; // nobody to set them off
      for (let i = 0; i < 20 * 60; i++) world.step(NO_INPUT);
      const restless = world.projectiles.filter((p) => !p.resting);
      expect(restless.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy)])).toEqual([]);
    }
  });
});

describe('Saving and restoring (online hand-over)', () => {
  it('a restored match carries on exactly like the original', () => {
    const settings = { ...DEFAULT_SETTINGS, wormsPerTeam: 2 };
    const original = createMatch(generateMap('one-island', 99), 99, settings);
    original.start();
    const keys: Partial<WormInput>[] = [
      ...Array(20).fill({}),
      { right: true },
      ...Array(15).fill({ right: true, up: true }),
      { select: 'bazooka' },
      { fire: true, fireHeld: true },
      ...Array(30).fill({ fireHeld: true }),
      {},
    ];
    for (const k of keys) original.step({ ...NO_INPUT, ...k });
    expect(original.world.projectiles.some((p) => p.kind === 'shell')).toBe(true); // mid-flight

    // Sent over the network as JSON, then loaded into a match built from the same map.
    const copy = createMatch(generateMap('one-island', 99), 99, settings);
    copy.restore(JSON.parse(JSON.stringify(original.snapshot())));
    for (let i = 0; i < 400; i++) {
      original.step(NO_INPUT);
      copy.step(NO_INPUT);
    }
    expect(copy.snapshot()).toEqual(original.snapshot());
    expect(copy.world.terrain.hash()).toBe(original.world.terrain.hash()); // same crater
  });

  it('keeps "no time limit" through JSON', () => {
    const match = setup(1, { turnTime: 0 });
    const copy = setup(1, { turnTime: 0 });
    copy.restore(JSON.parse(JSON.stringify(match.snapshot())));
    expect(copy.ticksLeft).toBe(Infinity);
  });

  it('fingerprints the terrain so players can check they built the same map', () => {
    const a = generateMap('two-islands', 5).terrain;
    const b = generateMap('two-islands', 5).terrain;
    expect(a.hash()).toBe(b.hash());
    const ground = b.mask.indexOf(1);
    b.carve(ground % b.width, Math.floor(ground / b.width) + 10, 20);
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe('Worms at 0 HP', () => {
  it('stay until the turn ends, then blow up and can hurt worms nearby', () => {
    const match = setup(1, { turnTime: 30 });
    const b1 = match.world.worms.find((w) => w.name === 'B1')!;
    const b2 = match.world.addWorm('B2', 1, b1.x + 15, restingY);
    run(match, 10);
    b1.hp = 0;
    run(match, 30);
    expect(b1.alive).toBe(true); // still standing during the turn
    match.forceEndTurn();
    const events = untilNextTurn(match);
    expect(events).toContainEqual({ type: 'death', wormId: b1.id, cause: 'killed' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'explosion', x: b1.x }));
    expect(b2.hp).toBeLessThan(100);
    expect(events.some((e) => e.type === 'turnStart')).toBe(true);
  });

  it('count as out: bringing the last enemy to 0 HP wins the match', () => {
    const match = setup(1, { turnTime: 30 });
    const b1 = match.world.worms.find((w) => w.name === 'B1')!;
    match.world.explode(b1.x, b1.y, roundBlast(10, 500, 30, 0));
    const events = untilNextTurn(match);
    expect(events).toContainEqual({ type: 'gameOver', winner: 0 });
  });
});

describe('Ammo and delays', () => {
  it('limited weapons are used up', () => {
    const match = setup(1, { turnTime: 30 });
    const team = match.turnTeam;
    expect(match.weaponStatus(team, 'mine')).toEqual({ ammo: 3, wait: 0 });
    run(match, 1, { select: 'mine' });
    run(match, 1, { fire: true });
    expect(match.world.projectiles).toMatchObject([{ kind: 'mine' }]);
    expect(match.weaponStatus(team, 'mine').ammo).toBe(2);
    expect(match.weaponStatus(team, 'bazooka').ammo).toBeNull(); // unlimited
  });

  it("can't pick or fire a weapon that's used up", () => {
    const match = setup(1, { turnTime: 30 });
    const state = match.snapshot();
    state.ammo[match.turnTeam].mine = 0;
    match.restore(state);
    const worm = match.activeWorm!;
    run(match, 1, { select: 'mine' });
    expect(worm.weapon).not.toBe('mine');
    worm.weapon = 'mine'; // even if it's still in hand
    run(match, 1, { fire: true });
    expect(match.world.projectiles).toHaveLength(0);
    expect(match.phase).toBe('playing');
  });

  it("delayed weapons unlock once the team has had enough turns", () => {
    const match = setup(1, { turnTime: 1 });
    const team = match.turnTeam;
    expect(match.weaponStatus(team, 'airstrike').wait).toBe(2);
    run(match, 1, { select: 'airstrike' });
    expect(match.activeWorm!.weapon).not.toBe('airstrike');
    untilNextTurn(match);
    untilNextTurn(match); // the team's second turn
    expect(match.weaponStatus(team, 'airstrike').wait).toBe(1);
    untilNextTurn(match);
    untilNextTurn(match); // third
    expect(match.weaponStatus(team, 'airstrike').wait).toBe(0);
    run(match, 1, { select: 'airstrike' });
    expect(match.activeWorm!.weapon).toBe('airstrike');
  });

  it('the unlimited set has everything from the first turn', () => {
    const match = setup(1, { scheme: 'unlimited' });
    expect(match.weaponStatus(0, 'oldWoman')).toEqual({ ammo: null, wait: 0 });
    expect(match.weaponStatus(1, 'banana')).toEqual({ ammo: null, wait: 0 });
  });
});
