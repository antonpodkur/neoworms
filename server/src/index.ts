import { routePartykitRequest, Server, type Connection, type ConnectionContext } from 'partyserver';
import { MAX_PLAYERS, type Peer, type RelayError, type RelayReceive, type RelaySend } from '../../shared/relay';

interface PlayerState {
  name: string;
  host: boolean;
}

/** Biggest message we forward; a full game state is well under this. */
const MAX_MESSAGE_BYTES = 512 * 1024;

/**
 * One game room (a Durable Object per room code). It knows who is connected and forwards
 * messages between them; the game itself runs in the players' browsers. Hibernates while
 * nobody is sending anything, so idle rooms cost nothing.
 */
export class Room extends Server {
  static options = { hibernate: true };

  onConnect(connection: Connection<PlayerState>, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url);
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 16) || 'Player';
    const wantsHost = url.searchParams.get('host') === '1';
    const others = this.players().filter((p) => p.id !== connection.id);

    const error: RelayError | null = wantsHost
      ? others.some((p) => p.host)
        ? 'host-taken'
        : null
      : !others.some((p) => p.host)
        ? 'no-host'
        : others.length >= MAX_PLAYERS
          ? 'room-full'
          : null;
    if (error) {
      send(connection, { type: 'error', reason: error });
      connection.close(4000, error);
      return;
    }

    connection.setState({ name, host: wantsHost });
    this.broadcastPeers();
  }

  onMessage(connection: Connection<PlayerState>, message: string | ArrayBuffer | ArrayBufferView): void {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES || !connection.state) return;
    let parsed: RelaySend;
    try {
      parsed = JSON.parse(message) as RelaySend;
    } catch {
      return;
    }
    const out = JSON.stringify({ type: 'message', from: connection.id, data: parsed.data } satisfies RelayReceive);
    if (parsed.to === 'all') this.broadcast(out, [connection.id]);
    else this.getConnection(parsed.to)?.send(out);
  }

  onClose(): void {
    this.broadcastPeers();
  }

  private players(): Peer[] {
    const peers: Peer[] = [];
    for (const c of this.getConnections<PlayerState>()) {
      if (c.state) peers.push({ id: c.id, name: c.state.name, host: c.state.host });
    }
    return peers;
  }

  private broadcastPeers(): void {
    this.broadcast(JSON.stringify({ type: 'peers', peers: this.players() } satisfies RelayReceive));
  }
}

function send(connection: Connection, message: RelayReceive): void {
  connection.send(JSON.stringify(message));
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) ?? new Response('NeoWorms relay', { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
