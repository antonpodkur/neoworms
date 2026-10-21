import { DT, PHYS } from './constants';
import type { Launch, ProjectileKind } from './projectiles';
import { releaseRope, shootRope } from './rope';
import type { Worm, WormInput } from './worm';

export type WeaponId =
  | 'rope'
  | 'bazooka'
  | 'grenade'
  | 'cluster'
  | 'banana'
  | 'dynamite'
  | 'mine'
  | 'oldWoman'
  | 'airstrike'
  | 'bat'
  | 'prod';

/**
 * An explosion, the way Worms Revolution describes one: a crater, then damage and push that
 * are at their max within the inner range, fade to their min at the outer range, and stop
 * there. Lengths are in our pixels; push is in WR force units (the bazooka's max is 130).
 */
export interface Blast {
  radius: number;
  damage: [min: number, max: number];
  damageRange: [inner: number, outer: number];
  push: [min: number, max: number];
  pushRange: [inner: number, outer: number];
  /** Extra upward kick (WR "ArtificialExplosionPush"); 1 is normal. */
  lift: number;
  /** Share of the push kept when the blast goes off under water. */
  waterPush: number;
}

/**
 * How a weapon is used. throw: hold Space to charge, release to fire. place: set down in
 * front of the worm. melee: hits a worm next to it. strike: click the map to call it in.
 */
export type WeaponUse = 'rope' | 'throw' | 'place' | 'melee' | 'strike';

export interface WeaponSpec {
  name: string;
  use: WeaponUse;
  /** What it launches (throw, place and strike weapons). */
  projectile?: ProjectileKind;
  /** Can be dropped with Enter while on the ninja rope. */
  droppable: boolean;
  /** Tab (Toggle) cycles its fuse. */
  hasFuse: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rope: { name: 'Ninja Rope', use: 'rope', droppable: false, hasFuse: false },
  bazooka: { name: 'Bazooka', use: 'throw', projectile: 'shell', droppable: false, hasFuse: false },
  grenade: { name: 'Grenade', use: 'throw', projectile: 'grenade', droppable: true, hasFuse: true },
  cluster: { name: 'Cluster Bomb', use: 'throw', projectile: 'cluster', droppable: true, hasFuse: true },
  banana: { name: 'Banana Bomb', use: 'throw', projectile: 'banana', droppable: true, hasFuse: true },
  dynamite: { name: 'Dynamite', use: 'place', projectile: 'dynamite', droppable: true, hasFuse: false },
  mine: { name: 'Mine', use: 'place', projectile: 'mine', droppable: true, hasFuse: false },
  oldWoman: { name: 'Old Woman', use: 'place', projectile: 'oldWoman', droppable: false, hasFuse: false },
  airstrike: { name: 'Air Strike', use: 'strike', projectile: 'missile', droppable: false, hasFuse: false },
  bat: { name: 'Baseball Bat', use: 'melee', droppable: false, hasFuse: false },
  prod: { name: 'Prod', use: 'melee', droppable: false, hasFuse: false },
};

export const WEAPON_ORDER = Object.keys(WEAPONS) as WeaponId[];

/** The weapon panel's rows, as in Worms: each has a function key that picks along its row. */
export const CATEGORIES: { name: string; key: string; weapons: WeaponId[] }[] = [
  { name: 'Artillery', key: 'F1', weapons: ['bazooka'] },
  { name: 'Grenades', key: 'F2', weapons: ['grenade', 'cluster', 'banana'] },
  { name: 'Explosives', key: 'F3', weapons: ['dynamite', 'mine', 'oldWoman'] },
  { name: 'Air', key: 'F4', weapons: ['airstrike'] },
  { name: 'Close combat', key: 'F5', weapons: ['bat', 'prod'] },
  { name: 'Tools', key: 'F6', weapons: ['rope'] },
];

/**
 * How many of a weapon each team starts with (null: unlimited), and how many of the team's
 * own turns go by before it can be used (Worms' "delay").
 */
