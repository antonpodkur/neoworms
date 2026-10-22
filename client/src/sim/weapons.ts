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
  | 'prod'
  | 'parachute'
  | 'jetpack'
  | 'teleport'
  | 'girder'
  | 'skipGo'
  | 'surrender'
  | 'wormSelect';

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
 * front of the worm. melee: hits a worm next to it. strike: click the map to call it in from
 * the sky (needs open sky). target: click the map to use it there (teleport, girder). self:
 * Space uses it on the worm or the turn (parachute, jet pack, skip go, surrender, worm select).
 */
export type WeaponUse = 'rope' | 'throw' | 'place' | 'melee' | 'strike' | 'target' | 'self';

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
  parachute: { name: 'Parachute', use: 'self', droppable: false, hasFuse: false },
  jetpack: { name: 'Jet Pack', use: 'self', droppable: false, hasFuse: false },
  teleport: { name: 'Teleport', use: 'target', droppable: false, hasFuse: false },
  girder: { name: 'Girder', use: 'target', droppable: false, hasFuse: false },
  skipGo: { name: 'Skip Go', use: 'self', droppable: false, hasFuse: false },
  surrender: { name: 'Surrender', use: 'self', droppable: false, hasFuse: false },
  wormSelect: { name: 'Worm Select', use: 'self', droppable: false, hasFuse: false },
};

export const WEAPON_ORDER = Object.keys(WEAPONS) as WeaponId[];

/**
 * A slot of the weapon panel: one of our weapons, a Worms Revolution weapon we haven't made yet
 * (its name; the slot shows empty), or nothing.
 */
export type PanelSlot = WeaponId | { soon: string } | null;

const soon = (name: string): PanelSlot => ({ soon: name });

/**
 * The weapon panel laid out as in Worms Revolution's Inventory: five rows of seven weapons and
 * five rows of four utilities, every weapon in its WR slot (read off WR's scheme editor).
 */
export const PANEL: { weapons: PanelSlot[][]; utilities: PanelSlot[][] } = {
  weapons: [
    ['bazooka', 'grenade', 'cluster', soon('Petrol Bomb'), soon('Water Bomb'), soon('Homing Missile'), 'banana'],
    [soon('Fire Punch'), soon('Dragon Ball'), 'bat', 'prod', soon('Kamikaze'), 'mine', 'dynamite'],
    // The third slot looks like a flamethrower in WR's icon; not confirmed by name yet.
    [soon('Shotgun'), soon('Uzi'), soon('Flamethrower'), null, soon('Water Gun'), soon('Sentry Gun'), soon('Holy Hand Grenade')],
    ['airstrike', null, soon('Bunker Buster'), soon('Water Strike'), null, soon('Boggy B'), null],
    [soon('Sheep'), soon('Mole'), null, 'oldWoman', soon('Super Sheep'), null, soon('Concrete Donkey')],
  ],
  utilities: [
    ['jetpack', 'rope', 'parachute', 'teleport'],
    [soon('Blow Torch'), soon('Pneumatic Drill'), 'girder', soon('Wrench')],
    [soon('Telekinesis'), soon('UFO'), soon('Electromagnet'), null],
    [soon('Plug Hole'), soon('Teleshield'), null, soon('Stick Up')],
    // In WR's in-game Inventory the white flag sits at the end of this row.
    ['wormSelect', 'skipGo', null, 'surrender'],
  ],
};

/**
 * WR's Quick Select keys: F1–F5 pick from the weapon rows, F6–F10 from the utility rows,
 * each press moving on along the row.
 */
export const QUICK_SELECT: { key: string; row: PanelSlot[] }[] = [
  ...PANEL.weapons.map((row, i) => ({ key: `F${i + 1}`, row })),
  ...PANEL.utilities.map((row, i) => ({ key: `F${i + 6}`, row })),
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
      // Utility counts from WR's scheme editor (parachute and surrender unlimited).
      jetpack: { count: 3, delay: 0 },
      teleport: { count: 4, delay: 0 },
      girder: { count: 2, delay: 0 },
      wormSelect: { count: 2, delay: 0 },
      skipGo: { count: 4, delay: 0 },
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
  /** A utility that doesn't end the turn was used (parachute, jet pack): only its ammo goes. */
  utilityUsed(weapon: WeaponId): void;
  /** Moves the worm to (x, y) if it fits there; false if not. */
  teleport(worm: Worm, x: number, y: number): boolean;
  /** Puts a girder at (x, y) turned `angle`, if it's within reach and clear of worms. */
  placeGirder(worm: Worm, x: number, y: number, angle: number): boolean;
  /** Ends the turn now (Skip Go). */
  skipTurn(): void;
  /** The worm's team gives up (Surrender). */
  surrender(team: number): void;
}

/** A girder's angle in radians from its eighths of a half turn. */
export const girderRadians = (step: number): number => (step * Math.PI) / 8;

