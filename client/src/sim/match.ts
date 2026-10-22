import { TICK_RATE } from './constants';
import type { GeneratedMap } from './mapgen';
import { wormName } from './names';
import { mulberry32 } from './rng';
import { isUsable, SCHEMES, WEAPON_ORDER, WEAPONS, type SchemeId, type WeaponId, type WeaponStatus } from './weapons';
import { createWorld, type SimEvent, type World, type WorldState } from './world';
import { NO_INPUT, type Worm, type WormInput } from './worm';

export interface MatchSettings {
  /** Team names, 2–8 of them. */
  teams: string[];
  wormsPerTeam: number;
  wormHp: number;
  /** Seconds per turn; 0 means no limit. */
  turnTime: number;
  /** Seconds to get away after using a weapon. */
  retreatTime: number;
  /** Minutes of play before sudden death; 0 means never. */
  suddenDeathAfter: number;
  /** Pixels the water rises at the end of each turn once sudden death starts. */
  waterRise: number;
  /** Which weapons each team gets, how many, and from which turn. */
  scheme: SchemeId;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  teams: ['Red', 'Blue'],
  wormsPerTeam: 4,
  wormHp: 100,
  turnTime: 45,
  retreatTime: 3,
  suddenDeathAfter: 10,
  waterRise: 20,
  scheme: 'standard',
};

/**
 * waiting: set up, first turn not started. playing: the active worm can do anything.
 * retreat: it used a weapon and has a few seconds to get away (the rope still works).
 * settling: the turn is over; waiting for things to stop moving. over: one team (or none) left.
 */
export type MatchPhase = 'waiting' | 'playing' | 'retreat' | 'settling' | 'over';

export type MatchEvent =
  | SimEvent
  | { type: 'turnStart'; team: number; wormId: number }
  | { type: 'suddenDeath' }
  | { type: 'gameOver'; winner: number | null };

/** Everything about a match that changes during play, world included (terrain aside). */
export interface MatchState {
  world: WorldState;
  phase: MatchPhase;
  turnTeam: number;
  /** null stands for Infinity (no time limit), which JSON can't carry. */
  ticksLeft: number | null;
  elapsedTicks: number;
  suddenDeath: boolean;
  winner: number | null;
  settleTicks: number;
  stillTicks: number;
  waterRisen: boolean;
  nextWormIndex: number[];
  ammo: Ammo[];
  teamTurns: number[];
  selecting: number | null;
}

/** Shots left per weapon for one team; null is unlimited. */
type Ammo = Record<WeaponId, number | null>;

export interface MatchOptions {
  /** The team that takes the first turn (default 0); the rest follow in order. */
  firstTeam?: number;
  /** The map has a rock roof, so weapons that come down from the sky can't be used. */
  enclosed?: boolean;
}

/** Everything must stay still this long before the next turn starts. */
const SETTLE_TICKS = Math.round(0.5 * TICK_RATE);
/** Stop waiting for things to settle after this long, whatever is still moving. */
const MAX_SETTLE_TICKS = 8 * TICK_RATE;

/**
 * The rules of a hot-seat match on top of the World: whose turn it is, turn and retreat
 * timers, waiting for the dust to settle, sudden death and the winner. Pure TypeScript, so
 * online play can run the same rules on the host.
 */
export class Match {
  phase: MatchPhase = 'waiting';
  /** Team whose turn it is; -1 before the first turn. */
  turnTeam = -1;
  /** Ticks left of the turn (or of retreat time). Infinity when turns have no time limit. */
  ticksLeft = 0;
  elapsedTicks = 0;
  suddenDeath = false;
  /** The winning team once the match is over; null for a draw. */
  winner: number | null = null;
  private settleTicks = 0;
  private stillTicks = 0;
  private waterRisen = false;
  /** Per team, which of its worms goes next. */
  private readonly nextWormIndex: number[];
  /** Per team, shots left of each weapon and how many turns it has started. */
  private readonly ammo: Ammo[];
  private readonly teamTurns: number[];
  /**
   * Worm Select: the team's worm highlighted to take over the turn, while the player picks
   * one (Space starts picking, Tab moves on, Space again confirms); null otherwise.
   */
  selecting: number | null = null;
  private events: MatchEvent[] = [];

