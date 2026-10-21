/**
 * The relay's own messages, shared by client and server. Game messages travel inside `data`;
 * the relay never looks at them, it only forwards them within a room.
 *
 * Connect to /parties/room/<CODE>?name=<name>[&host=1]. The connection id (partysocket's `id`
 * option) is the player id, so a player keeps it when the socket reconnects.
 */

export const RELAY_PARTY = 'room';
export const MAX_PLAYERS = 4;

export interface Peer {
  id: string;
  name: string;
  host: boolean;
}

/** Client → relay: deliver `data` to one player or to everyone else in the room. */
export interface RelaySend {
  to: 'all' | string;
  data: unknown;
}

/** Relay → client. */
export type RelayReceive =
  | { type: 'peers'; peers: Peer[] }
  | { type: 'message'; from: string; data: unknown }
  | { type: 'error'; reason: RelayError };

/**
 * no-host: nobody is hosting this code (wrong code, or the host left).
 * host-taken: someone else is already hosting this code. room-full: MAX_PLAYERS reached.
 */
export type RelayError = 'no-host' | 'host-taken' | 'room-full';
