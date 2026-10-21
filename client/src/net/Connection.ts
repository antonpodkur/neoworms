import PartySocket from 'partysocket';
import { RELAY_PARTY, type Peer, type RelayError, type RelayReceive, type RelaySend } from '../../../shared/relay';

/** The relay: `npm run dev:server` locally, or the deployed Worker set in VITE_RELAY_HOST. */
const RELAY_HOST: string = import.meta.env.VITE_RELAY_HOST || 'localhost:8787';

export interface ConnectionHandlers {
  onPeers(peers: Peer[]): void;
  onMessage(from: string, data: unknown): void;
  onError(reason: RelayError): void;
}

/**
 * A player's link to a room on the relay. Reconnects by itself after network hiccups,
 * keeping the same player id.
 */
export class Connection {
  private readonly socket: PartySocket;

  constructor(
    readonly playerId: string,
    room: string,
    name: string,
    host: boolean,
    handlers: ConnectionHandlers,
  ) {
    this.socket = new PartySocket({
      host: RELAY_HOST,
      party: RELAY_PARTY,
      room,
      id: playerId,
      query: host ? { name, host: '1' } : { name },
    });
    this.socket.addEventListener('message', (e: MessageEvent<string>) => {
      const message = JSON.parse(e.data) as RelayReceive;
      if (message.type === 'peers') handlers.onPeers(message.peers);
      else if (message.type === 'message') handlers.onMessage(message.from, message.data);
      else {
        this.socket.close(); // stop it from reconnecting to a room that refused us
        handlers.onError(message.reason);
      }
    });
  }

  /** Sends to one player, or to everyone else in the room. */
  send(to: 'all' | string, data: unknown): void {
    this.socket.send(JSON.stringify({ to, data } satisfies RelaySend, roundNumbers));
  }

  close(): void {
    this.socket.close();
  }
}

/** Two decimals are plenty over the wire and make game states a lot smaller. */
function roundNumbers(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value;
}
