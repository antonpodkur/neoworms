import { DT, PHYS } from './constants';
import type { Launch, ProjectileKind } from './projectiles';
import { releaseRope, shootRope } from './rope';
import type { Worm, WormInput } from './worm';

export type WeaponId =
  | 'rope'
  | 'bazooka'
  | 'grenade'
  | 'cluster'
  | 'petrol'
  | 'homing'
  | 'banana'
  | 'firePunch'
  | 'dragonBall'
  | 'kamikaze'
  | 'shotgun'
  | 'uzi'
  | 'holy'
  | 'dynamite'
  | 'mine'
  | 'oldWoman'
  | 'sheep'
  | 'superSheep'
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
 * shoot: Space fires it straight along the aim at once (Dragon Ball). gun: Space fires bullets
 * (Shotgun, Uzi). kamikaze: Space sends the worm itself flying along the aim.
 */
export type WeaponUse =
  | 'rope'
  | 'throw'
  | 'place'
  | 'melee'
  | 'strike'
  | 'target'
  | 'self'
  | 'shoot'
  | 'gun'
  | 'kamikaze';

export interface WeaponSpec {
  name: string;
  use: WeaponUse;
  /** What it launches (throw, place, shoot and strike weapons). */
  projectile?: ProjectileKind;
  /** Can be dropped with Enter while on the ninja rope. */
  droppable: boolean;
  /** Tab (Toggle) cycles its fuse. */
  hasFuse: boolean;
  /** Needs a click on the map first (the homing missile's target). */
  needsTarget?: boolean;
  /**
   * Steered by its owner once it's out (sheep): Space sets it off, and the turn goes on until
   * it does, so retreat time starts then.
   */
  remote?: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rope: { name: 'Ninja Rope', use: 'rope', droppable: false, hasFuse: false },
  bazooka: { name: 'Bazooka', use: 'throw', projectile: 'shell', droppable: false, hasFuse: false },
  grenade: { name: 'Grenade', use: 'throw', projectile: 'grenade', droppable: true, hasFuse: true },
  cluster: { name: 'Cluster Bomb', use: 'throw', projectile: 'cluster', droppable: true, hasFuse: true },
  petrol: { name: 'Petrol Bomb', use: 'throw', projectile: 'petrol', droppable: true, hasFuse: false },
  homing: {
    name: 'Homing Missile',
    use: 'throw',
    projectile: 'homing',
    droppable: false,
    hasFuse: false,
    needsTarget: true,
  },
  banana: { name: 'Banana Bomb', use: 'throw', projectile: 'banana', droppable: true, hasFuse: true },
  firePunch: { name: 'Fire Punch', use: 'melee', droppable: false, hasFuse: false },
  dragonBall: { name: 'Dragon Ball', use: 'shoot', projectile: 'dragonBall', droppable: false, hasFuse: false },
  kamikaze: { name: 'Kamikaze', use: 'kamikaze', droppable: false, hasFuse: false },
  shotgun: { name: 'Shotgun', use: 'gun', droppable: false, hasFuse: false },
  uzi: { name: 'Uzi', use: 'gun', droppable: false, hasFuse: false },
  holy: { name: 'Holy Hand Grenade', use: 'throw', projectile: 'holy', droppable: true, hasFuse: false },
  dynamite: { name: 'Dynamite', use: 'place', projectile: 'dynamite', droppable: true, hasFuse: false },
  mine: { name: 'Mine', use: 'place', projectile: 'mine', droppable: true, hasFuse: false },
  oldWoman: { name: 'Old Woman', use: 'place', projectile: 'oldWoman', droppable: false, hasFuse: false },
  sheep: { name: 'Sheep', use: 'place', projectile: 'sheep', droppable: false, hasFuse: false, remote: true },
  superSheep: {
    name: 'Super Sheep',
    use: 'place',
    projectile: 'superSheep',
    droppable: false,
    hasFuse: false,
    remote: true,
  },
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
    ['bazooka', 'grenade', 'cluster', 'petrol', soon('Water Bomb'), 'homing', 'banana'],
    ['firePunch', 'dragonBall', 'bat', 'prod', 'kamikaze', 'mine', 'dynamite'],
    // The third slot looks like a flamethrower in WR's icon; not confirmed by name yet.
    ['shotgun', 'uzi', soon('Flamethrower'), null, soon('Water Gun'), soon('Sentry Gun'), 'holy'],
    ['airstrike', null, soon('Bunker Buster'), soon('Water Strike'), null, soon('Boggy B'), null],
    ['sheep', soon('Mole'), null, 'oldWoman', 'superSheep', null, soon('Concrete Donkey')],
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
      petrol: { count: 2, delay: 1 },
      homing: { count: 2, delay: 1 },
      banana: { count: 1, delay: 2 },
      dragonBall: { count: 2, delay: 0 },
      kamikaze: { count: 1, delay: 2 },
      holy: { count: 1, delay: 3 },
      dynamite: { count: 2, delay: 1 },
      mine: { count: 3, delay: 0 },
      oldWoman: { count: 1, delay: 3 },
      sheep: { count: 1, delay: 1 },
      superSheep: { count: 1, delay: 3 },
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
  /** The bottle bursting; WR's "Flame-2" row, most likely the petrol bomb's. */
  petrol: wr({ crater: 15, damage: [1, 15], damageRange: [5, 15], push: [5, 45], pushRange: [5, 14], lift: 1.3 }),
  /** WR's DragonBallRound: a small hole, 30 damage to whoever it touches. */
  dragonBall: wr({ crater: 5, damage: [30, 30], damageRange: [10, 10], push: [105, 105], pushRange: [20, 20] }),
  /** No WR rows for these yet: by feel, after Worms Armageddon. */
  holy: wr({ crater: 56, damage: [1, 100], damageRange: [8, 95], push: [5, 280], pushRange: [4, 92], lift: 1.3 }),
  kamikaze: wr({ crater: 30, damage: [1, 50], damageRange: [6, 50], push: [5, 150], pushRange: [4, 48] }),
  sheep: wr({ crater: 40, damage: [1, 70], damageRange: [6, 65], push: [5, 190], pushRange: [4, 62], lift: 1.3 }),
  /** A shotgun pellet: 25 to the worm it hits. */
  shotgun: {
    radius: 5,
    damage: [25, 25],
    damageRange: [10, 10],
    push: [60, 60],
    pushRange: [12, 12],
    lift: 1,
    waterPush: 0.2,
  },
  /** An Uzi bullet; WR's UziRound: a pin-prick hole, 2 damage and a little push each. */
  uzi: { radius: 1.5, damage: [2, 2], damageRange: [10, 10], push: [10, 10], pushRange: [12, 12], lift: 0, waterPush: 0.2 },
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
  /** Swing along the aim (bat), or this many degrees above straight ahead (prod, fire punch). */
  aimed: boolean;
  angle?: number;
  /** The attacker leaps up at this speed as it strikes (fire punch). */
  rise?: number;
}

