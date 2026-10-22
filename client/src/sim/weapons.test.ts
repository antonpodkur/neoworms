import { afterEach, describe, expect, it } from 'vitest';
import { PHYS, resetPhys } from './constants';
import { attachRope } from './rope';
import { Terrain } from './terrain';
import { AIRSTRIKE, BLASTS, MELEE, PANEL, QUICK_SELECT, roundBlast, WEAPON_ORDER } from './weapons';
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
  it('takes a fuse from the number keys', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'grenade');
    run(world, 1, { fuse: 5 });
    expect(worm.fuse).toBe(5);
    run(world, 1, { fuse: 1 });
    expect(worm.fuse).toBe(1);
  });

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
    expect(boom.ticks).toBeLessThanOrEqual(PHYS.mineFuseMax * 60);
    expect(worm.hp).toBeLessThan(100);
  });

  it('sometimes fizzle out as duds', () => {
    PHYS.mineDudChance = 1;
    const world = groundWorld();
    standingWorm(world, 200, 'rope');
    world.spawn({ kind: 'mine', x: 210, y: restingY(GROUND), vx: 0, vy: 0, armed: true });
    const events = run(world, (PHYS.mineFuseMax + 0.5) * 60); // past the longest fuse
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
    world.explode(290, GROUND, roundBlast(15, 10, 30, 1));
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

  it('AltFire (Enter) drops the selected grenade and the rope stays on', () => {
    const { world, worm } = hanging('grenade');
    run(world, 1, { altFire: true });
    expect(world.projectiles).toMatchObject([{ kind: 'grenade' }]);
    expect(worm.rope?.phase).toBe('attached');
  });

  it('AltFire does nothing with a weapon that can\'t be dropped', () => {
    const { world, worm } = hanging('bazooka');
    run(world, 1, { altFire: true });
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

describe('Explosions (Worms Revolution table)', () => {
  it('hurt at full strength near the centre and fade to the min at the edge', () => {
    const world = groundWorld();
    const near = world.addWorm('N', 0, 300, restingY(GROUND));
    const far = world.addWorm('F', 0, 700, restingY(GROUND));
    run(world, 5);
    const blast = BLASTS.bazooka;
    world.explode(near.x, near.y, blast);
    world.explode(far.x - (blast.damageRange[1] - 1), far.y, blast);
    expect(near.hp).toBe(100 - blast.damage[1]);
    expect(far.hp).toBeLessThan(100);
    expect(far.hp).toBeGreaterThanOrEqual(100 - 3);
  });

  it('throw worms steeply upwards even from the side', () => {
    const world = groundWorld();
    const worm = world.addWorm('S', 0, 300, restingY(GROUND));
    run(world, 5);
    world.explode(worm.x - 20, worm.y + 2, BLASTS.bazooka); // beside it, almost level
    const angle = (Math.atan2(-worm.vy, Math.abs(worm.vx)) * 180) / Math.PI;
    expect(worm.vx).toBeGreaterThan(0); // away from the blast
    expect(angle).toBeGreaterThanOrEqual(PHYS.blastMinAngle);
  });

  it('throw a worm hit dead-on the way the shell was going', () => {
    const world = groundWorld();
    const worm = world.addWorm('S', 0, 300, restingY(GROUND));
    run(world, 5);
    world.explode(worm.x, worm.y - 9, BLASTS.bazooka, -1); // came down on its head, heading left
    const angle = (Math.atan2(-worm.vy, Math.abs(worm.vx)) * 180) / Math.PI;
    expect(worm.vx).toBeLessThan(0);
    expect(angle).toBeGreaterThanOrEqual(PHYS.blastMinAngle);
  });

  it('push less when they go off under water', () => {
    const pushAt = (waterLevel: number) => {
      const world = new World(new Terrain(400, 400), waterLevel);
      world.spawn({ kind: 'grenade', x: 200, y: 200, vx: 0, vy: 0, fuse: 5 });
      world.explode(180, 210, BLASTS.bazooka);
      return world.projectiles[0].vx;
    };
    expect(pushAt(205)).toBeCloseTo(pushAt(5000) * BLASTS.bazooka.waterPush, 5);
  });
});

describe('Dynamite', () => {
  it('is set down in front of the worm and goes off after 5 seconds', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'dynamite');
    run(world, 1, { fire: true });
    expect(world.projectiles).toMatchObject([{ kind: 'dynamite' }]);
    expect(world.projectiles[0].x).toBeGreaterThan(worm.x);
    const boom = untilExplosion(world)!;
    expect(boom.ticks).toBeGreaterThan(5 * 60 - 3);
    expect(boom.ticks).toBeLessThan(5 * 60 + 3);
    expect(boom.r).toBe(BLASTS.dynamite.radius);
  });
});

describe('Old Woman', () => {
  it('walks off, turns around at a wall and blows up after 5 seconds', () => {
    const world = groundWorld();
    for (let y = 0; y < GROUND; y++) for (let x = 300; x < 310; x++) world.terrain.mask[y * 1200 + x] = 1; // a wall
    standingWorm(world, 200, 'oldWoman');
    run(world, 1, { fire: true });
    const lady = world.projectiles[0];
    expect(lady.kind).toBe('oldWoman');
    run(world, 60);
    expect(lady.x).toBeGreaterThan(215);
    run(world, 3 * 60);
    expect(lady.dir).toBe(-1);
    const boom = untilExplosion(world)!;
    expect(boom.r).toBe(BLASTS.oldWoman.radius);
  });
});

describe('Cluster and banana bombs', () => {
  it.each([
    ['cluster', 'fragment'],
    ['banana', 'bomblet'],
  ] as const)('the %s breaks into five %ss that explode where they land', (weapon, piece) => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, weapon);
    worm.fuse = 1;
    worm.aim = Math.PI / 4;
    chargeAndFire(world, 30);
    untilExplosion(world);
    expect(world.projectiles.filter((p) => p.kind === piece)).toHaveLength(5);
    const events = run(world, 300);
    expect(events.filter((e) => e.type === 'explosion')).toHaveLength(5);
    expect(world.projectiles).toHaveLength(0);
  });
});