  constructor(
    readonly world: World,
    readonly settings: MatchSettings,
    private readonly options: MatchOptions = {},
  ) {
    this.nextWormIndex = settings.teams.map(() => 0);
    const scheme = SCHEMES[settings.scheme ?? 'standard'].ammo;
    this.ammo = settings.teams.map(
      () => Object.fromEntries(WEAPON_ORDER.map((id) => [id, scheme[id].count])) as Ammo,
    );
    this.teamTurns = settings.teams.map(() => 0);
  }

  /** What a team has of a weapon: shots left, how many of its turns until it's ready, and whether the map allows it. */
  weaponStatus(team: number, weapon: WeaponId): WeaponStatus {
    const { delay } = SCHEMES[this.settings.scheme ?? 'standard'].ammo[weapon];
    // Turns the team had before its current one (or before its next, if it's not its turn).
    const before = (this.teamTurns[team] ?? 0) - (team === this.turnTeam ? 1 : 0);
    return {
      ammo: this.ammo[team]?.[weapon] ?? null,
      wait: Math.max(0, delay - before),
      blocked: !!this.options.enclosed && WEAPONS[weapon].use === 'strike',
    };
  }

  /** The worm the player controls right now, if any. */
  get activeWorm(): Worm | undefined {
    return this.phase === 'playing' || this.phase === 'retreat' ? this.world.activeWorm : undefined;
  }

  /** Begins the first turn. */
  start(): void {
    if (this.phase !== 'waiting') return;
    this.turnTeam = (this.options.firstTeam ?? 0) - 1; // nextTurn moves on to the team after this one
    this.nextTurn();
  }

  /** Advances one tick; `input` drives the active worm while it's in control. */
  step(input: WormInput): void {
    if (this.phase === 'waiting') return;
    const inControl = this.phase === 'playing' || this.phase === 'retreat';
    let control = inControl ? input : NO_INPUT;
    // Weapons the team has run out of, or can't use yet, can't be picked or fired.
    if (control.select && !this.usable(control.select)) control = { ...control, select: null };
    const weapon = control.select ?? this.world.activeWorm?.weapon;
    control = this.wormSelect(control, weapon);
    const ok = !weapon || this.usable(weapon);
    this.world.step(control, this.phase === 'playing' && ok, inControl && ok);
    this.elapsedTicks++;
    for (const e of this.world.drainEvents()) this.onWorldEvent(e);

    if (this.phase === 'playing' || this.phase === 'retreat') {
      if (--this.ticksLeft <= 0) this.endTurn();
    } else if (this.phase === 'settling') {
      this.settleTicks++;
      this.stillTicks = this.isSettled() ? this.stillTicks + 1 : 0;
      if (this.stillTicks >= SETTLE_TICKS || this.settleTicks >= MAX_SETTLE_TICKS) this.finishTurn();
    }
  }

  /** Ends the current turn right away (e.g. its player left an online game). */
  forceEndTurn(): void {
    if (this.phase === 'playing' || this.phase === 'retreat') this.endTurn();
  }

  snapshot(): MatchState {
    return {
      world: this.world.snapshot(),
      phase: this.phase,
      turnTeam: this.turnTeam,
      ticksLeft: Number.isFinite(this.ticksLeft) ? this.ticksLeft : null,
      elapsedTicks: this.elapsedTicks,
      suddenDeath: this.suddenDeath,
      winner: this.winner,
      settleTicks: this.settleTicks,
      stillTicks: this.stillTicks,
      waterRisen: this.waterRisen,
      nextWormIndex: [...this.nextWormIndex],
      ammo: this.ammo.map((a) => ({ ...a })),
      teamTurns: [...this.teamTurns],
      selecting: this.selecting,
    };
  }

