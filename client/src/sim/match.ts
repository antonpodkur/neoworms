import { TICK_RATE } from './constants';
import type { GeneratedMap } from './mapgen';
import { wormName } from './names';
import { createWorld, type SimEvent, type World, type WorldState } from './world';
import { NO_INPUT, type Worm, type WormInput } from './worm';

export interface MatchSettings {
  /** Team names, 2–4 of them. */
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
}

export const DEFAULT_SETTINGS: MatchSettings = {
  teams: ['Red', 'Blue'],
  wormsPerTeam: 4,
  wormHp: 100,
  turnTime: 45,
  retreatTime: 3,
  suddenDeathAfter: 10,
  waterRise: 20,
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
  private events: MatchEvent[] = [];

  constructor(
    readonly world: World,
    readonly settings: MatchSettings,
  ) {
    this.nextWormIndex = settings.teams.map(() => 0);
  }

  /** The worm the player controls right now, if any. */
  get activeWorm(): Worm | undefined {
    return this.phase === 'playing' || this.phase === 'retreat' ? this.world.activeWorm : undefined;
  }

  /** Begins the first turn. */
  start(): void {
    if (this.phase === 'waiting') this.nextTurn();
  }

  /** Advances one tick; `input` drives the active worm while it's in control. */
  step(input: WormInput): void {
    if (this.phase === 'waiting') return;
    const inControl = this.phase === 'playing' || this.phase === 'retreat';
    this.world.step(inControl ? input : NO_INPUT, this.phase === 'playing');
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
  }

  /** Returns and clears world and match events since the last call. */
  drainEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private onWorldEvent(e: SimEvent): void {
    this.events.push(e);
    if (e.type === 'weaponUsed' && this.phase === 'playing') {
      this.phase = 'retreat';
      this.ticksLeft = Math.round(this.settings.retreatTime * TICK_RATE);
    }
    if (this.phase !== 'playing' && this.phase !== 'retreat') return;
    // Getting hurt ends your turn on the spot, and so does wiping out the last enemy.
    const hurt = (e.type === 'damage' || e.type === 'death') && e.wormId === this.world.activeWormId;
    if (hurt || (e.type === 'death' && this.teamsStanding().length <= 1)) this.endTurn();
  }

  private teamsStanding(): number[] {
    return this.settings.teams
      .map((_, team) => team)
      .filter((team) => this.world.worms.some((w) => w.alive && w.team === team));
  }

  private endTurn(): void {
    this.phase = 'settling';
    this.settleTicks = 0;
    this.stillTicks = 0;
    const worm = this.world.worms[this.world.activeWormId];
    if (worm) {
      worm.rope = null; // let go; it falls with everything else
      worm.charge = null;
      worm.pendingJump = null;
    }
  }

  /** Nothing moving: worms standing, grenades and shells gone, mines lying still and quiet. */
  private isSettled(): boolean {
    const wormsStill = this.world.worms.every((w) => !w.alive || (w.grounded && w.rope === null));
    const projectilesStill = this.world.projectiles.every(
      (p) => p.kind === 'mine' && p.resting && p.fuseTicks === null,
    );
    return wormsStill && projectilesStill;
  }

  private finishTurn(): void {
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
      this.world.activeWormId = worm.id;
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
      if (worms[index].alive) {
        this.nextWormIndex[team] = index + 1;
        return worms[index];
      }
    }
    return undefined;
  }
}

/** Builds the world for these settings (worms spread across the map, mines) and its match. */
export function createMatch(map: GeneratedMap, seed: number, settings: MatchSettings): Match {
  const teams = settings.teams.map((name, t) => ({
    name,
    worms: Array.from({ length: settings.wormsPerTeam }, (_, i) => wormName(t, i)),
  }));
  return new Match(createWorld(map, seed, teams, settings.wormHp), settings);
}