describe('Air strike', () => {
  it('comes in from the other side after Tab', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'airstrike');
    run(world, 1, { toggle: true });
    expect(worm.strikeDir).toBe(-1);
    run(world, 1, { target: { x: 800, y: 0 } });
    expect(world.projectiles.every((p) => p.vx < 0)).toBe(true);
  });

  it('drops five missiles in a row around the clicked spot', () => {
    const world = groundWorld();
    standingWorm(world, 200, 'airstrike');
    run(world, 1, { fire: true }); // Space alone does nothing
    expect(world.projectiles).toHaveLength(0);
    run(world, 1, { target: { x: 800, y: 0 } });
    expect(world.projectiles.filter((p) => p.kind === 'missile')).toHaveLength(AIRSTRIKE.missiles);
    const hits: number[] = [];
    for (let t = 0; t < 600 && world.projectiles.length > 0; t++) {
      for (const e of run(world, 1)) if (e.type === 'explosion') hits.push(e.x);
    }
    expect(hits).toHaveLength(AIRSTRIKE.missiles);
    for (const x of hits) expect(Math.abs(x - 800)).toBeLessThan(AIRSTRIKE.spacing * 2 + 8);
  });
});

describe('Melee', () => {
  it('the bat knocks a worm in front of it along the aim and hurts it', () => {
    const world = groundWorld();
    const batter = standingWorm(world, 200, 'bat');
    batter.aim = Math.PI / 6;
    const target = world.addWorm('T', 1, 215, restingY(GROUND));
    run(world, 5);
    const events = run(world, 1, { fire: true });
    expect(events).toContainEqual(expect.objectContaining({ type: 'hit', landed: true }));
    expect(target.hp).toBe(100 - MELEE.bat.damage);
    // Along the 30° swing at the bat's strength (push 200 vs. the bazooka's 130).
    const speed = (PHYS.blastKnockback * MELEE.bat.push) / 130;
    expect(target.vx).toBeCloseTo(speed * Math.cos(Math.PI / 6), 0);
    expect(target.vy).toBeLessThan(0);
  });

  it('the prod pushes the worm in front without hurting it, and misses worms behind', () => {
    const world = groundWorld();
    standingWorm(world, 200, 'prod');
    const front = world.addWorm('F', 1, 214, restingY(GROUND));
    const behind = world.addWorm('B', 1, 186, restingY(GROUND));
    run(world, 5);
    run(world, 1, { fire: true });
    expect(front.hp).toBe(100);
    expect(front.knocked).toBe(true);
    expect(front.vx).toBeGreaterThan(0);
    expect(behind.knocked).toBe(false);
  });
});