export interface Ammo {
  count: number | null;
  delay: number;
}

export type SchemeId = 'standard' | 'unlimited';

const unlimited = (): Record<WeaponId, Ammo> =>
  Object.fromEntries(WEAPON_ORDER.map((id) => [id, { count: null, delay: 0 }])) as Record<WeaponId, Ammo>;

/** Weapon sets for a match. Standard keeps the big ones scarce and late, like Worms' defaults. */
export const SCHEMES: Record<SchemeId, { name: string; ammo: Record<WeaponId, Ammo> }> = {
  standard: {
    name: 'Standard',
    ammo: {
      ...unlimited(),
      cluster: { count: 3, delay: 0 },
      banana: { count: 1, delay: 2 },
      dynamite: { count: 2, delay: 1 },
      mine: { count: 3, delay: 0 },
      oldWoman: { count: 1, delay: 3 },
      airstrike: { count: 1, delay: 2 },
      bat: { count: 1, delay: 0 },
    },
  },
  unlimited: { name: 'Unlimited', ammo: unlimited() },
};

/**
 * A weapon's state for one team: shots left (null: unlimited), turns until it's ready, and
 * whether the map rules it out altogether (an air strike under a cave roof).
 */
export interface WeaponStatus {
  ammo: number | null;
  wait: number;
  blocked: boolean;
}

export const isUsable = (s: WeaponStatus): boolean => !s.blocked && s.wait === 0 && s.ammo !== 0;

/** Grenade fuse choices in seconds. */
export const FUSES = [1, 2, 3, 4, 5];

/** WR level-outline pixels to ours: a WR worm is 19.5 px tall, ours 16 (docs/wr-reference.md). */
export const WR_SCALE = 16 / 19.5;

/**
 * Level-outline pixels per length unit of WR's explosion table. Not 1: craters, damage and push
 * measured in WR footage on a map of known shape come out ~1.85× the table's numbers.
 */
const WR_TABLE_UNIT = 1.85;

/** A row of WR's explosion table (its length and force units) converted to a Blast. */
function wr(row: {
  crater: number;
  damage: [number, number];
  damageRange: [number, number];
  push: [number, number];
  pushRange: [number, number];
  lift?: number;
  waterPush?: number;
}): Blast {
  const px = (v: number) => Math.round(v * WR_TABLE_UNIT * WR_SCALE * 10) / 10;
  return {
    radius: px(row.crater),
    damage: row.damage,
    damageRange: [px(row.damageRange[0]), px(row.damageRange[1])],
    push: row.push,
    pushRange: [px(row.pushRange[0]), px(row.pushRange[1])],
    lift: row.lift ?? 1,
    waterPush: row.waterPush ?? 0.6,
  };
}

/** A blast whose damage and push fade evenly from the centre to `reach` (in our pixels). */
export function roundBlast(radius: number, damage: number, reach: number, push = 1): Blast {
  return {
    radius,
    damage: [0, damage],
    damageRange: [0, reach],
    push: [0, 130 * push],
    pushRange: [0, reach],
    lift: 1,
    waterPush: 0.6,
  };
}

/**
 * Explosions from Worms Revolution's payload table (docs/wr-reference.md). The grenade had no
 * row in the export, so it uses the bazooka's; footage shows the mine is the bazooka's too (the
 * export's "MineRound" repeats the Old Woman's numbers, a parsing slip).
 */
