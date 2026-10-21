import { DT, PHYS } from './constants';
import type { Launch } from './projectiles';
import { releaseRope, shootRope } from './rope';
import type { Worm, WormInput } from './worm';

export type WeaponId = 'rope' | 'bazooka' | 'grenade' | 'mine';

/**
 * An explosion: crater radius, damage at the centre, how far damage and knockback reach
 * (both fade to nothing at `reach`), and knockback strength (1 = normal).
 */
export interface Blast {
  radius: number;
  damage: number;
  reach: number;
  push: number;
}

export interface WeaponSpec {
  name: string;
  /** Hold Space to charge, release to fire. */
  charged: boolean;
  /** Can be dropped with Enter while on the ninja rope. */
  droppable: boolean;
  /** Tab (Toggle) cycles its fuse. */
  hasFuse: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  rope: { name: 'Ninja Rope', charged: false, droppable: false, hasFuse: false },
  bazooka: { name: 'Bazooka', charged: true, droppable: false, hasFuse: false },
  grenade: { name: 'Grenade', charged: true, droppable: true, hasFuse: true },
  mine: { name: 'Mine', charged: false, droppable: true, hasFuse: false },
};

export const WEAPON_ORDER = Object.keys(WEAPONS) as WeaponId[];

/** Grenade fuse choices in seconds. */
export const FUSES = [1, 2, 3, 4, 5];

/**
 * The bazooka is Worms Revolution's (crater 26, damage 45, reach 47 in its level pixels)
 * scaled to our worm size. The export had no grenade or mine values, so those are by feel.
 */
export const BLASTS = {
  bazooka: { radius: 21, damage: 45, reach: 39, push: 1 },
  grenade: { radius: 21, damage: 45, reach: 39, push: 1 },
  mine: { radius: 24, damage: 50, reach: 44, push: 1.2 },
} satisfies Record<string, Blast>;

/** What weapon handling needs from the world. */
export interface WeaponContext {
  spawn(launch: Launch): void;
  /** Picks new wind; for now it changes after every shot (later: every turn). */
  changeWind(): void;
}

/**
 * The active worm's weapon controls: pick a weapon, Tab to cycle the fuse, Space to fire
 * (hold to charge), and Enter to drop the selected weapon while on the rope.
 */
export function useWeapons(worm: Worm, input: WormInput, ctx: WeaponContext): void {
  if (input.select) {
    worm.weapon = input.select;
    worm.charge = null;
  }
  if (input.toggle && WEAPONS[worm.weapon].hasFuse) {
    worm.fuse = FUSES[(FUSES.indexOf(worm.fuse) + 1) % FUSES.length];
  }

  // On the rope (or flying after letting go), Enter drops a weapon instead of jumping.
  const roping = worm.rope?.phase === 'attached' || worm.ropeChain;
  if (input.jump && roping && WEAPONS[worm.weapon].droppable) drop(worm, ctx);

  if (worm.charge !== null) charge(worm, input, ctx);
  else if (input.fire) pressFire(worm, ctx);
}

function pressFire(worm: Worm, ctx: WeaponContext): void {
  if (worm.rope?.phase === 'attached') return releaseRope(worm);
  if (worm.rope) return; // hook still flying
  // After letting go of the rope, Space shoots it again whatever is selected.
  if (worm.weapon === 'rope' || worm.ropeChain) return shootRope(worm);
  if (!worm.grounded) return; // other weapons need solid ground
  if (WEAPONS[worm.weapon].charged) worm.charge = 0;
  else if (worm.weapon === 'mine') placeMine(worm, ctx);
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
  const dirX = Math.cos(worm.aim) * worm.facing;
  const dirY = -Math.sin(worm.aim);
  const speed = power * (worm.weapon === 'bazooka' ? PHYS.bazookaSpeed : PHYS.grenadeSpeed);
  const offset = PHYS.wormRadius + 4; // start clear of the worm
  ctx.spawn({
    kind: worm.weapon === 'bazooka' ? 'shell' : 'grenade',
    x: worm.x + dirX * offset,
    y: worm.y + dirY * offset,
    vx: dirX * speed,
    vy: dirY * speed,
    fuse: worm.fuse,
  });
  ctx.changeWind();
}

/** Mines are set down just in front of the worm. */
function placeMine(worm: Worm, ctx: WeaponContext): void {
  ctx.spawn({ kind: 'mine', x: worm.x + worm.facing * (PHYS.wormRadius + 5), y: worm.y, vx: worm.facing * 30, vy: -50 });
  ctx.changeWind();
}

/** Lets go of a grenade or mine below the worm; it keeps the worm's speed. */
function drop(worm: Worm, ctx: WeaponContext): void {
  ctx.spawn({
    kind: worm.weapon === 'mine' ? 'mine' : 'grenade',
    x: worm.x,
    y: worm.y + PHYS.wormRadius + 4,
    vx: worm.vx,
    vy: worm.vy,
    fuse: worm.fuse,
  });
  ctx.changeWind();
}