  /** Takes over a snapshot from another browser (the terrain must already match). */
  restore(state: MatchState): void {
    this.world.restore(state.world);
    this.phase = state.phase;
    this.turnTeam = state.turnTeam;
    this.ticksLeft = state.ticksLeft ?? Infinity;
    this.elapsedTicks = state.elapsedTicks;
    this.suddenDeath = state.suddenDeath;
    this.winner = state.winner;
    this.settleTicks = state.settleTicks;
    this.stillTicks = state.stillTicks;
    this.waterRisen = state.waterRisen;
    this.nextWormIndex.splice(0, this.nextWormIndex.length, ...state.nextWormIndex);
    this.ammo.splice(0, this.ammo.length, ...state.ammo);
    this.teamTurns.splice(0, this.teamTurns.length, ...state.teamTurns);
    this.selecting = state.selecting ?? null;
  }

  /** Returns and clears world and match events since the last call. */
  drainEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private onWorldEvent(e: SimEvent): void {
    this.events.push(e);
    if ((e.type === 'weaponUsed' && !e.ammoTaken) || e.type === 'utilityUsed') {
      const left = this.ammo[this.turnTeam]?.[e.weapon];
      if (left != null) this.ammo[this.turnTeam][e.weapon] = Math.max(0, left - 1);
    }
    if (e.type === 'weaponUsed' && this.phase === 'playing') {
      this.phase = 'retreat';
      this.ticksLeft = Math.round(this.settings.retreatTime * TICK_RATE);
    }
    if (this.phase !== 'playing' && this.phase !== 'retreat') return;
    if (e.type === 'skipGo') return this.endTurn();
    if (e.type === 'surrender') {
      this.world.removeTeam(e.team);
      return this.endTurn();
    }
    // Getting hurt ends your turn on the spot, and so does wiping out the last enemy.
    const harm = e.type === 'damage' || e.type === 'death';
    const hurt = harm && e.wormId === this.world.activeWormId;
    if (hurt || (harm && this.teamsStanding().length <= 1)) this.endTurn();
  }

  /**
   * Worm Select, before the world sees the input: with it in hand while the turn is still
   * free, Space starts picking (the active worm highlighted), Tab moves on to the team's next
   * living worm, and Space again hands the turn to the highlighted one. Returns the input
   * without the keys it used.
   */
  private wormSelect(input: WormInput, weapon: WeaponId | undefined): WormInput {
    const active = this.world.activeWorm;
    if (weapon !== 'wormSelect' || this.phase !== 'playing' || !active) {
      this.selecting = null;
      return input;
    }
    if (!input.fire && !input.toggle) return input;
    const team = this.world.worms.filter((w) => w.team === active.team && w.alive && w.hp > 0);
    if (this.selecting === null) {
      if (input.fire && this.usable('wormSelect') && team.length > 1) this.selecting = active.id;
    } else if (input.toggle) {
      const at = team.findIndex((w) => w.id === this.selecting);
      this.selecting = team[(at + 1) % team.length].id;
    } else if (input.fire) {
      const chosen = this.selecting;
      this.selecting = null;
      if (chosen !== active.id) {
        this.world.activeWormId = chosen;
        this.world.utilityUsed('wormSelect');
      }
    }
    return { ...input, fire: false, fireHeld: false, toggle: false };
  }

  /** Whether the team whose turn it is can use this weapon now. */
  private usable(weapon: WeaponId): boolean {
    return this.turnTeam >= 0 && isUsable(this.weaponStatus(this.turnTeam, weapon));
  }

  /** Teams with a worm that still has health (worms at 0 HP blow up when the turn ends). */
  private teamsStanding(): number[] {
    return this.settings.teams
      .map((_, team) => team)
      .filter((team) => this.world.worms.some((w) => w.alive && w.hp > 0 && w.team === team));
  }