export const BLASTS = {
  bazooka: wr({ crater: 26, damage: [1, 45], damageRange: [6, 47], push: [5, 130], pushRange: [4, 46] }),
  grenade: wr({ crater: 26, damage: [1, 45], damageRange: [6, 47], push: [5, 130], pushRange: [4, 46] }),
  /** The bomb itself is a grenade; its five fragments are WR's ClusterBombRound. */
  clusterFragment: wr({ crater: 15, damage: [1, 15], damageRange: [1, 15], push: [5, 15], pushRange: [3, 14], lift: 1.3 }),
  /** WR's BananaBombletRound, used for the banana and each of its bomblets. */
  banana: wr({ crater: 34, damage: [1, 65], damageRange: [6, 63], push: [5, 165], pushRange: [4, 62], lift: 1.3 }),
  dynamite: wr({ crater: 34, damage: [1, 65], damageRange: [6, 63], push: [5, 170], pushRange: [4, 62], lift: 1.3 }),
  mine: wr({ crater: 26, damage: [1, 45], damageRange: [6, 47], push: [5, 130], pushRange: [4, 46] }),
  oldWoman: wr({ crater: 52, damage: [1, 75], damageRange: [7, 73], push: [5, 230], pushRange: [4, 70] }),
  airstrike: wr({ crater: 14, damage: [1, 45], damageRange: [6, 20], push: [5, 70], pushRange: [3, 19], lift: 1.3 }),
  /** A worm at 0 HP blows up at the end of the turn (WR "WormDeathBlast"). */
  wormDeath: wr({ crater: 12, damage: [1, 25], damageRange: [4, 22], push: [1, 60], pushRange: [10, 20] }),
} satisfies Record<string, Blast>;

/**
 * Close-up hits from WR's BaseballBatRound and ProdRound: no crater, a fixed push along the
 * swing. `reach` is the distance between the two worms' centres.
 */
export interface Melee {
  reach: number;
  damage: number;
  /** WR force units, like Blast.push. */
  push: number;
  /** Swing along the aim (bat), or this many degrees above straight ahead (prod). */
  aimed: boolean;
  angle?: number;
}

/**
 * The prod is measured: it pokes a worm about 0.75–1 worm height away up and over at ~85 px/s,
 * ~55° above horizontal. The bat's numbers are WR's table.
 */
export const MELEE: Record<'bat' | 'prod', Melee> = {
  bat: { reach: 16 + 10 * WR_SCALE, damage: 30, push: 200, aimed: true },
  prod: { reach: 18, damage: 0, push: 40, aimed: false, angle: 55 },
};

/**
 * Air strike: this many missiles, this far apart, starting this far above the map and flying
 * in a straight line (no gravity or wind) from the side the worm faces.
 */
export const AIRSTRIKE = { missiles: 5, spacing: 18, height: 80, vx: 160, vy: 380 };

/** What weapon handling needs from the world. */
export interface WeaponContext {
  spawn(launch: Launch): void;
  /** Swings a melee weapon from `worm` along (dirX, dirY). */
  hit(worm: Worm, dirX: number, dirY: number, melee: Melee): void;
  /** Height of the first ground from the top in column x (the water if there is none). */
  surfaceY(x: number): number;
  /** A weapon (not the rope) went off: the match starts retreat time. */
  weaponUsed(weapon: WeaponId): void;
}

/**
 * The active worm's weapon controls: pick a weapon, Tab to cycle the fuse, Space to fire
 * (hold to charge), Enter to drop the selected weapon while on the rope, and a click on the
 * map for the air strike. With `canFire` false (retreat time) only the rope still works.
 */
export function useWeapons(worm: Worm, input: WormInput, ctx: WeaponContext, canFire = true): void {
  if (input.select) {
    worm.weapon = input.select;
    worm.charge = null;
  }
  if (input.toggle && WEAPONS[worm.weapon].hasFuse) {
    worm.fuse = FUSES[(FUSES.indexOf(worm.fuse) + 1) % FUSES.length];
  }

  // On the rope (or flying after letting go), Enter drops a weapon instead of jumping.
  const roping = worm.rope?.phase === 'attached' || worm.ropeChain;
  if (canFire && input.jump && roping && WEAPONS[worm.weapon].droppable) drop(worm, ctx);

  if (canFire && input.target !== null && WEAPONS[worm.weapon].use === 'strike' && worm.grounded && !worm.rope) {
    callStrike(worm, input.target, ctx);
  }

  if (worm.charge !== null) charge(worm, input, ctx);
  else if (input.fire) pressFire(worm, ctx, canFire);
}