/**
 * The prod is measured: it pokes a worm about 0.75–1 worm height away up and over at ~85 px/s,
 * ~55° above horizontal. The bat's numbers are WR's table; the fire punch's damage is WR's
 * "Flame" row (30), with the dragon ball's push.
 */
export const MELEE: Record<'bat' | 'prod' | 'firePunch', Melee> = {
  bat: { reach: 16 + 10 * WR_SCALE, damage: 30, push: 200, aimed: true },
  prod: { reach: 18, damage: 0, push: 40, aimed: false, angle: 55 },
  firePunch: { reach: 20, damage: 30, push: 105, aimed: false, angle: 75, rise: 150 },
};

/**
 * Guns: how many times Space fires in one go (the shotgun's two shots), bullets per shot,
 * ticks between bullets, and how much they spread.
 */
export interface Gun {
  shots: number;
  bullets: number;
  interval: number;
  spread: number;
  blast: Blast;
}

export const GUNS: Record<'shotgun' | 'uzi', Gun> = {
  shotgun: { shots: 2, bullets: 1, interval: 0, spread: 0, blast: BLASTS.shotgun },
  uzi: { shots: 1, bullets: 25, interval: 3, spread: 0.06, blast: BLASTS.uzi },
};

/**
 * Air strike: this many missiles, this far apart, starting this far above the map and flying
 * in a straight line (no gravity or wind) from the side the worm faces.
 */