describe('Impact', () => {
  it('thrown worms slide a little along the ground after landing', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, 'rope');
    Object.assign(worm, { y: worm.y - 3, vx: 200, vy: 150, grounded: false, knocked: true });
    for (let t = 0; t < 30 && !worm.grounded; t++) run(world, 1);
    expect(worm.slide).toBeGreaterThan(0);
    const landedAt = worm.x;
    run(world, 2 * 60);
    expect(worm.slide).toBe(0);
    // Half a worm height to two: noticeable, but no ice rink.
    expect(worm.x).toBeGreaterThan(landedAt + PHYS.wormRadius);
    expect(worm.x).toBeLessThan(landedAt + PHYS.wormRadius * 4);
  });

  it("worms that just drop don't slide", () => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, 'rope');
    Object.assign(worm, { y: worm.y - 60, vx: 0, vy: 0, grounded: false });
    run(world, 60);
    expect(worm.grounded).toBe(true);
    expect(worm.slide).toBe(0);
    expect(worm.x).toBe(300);
  });

  it("grenades bounce off hard landings but not soft ones", () => {
    const landing = (vy: number) => {
      const world = groundWorld();
      world.spawn({ kind: 'grenade', x: 300, y: GROUND - 5, vx: 0, vy, fuse: 5 });
      run(world, 1);
      return world.projectiles[0].vy;
    };
    expect(landing(100)).toBeGreaterThanOrEqual(0); // soft: stays down
    expect(landing(400)).toBeLessThan(0); // hard: bounces back up
  });

  it('thrown worms take fall damage when they land hard', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, 'rope');
    Object.assign(worm, { y: worm.y - 3, vx: 0, vy: PHYS.wormMaxFallSpeed, grounded: false, knocked: true });
    run(world, 5);
    expect(worm.grounded).toBe(true);
    expect(worm.hp).toBeLessThan(100);
  });

  it('grenades bounce off worms instead of passing through', () => {
    const world = groundWorld();
    const wall = world.addWorm('W', 1, 400, restingY(GROUND));
    run(world, 5);
    world.spawn({ kind: 'grenade', x: 300, y: GROUND - 4, vx: 300, vy: 0, fuse: 5 });
    const grenade = world.projectiles[0];
    let furthest = 0;
    for (let t = 0; t < 60; t++) {
      run(world, 1);
      furthest = Math.max(furthest, grenade.x);
    }
    expect(furthest).toBeLessThan(wall.x - PHYS.wormRadius);
    expect(grenade.x).toBeLessThan(wall.x);
  });
});