function pressFire(worm: Worm, ctx: WeaponContext, canFire: boolean): void {
  if (worm.rope?.phase === 'attached') return releaseRope(worm);
  if (worm.rope) return; // hook still flying
  // After letting go of the rope, Space shoots it again whatever is selected.
  if (worm.weapon === 'rope' || worm.ropeChain) return shootRope(worm);
  if (!canFire || !worm.grounded) return; // other weapons need solid ground
  const spec = WEAPONS[worm.weapon];
  if (spec.use === 'throw') worm.charge = 0;
  else if (spec.use === 'place') place(worm, spec.projectile!, ctx);
  else if (spec.use === 'melee') swing(worm, MELEE[worm.weapon as keyof typeof MELEE], ctx);
}

/** Builds up power while Space is held; fires on release or at full power. */
function charge(worm: Worm, input: WormInput, ctx: WeaponContext): void {
  if (!worm.grounded) {
    worm.charge = null; // knocked off its feet
    return;
  }
  const power = Math.min(1, worm.charge! + DT / PHYS.chargeTime);
  if (input.fireHeld && power < 1) {
    worm.charge = power;
    return;
  }
  worm.charge = null;
  const kind = WEAPONS[worm.weapon].projectile!;
  const dirX = Math.cos(worm.aim) * worm.facing;
  const dirY = -Math.sin(worm.aim);
  const speed = power * (kind === 'shell' ? PHYS.bazookaSpeed : PHYS.grenadeSpeed);
  const offset = PHYS.wormRadius + 4; // start clear of the worm
  ctx.spawn({
    kind,
    x: worm.x + dirX * offset,
    y: worm.y + dirY * offset,
    vx: dirX * speed,
    vy: dirY * speed,
    fuse: worm.fuse,
  });
  ctx.weaponUsed(worm.weapon);
}

/** Mines, dynamite and the old woman are set down just in front of the worm. */
function place(worm: Worm, kind: ProjectileKind, ctx: WeaponContext): void {
  ctx.spawn({ kind, x: worm.x + worm.facing * (PHYS.wormRadius + 5), y: worm.y, vx: worm.facing * 30, vy: -50 });
  ctx.weaponUsed(worm.weapon);
}

function swing(worm: Worm, melee: Melee, ctx: WeaponContext): void {
  const angle = melee.aimed ? worm.aim : ((melee.angle ?? 0) * Math.PI) / 180;
  const dirX = Math.cos(angle) * worm.facing;
  const dirY = -Math.sin(angle);
  ctx.hit(worm, dirX, dirY, melee);
  ctx.weaponUsed(worm.weapon);
}

/**
 * Missiles come down in a straight line from above the map, in the direction the worm faces,
 * in a row centred on `targetX` where it meets the ground.
 */
function callStrike(worm: Worm, targetX: number, ctx: WeaponContext): void {
  const { missiles, spacing, height, vx, vy } = AIRSTRIKE;
  for (let i = 0; i < missiles; i++) {
    const x = targetX + (i - (missiles - 1) / 2) * spacing;
    const startY = -height - i * 6;
    // Start back along the flight line by however far it drifts on the way down.
    const lead = (vx * (ctx.surfaceY(x) - startY)) / vy;
    ctx.spawn({ kind: 'missile', x: x - worm.facing * lead, y: startY, vx: worm.facing * vx, vy });
  }
  ctx.weaponUsed(worm.weapon);
}

/** Lets go of a droppable weapon below the worm; it keeps the worm's speed. */
function drop(worm: Worm, ctx: WeaponContext): void {
  ctx.spawn({
    kind: WEAPONS[worm.weapon].projectile!,
    x: worm.x,
    y: worm.y + PHYS.wormRadius + 4,
    vx: worm.vx,
    vy: worm.vy,
    fuse: worm.fuse,
  });
  ctx.weaponUsed(worm.weapon);
}