  private endTurn(): void {
    this.phase = 'settling';
    this.settleTicks = 0;
    this.stillTicks = 0;
    const worm = this.world.worms[this.world.activeWormId];
    if (worm) {
      worm.rope = null; // let go; it falls with everything else
      worm.charge = null;
      worm.gun = null; // a shotgun's second shot is lost
      worm.pendingJump = null;
      worm.jetpack = null; // the jet pack cuts out; a parachute stays open until it lands
    }
    this.selecting = null;
  }

  /** Nothing moving: worms standing, grenades and shells gone, mines lying still and quiet. */
  private isSettled(): boolean {
    const wormsStill = this.world.worms.every((w) => !w.alive || (w.grounded && w.slide === 0 && w.rope === null));
    const projectilesStill = this.world.projectiles.every(
      (p) => p.kind === 'mine' && p.resting && p.fuseTicks === null,
    );
    return wormsStill && projectilesStill;
  }

  private finishTurn(): void {
    if (this.world.detonateDying()) {
      // Worms at 0 HP blew up; settle again, their blasts may have finished off others.
      this.settleTicks = 0;
      this.stillTicks = 0;
      return;
    }
    if (this.suddenDeath && !this.waterRisen) {
      // The sea creeps up; settle again so anyone it reaches drowns before the next turn.
      this.waterRisen = true;
      this.world.raiseWater(this.settings.waterRise);
      this.stillTicks = 0;
      return;
    }

    const standing = this.teamsStanding();
    if (standing.length <= 1) {
      this.phase = 'over';
      this.winner = standing[0] ?? null;
      this.events.push({ type: 'gameOver', winner: this.winner });
      return;
    }

    const limit = this.settings.suddenDeathAfter * 60 * TICK_RATE;
    if (!this.suddenDeath && limit > 0 && this.elapsedTicks >= limit) {
      this.suddenDeath = true;
      this.events.push({ type: 'suddenDeath' });
    }
    this.nextTurn();
  }

  /** Hands the turn to the next team that still has worms, and to that team's next worm. */
  private nextTurn(): void {
    const teamCount = this.settings.teams.length;
    for (let i = 1; i <= teamCount; i++) {
      const team = (this.turnTeam + i) % teamCount;
      const worm = this.nextWormOf(team);
      if (!worm) continue;
      this.turnTeam = team;
      this.teamTurns[team]++;
      this.world.activeWormId = worm.id;
      // Holding something this team can't use (yet, or any more): put it away.
      if (!this.usable(worm.weapon)) worm.weapon = this.usable('bazooka') ? 'bazooka' : 'rope';
      this.world.changeWind();
      this.phase = 'playing';
      this.ticksLeft = this.settings.turnTime > 0 ? Math.round(this.settings.turnTime * TICK_RATE) : Infinity;
      this.waterRisen = false;
      this.events.push({ type: 'turnStart', team, wormId: worm.id });
      return;
    }
  }

  /** The team's next living worm in rotation. */
  private nextWormOf(team: number): Worm | undefined {
    const worms = this.world.worms.filter((w) => w.team === team);
    for (let i = 0; i < worms.length; i++) {
      const index = (this.nextWormIndex[team] + i) % worms.length;
      if (worms[index].alive && worms[index].hp > 0) {
        this.nextWormIndex[team] = index + 1;
        return worms[index];
      }
    }
    return undefined;
  }
}

/**
 * Builds the world for these settings (worms spread across the map, mines) and its match.
 * The seed also picks which team goes first, so every player online agrees on it.
 */
export function createMatch(map: GeneratedMap, seed: number, settings: MatchSettings): Match {
  const teams = settings.teams.map((name, t) => ({
    name,
    worms: Array.from({ length: settings.wormsPerTeam }, (_, i) => wormName(t, i)),
  }));
  const firstTeam = Math.floor(mulberry32(seed ^ 0xf125)() * teams.length);
  return new Match(createWorld(map, seed, teams, settings.wormHp), settings, { firstTeam, enclosed: map.enclosed });
}