describe('Weapon panel layout', () => {
  it('has every weapon in exactly one slot, in a 5 x (7 + 4) grid like WR', () => {
    const slots = [...PANEL.weapons.flat(), ...PANEL.utilities.flat()];
    for (const id of WEAPON_ORDER) expect(slots.filter((s) => s === id)).toHaveLength(1);
    expect(PANEL.weapons.map((r) => r.length)).toEqual([7, 7, 7, 7, 7]);
    expect(PANEL.utilities.map((r) => r.length)).toEqual([4, 4, 4, 4, 4]);
  });

  it('gives F1–F5 to the weapon rows and F6–F10 to the utility rows', () => {
    expect(QUICK_SELECT.map((q) => q.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);
    expect(QUICK_SELECT[0].row).toBe(PANEL.weapons[0]);
    expect(QUICK_SELECT[5].row).toBe(PANEL.utilities[0]);
  });
});

describe('Parachute', () => {
  /** A worm high above the ground, falling, holding `weapon`. */
  function falling(weapon: Worm['weapon']) {
    const world = groundWorld();
    const worm = world.addWorm('P', 0, 300, 60);
    worm.weapon = weapon;
    return { world, worm };
  }

  it('opens by itself on a long fall and lands without fall damage', () => {
    const { world, worm } = falling('parachute');
    let fastest = 0;
    let opened = false;
    for (let t = 0; t < 60 * 20 && !worm.grounded; t++) {
      run(world, 1);
      if (worm.parachute) {
        opened = true;
        fastest = Math.max(fastest, worm.vy);
      }
    }
    expect(opened).toBe(true);
    expect(worm.grounded).toBe(true);
    expect(worm.parachute).toBe(false); // folded away on landing
    expect(worm.hp).toBe(100);
    expect(fastest).toBeLessThan(PHYS.parachuteAutoOpen + 10);
  });

  it('without one, the same fall hurts', () => {
    const { world, worm } = falling('rope');
    for (let t = 0; t < 60 * 10 && !worm.grounded; t++) run(world, 1);
    expect(worm.hp).toBeLessThan(100);
  });

  it('opens and closes with Space, and steers with ← →', () => {
    const { world, worm } = falling('parachute');
    run(world, 1, { fire: true });
    expect(worm.parachute).toBe(true);
    const x0 = worm.x;
    run(world, 60, { right: true });
    expect(worm.x).toBeGreaterThan(x0 + 20);
    run(world, 1, { fire: true });
    expect(worm.parachute).toBe(false);
  });
});

describe('Jet pack', () => {
  it('goes on with Space, flies up on ↑ burning fuel, and goes off with Space', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, 'jetpack');
    run(world, 1, { fire: true });
    expect(worm.jetpack).toBe(PHYS.jetpackFuel);
    const y0 = worm.y;
    run(world, 60, { up: true });
    expect(worm.y).toBeLessThan(y0 - 40);
    expect(worm.jetpack).toBeLessThan(PHYS.jetpackFuel - 0.9);
    run(world, 1, { fire: true });
    expect(worm.jetpack).toBeNull();
    run(world, 120);
    expect(worm.grounded).toBe(true);
  });

  it('runs out of fuel', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 300, 'jetpack');
    run(world, 1, { fire: true });
    run(world, (PHYS.jetpackFuel + 1) * 60, { right: true });
    expect(worm.jetpack).toBe(0);
  });
});

describe('Teleport', () => {
  it('moves the worm to a clicked spot in the open, but not into the ground', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'teleport');
    const into = run(world, 1, { target: { x: 600, y: GROUND + 40 } }); // inside the ground
    expect(worm.x).toBe(200);
    expect(into.some((e) => e.type === 'weaponUsed')).toBe(false);
    const events = run(world, 1, { target: { x: 600, y: GROUND - 100 } });
    expect(worm.x).toBe(600);
    expect(events).toContainEqual({ type: 'weaponUsed', weapon: 'teleport' });
    run(world, 120);
    expect(worm.grounded).toBe(true); // dropped down from there
  });
});

describe('Girder', () => {
  it('puts a bar of ground where the map is clicked, turned with Tab', () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'girder');
    run(world, 1, { toggle: true });
    run(world, 1, { toggle: true });
    expect(worm.girderAngle).toBe(2);
    const at = { x: 300, y: GROUND - 80 };
    expect(world.terrain.isSolid(at.x, at.y)).toBe(false);
    const events = run(world, 1, { target: at });
    expect(world.terrain.isSolid(at.x, at.y)).toBe(true);
    expect(events).toContainEqual({ type: 'girder', x: at.x, y: at.y, angle: Math.PI / 4 });
  });

  it("can't go out of reach or onto a worm", () => {
    const world = groundWorld();
    const worm = standingWorm(world, 200, 'girder');
    run(world, 1, { target: { x: 200 + PHYS.girderRange + 50, y: GROUND - 60 } });
    run(world, 1, { target: { x: worm.x, y: worm.y } });
    expect(world.drainEvents().some((e) => e.type === 'girder')).toBe(false);
    expect(world.terrain.isSolid(worm.x, worm.y)).toBe(false);
  });
});