export const AIRSTRIKE = { missiles: 5, spacing: 18, height: 80, vx: 160, vy: 380 };

/** What weapon handling needs from the world. */
export interface WeaponContext {
  spawn(launch: Launch): void;
  /** Random number in 0..1 from the world's seeded sequence. */
  rng(): number;
  /** Swings a melee weapon from `worm` along (dirX, dirY). */
  hit(worm: Worm, dirX: number, dirY: number, melee: Melee): void;
  /** Fires a bullet from (x, y) along (dirX, dirY): it goes off where it first hits something. */
  shoot(worm: Worm, x: number, y: number, dirX: number, dirY: number, blast: Blast): void;
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

/** The worm's aim as a unit vector, taking the way it faces into account. */
function aimDirection(worm: Worm, spread = 0): { x: number; y: number } {
  const angle = worm.aim + spread;
  return { x: Math.cos(angle) * worm.facing, y: -Math.sin(angle) };
}

/**
 * The active worm's weapon controls, WR's: pick a weapon, 1–5 to set a fuse, Tab (Toggle) to
 * cycle the fuse, flip the air strike's direction or turn the girder, Space to fire (hold to
 * charge), Enter (AltFire) to drop the selected weapon while on the rope, parachute or jet
 * pack, and a click on the map for the air strike, teleport, girder and homing missile. With
 * `canFire` false (retreat time) only the rope works, plus a parachute or jet pack already in
 * use; `canUse` says whether the team may use the selected utility at all.
 */
export function useWeapons(worm: Worm, input: WormInput, ctx: WeaponContext, canFire = true, canUse = canFire): void {
  // Mid-burst (between shotgun shots too) the gun stays in hand.
  if (worm.gun) return fireGun(worm, input, ctx, canFire);
  if (worm.kamikaze) return;
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

/** Air strike, teleport and girder go where the map was clicked; the homing missile aims there. */
function useTarget(worm: Worm, target: { x: number; y: number }, ctx: WeaponContext): void {
  if (worm.weapon === 'airstrike') {
    if (worm.grounded) callStrike(worm, target.x, ctx);
  } else if (worm.weapon === 'teleport') {
    if (ctx.teleport(worm, target.x, target.y)) ctx.weaponUsed('teleport');
  } else if (worm.weapon === 'girder') {
    if (ctx.placeGirder(worm, target.x, target.y, girderRadians(worm.girderAngle))) ctx.weaponUsed('girder');
  } else if (WEAPONS[worm.weapon].needsTarget) {
    worm.marker = { x: target.x, y: target.y };
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
  if (spec.needsTarget && !worm.marker) return; // click the map first
  if (spec.use === 'throw') worm.charge = 0;
  else if (spec.use === 'place') place(worm, ctx);
  else if (spec.use === 'melee') swing(worm, MELEE[worm.weapon as keyof typeof MELEE], ctx);
  else if (spec.use === 'shoot') shoot(worm, ctx);
  else if (spec.use === 'gun') {
    const gun = GUNS[worm.weapon as keyof typeof GUNS];
    worm.gun = { shots: gun.shots - 1, bullets: gun.bullets, cooldown: 0 }; // first bullet next tick
  } else if (spec.use === 'kamikaze') {
    const dir = aimDirection(worm);
    worm.kamikaze = { dx: dir.x, dy: dir.y, left: PHYS.kamikazeRange, hit: [] };
    worm.grounded = false;
    ctx.weaponUsed(worm.weapon);
  }
}

/** Charge speeds by what's launched; the rest are thrown at grenade speed. */
const LAUNCH_SPEED: Partial<Record<ProjectileKind, () => number>> = {
  shell: () => PHYS.bazookaSpeed,
  homing: () => PHYS.bazookaSpeed,
};

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
  const dir = aimDirection(worm);
  const speed = power * (LAUNCH_SPEED[kind]?.() ?? PHYS.grenadeSpeed);
  const offset = PHYS.wormRadius + 4; // start clear of the worm
  ctx.spawn({
    kind,
    x: worm.x + dir.x * offset,
    y: worm.y + dir.y * offset,
    vx: dir.x * speed,
    vy: dir.y * speed,
    fuse: worm.fuse,
    target: kind === 'homing' ? worm.marker : undefined,
  });
  if (kind === 'homing') worm.marker = null;
  ctx.weaponUsed(worm.weapon);
}

/**
 * Mines, dynamite, the old woman and sheep are set down just in front of the worm. A sheep is
 * steered from then on; its ammo goes now, but retreat time only starts when it goes off.
 */
function place(worm: Worm, ctx: WeaponContext): void {
  const spec = WEAPONS[worm.weapon];
  ctx.spawn({
    kind: spec.projectile!,
    x: worm.x + worm.facing * (PHYS.wormRadius + 5),
    y: worm.y,
    vx: worm.facing * 30,
    vy: -50,
    owner: worm.id,
  });
  if (spec.remote) ctx.utilityUsed(worm.weapon);
  else ctx.weaponUsed(worm.weapon);
}

/** The dragon ball: a fireball straight along the aim. */
function shoot(worm: Worm, ctx: WeaponContext): void {
  const dir = aimDirection(worm);
  const offset = PHYS.wormRadius + 6;
  ctx.spawn({
    kind: WEAPONS[worm.weapon].projectile!,
    x: worm.x + dir.x * offset,
    y: worm.y + dir.y * offset,
    vx: dir.x * PHYS.dragonBallSpeed,
    vy: dir.y * PHYS.dragonBallSpeed,
    fuse: PHYS.dragonBallLife,
  });
  ctx.weaponUsed(worm.weapon);
}

function swing(worm: Worm, melee: Melee, ctx: WeaponContext): void {
  const angle = melee.aimed ? worm.aim : ((melee.angle ?? 0) * Math.PI) / 180;
  const dirX = Math.cos(angle) * worm.facing;
  const dirY = -Math.sin(angle);
  ctx.hit(worm, dirX, dirY, melee);
  if (melee.rise) {
    worm.vx = 0;
    worm.vy = -melee.rise;
    worm.grounded = false;
    worm.afterTouch = 0;
  }
  ctx.weaponUsed(worm.weapon);
}

/**
 * A gun in hand: bullets go out every `interval` ticks along the aim (which can still move),
 * and the shotgun waits for Space again between its shots. ← → turn the worm round. When the
 * last bullet is out, or the worm is knocked off its feet, the weapon counts as used.
 */
function fireGun(worm: Worm, input: WormInput, ctx: WeaponContext, canFire: boolean): void {
  const gun = worm.gun!;
  const spec = GUNS[worm.weapon as keyof typeof GUNS];
  if (input.left !== input.right) worm.facing = input.left ? -1 : 1;
  if (!worm.grounded) return finishGun(worm, ctx);
  if (gun.bullets === 0) {
    if (!input.fire || !canFire) return;
    gun.shots--;
    gun.bullets = spec.bullets;
    gun.cooldown = 0;
  }
  if (gun.cooldown > 0) {
    gun.cooldown--;
    return;
  }
  const dir = aimDirection(worm, (ctx.rng() * 2 - 1) * spec.spread);
  const offset = PHYS.wormRadius + 1;
  ctx.shoot(worm, worm.x + dir.x * offset, worm.y + dir.y * offset, dir.x, dir.y, spec.blast);
  gun.bullets--;
  gun.cooldown = spec.interval - 1;
  if (gun.bullets === 0 && gun.shots === 0) finishGun(worm, ctx);
}

function finishGun(worm: Worm, ctx: WeaponContext): void {
  worm.gun = null;
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
