import type { Peer, RelayError } from '../../../shared/relay';
import type { Physics } from '../sim/constants';
import type { MatchEvent, MatchSettings, MatchState } from '../sim/match';
import { Connection } from './Connection';

/** How an online match starts; every player builds the same match from it. */
export interface OnlineStart {
  settings: MatchSettings;
  mapId: string;
  seed: number;
  /** Player id that controls each team, in team order. */
  owners: string[];
  /** The host's tuning, so everyone simulates with the same physics. */
  physics: Partial<Physics>;
  /** Fingerprint of the host's terrain; a mismatch means a player's map differs. */
  terrainHash: number;
}

/**
 * Whoever runs the game right now sends one of these ~20 times a second: the state plus
 * everything that happened since the previous frame.
 */
export interface Frame {
  tick: number;
  state: MatchState;
  events: MatchEvent[];
}

/** Game messages between players; the relay only forwards them. */
type GameMessage = ({ type: 'start' } & OnlineStart) | ({ type: 'frame' } & Frame);

const ERRORS: Record<RelayError, string> = {
  'no-host': 'Nobody is hosting that room code.',
  'host-taken': 'That room code is taken; try hosting again.',
  'room-full': 'That game is full.',
};

/**
 * Being in an online room: who's there, the match being played, and the frames arriving
 * from whoever runs it. Outlives scene restarts, so the game can start and rematch inside it.
 */
export class OnlineSession {
  peers: Peer[] = [];
  /** The match being played, once the host has started one. */
  start: OnlineStart | null = null;
  error: string | null = null;
  /** Called whenever peers, errors or the match change (the lobby re-renders). */
  onChange: () => void = () => {};
  /** Called on guests when the host starts a match. */
  onStart: (start: OnlineStart) => void = () => {};
  private readonly connection: Connection;
  private frames: Frame[] = [];

  constructor(
    readonly code: string,
    readonly name: string,
    readonly isHost: boolean,
  ) {
    this.connection = new Connection(playerId(), code, name, isHost, {
      onPeers: (peers) => {
        this.peers = peers;
        this.onChange();
      },
      onMessage: (from, data) => this.receive(from, data as GameMessage),
      onError: (reason) => {
        this.error = ERRORS[reason];
        this.onChange();
      },
    });
  }

  get myId(): string {
    return this.connection.playerId;
  }

  get hostId(): string | undefined {
    return this.peers.find((p) => p.host)?.id;
  }

  isPresent(playerId: string): boolean {
    return this.peers.some((p) => p.id === playerId);
  }

  /** Host: tells everyone the match is starting. */
  sendStart(start: OnlineStart): void {
    this.start = start;
    this.frames = [];
    this.connection.send('all', { type: 'start', ...start } satisfies GameMessage);
  }

  sendFrame(frame: Frame): void {
    this.connection.send('all', { type: 'frame', ...frame } satisfies GameMessage);
  }

  /** Frames received since the last call, oldest first. */
  takeFrames(): Frame[] {
    const frames = this.frames;
    this.frames = [];
    return frames;
  }

  close(): void {
    this.connection.close();
  }

  private receive(from: string, message: GameMessage): void {
    if (message.type === 'start' && from === this.hostId) {
      const { type: _, ...start } = message;
      this.start = start;
      this.frames = [];
      this.onStart(start);
    } else if (message.type === 'frame') {
      const { type: _, ...frame } = message;
      this.frames.push(frame);
    }
  }
}

/** Room codes are 4 letters, without ones that are easy to mix up (I, O). */
export function newRoomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

/** A random id for this tab, kept across reloads of the same tab. */
function playerId(): string {
  const key = 'neoworms.playerId';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

let current: OnlineSession | null = null;

export function currentSession(): OnlineSession | null {
  return current;
}

export function openSession(code: string, name: string, isHost: boolean): OnlineSession {
  current?.close();
  current = new OnlineSession(code, name, isHost);
  return current;
}

export function closeSession(): void {
  current?.close();
  current = null;
}