/**
 * The active worm's weapon controls, WR's: pick a weapon, 1–5 to set a fuse, Tab (Toggle) to
 * cycle the fuse, flip the air strike's direction or turn the girder, Space to fire (hold to
 * charge), Enter (AltFire) to drop the selected weapon while on the rope, parachute or jet
 * pack, and a click on the map for the air strike, teleport and girder. With `canFire` false
 * (retreat time) only the rope works, plus a parachute or jet pack already in use; `canUse`
 * says whether the team may use the selected utility at all.
 */
export function useWeapons(worm: Worm, input: WormInput, ctx: WeaponContext, canFire = true, canUse = canFire): void {
  if (input.select) {
    worm.weapon = input.select;
    worm.charge = null;
  }
  const spec = WEAPONS[worm.weapon];
  if (input.fuse !== null && spec.hasFuse && FUSES.includes(input.fuse)) worm.fuse = input.fuse;
  if (input.toggle && spec.hasFuse) worm.fuse = FUSES[(FUSES.indexOf(worm.fuse) + 1) % FUSES.length];
  else if (input.toggle && spec.use === 'strike') worm.strikeDir = worm.strikeDir === 1 ? -1 : 1;
  else if (input.toggle && worm.weapon === 'girder') worm.girderAngle = (worm.girderAngle + 1) % 8;

  // On the rope, parachute or jet pack (or flying after letting go of the rope), AltFire drops a weapon.
  const flying = worm.rope?.phase === 'attached' || worm.ropeChain || worm.parachute || worm.jetpack !== null;
  if (canFire && input.altFire && flying && spec.droppable) drop(worm, ctx);

  // A parachute opens by itself once a worm holding it falls fast enough.
  const falling = !worm.grounded && !worm.rope && worm.jetpack === null;
  if (worm.weapon === 'parachute' && canUse && falling && !worm.parachute && worm.vy > PHYS.parachuteAutoOpen) {
    openParachute(worm, ctx);
  }

  if (canFire && input.target !== null && !worm.rope && worm.charge === null) useTarget(worm, input.target, ctx);

  if (worm.charge !== null) charge(worm, input, ctx);
  else if (input.fire) pressFire(worm, ctx, canFire, canUse);
}

/** Air strike, teleport and girder go where the map was clicked. */
function useTarget(worm: Worm, target: { x: number; y: number }, ctx: WeaponContext): void {
  if (worm.weapon === 'airstrike') {
    if (worm.grounded) callStrike(worm, target.x, ctx);
  } else if (worm.weapon === 'teleport') {
    if (ctx.teleport(worm, target.x, target.y)) ctx.weaponUsed('teleport');
  } else if (worm.weapon === 'girder') {
    if (ctx.placeGirder(worm, target.x, target.y, girderRadians(worm.girderAngle))) ctx.weaponUsed('girder');
  }
}

function openParachute(worm: Worm, ctx: WeaponContext): void {
  worm.parachute = true;
  worm.ropeChain = false;
  worm.afterTouch = 0;
  ctx.utilityUsed('parachute');
}

/**
 * Space with a "self" utility: the parachute opens (in the air) or closes, the jet pack goes on
 * or off, Skip Go ends the turn, Surrender gives up. Worm Select is the match's (it changes
 * whose turn it is). The parachute and jet pack can be switched off whenever, but switching
 * them on needs `canUse`.
 */
function useSelf(worm: Worm, ctx: WeaponContext, canFire: boolean, canUse: boolean): void {
  if (worm.weapon === 'parachute') {
    if (worm.parachute) worm.parachute = false;
    else if (canUse && !worm.grounded && worm.jetpack === null) openParachute(worm, ctx);
  } else if (worm.weapon === 'jetpack') {
    if (worm.jetpack !== null) worm.jetpack = null;
    else if (canUse) {
      worm.jetpack = PHYS.jetpackFuel;
      worm.parachute = false;
      worm.ropeChain = false;
      worm.pendingJump = null;
      ctx.utilityUsed('jetpack');
    }
  } else if (canFire && worm.weapon === 'skipGo') {
    ctx.utilityUsed('skipGo');
    ctx.skipTurn();
  } else if (canFire && worm.weapon === 'surrender') ctx.surrender(worm.team);
}

function pressFire(worm: Worm, ctx: WeaponContext, canFire: boolean, canUse: boolean): void {
  if (worm.rope?.phase === 'attached') return releaseRope(worm);
  if (worm.rope) return; // hook still flying
  const spec = WEAPONS[worm.weapon];
  if (spec.use === 'self') return useSelf(worm, ctx, canFire, canUse);
  // After letting go of the rope, Space shoots it again whatever is selected.
  if (worm.weapon === 'rope' || worm.ropeChain) return shootRope(worm);
  if (!canFire || !worm.grounded) return; // other weapons need solid ground
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
    ctx.spawn({ kind: 'missile', x: x - worm.strikeDir * lead, y: startY, vx: worm.strikeDir * vx, vy });
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
