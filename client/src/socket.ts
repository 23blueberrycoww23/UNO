import { io, Socket } from 'socket.io-client';
import { loadIdentity, resetIdentity } from './identity';

// Same-origin connection: the Vite dev proxy (dev) or Express static
// hosting (prod) routes /socket.io to the game server.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const identity = loadIdentity();
  socket = io({
    auth: { playerId: identity.playerId, token: identity.token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000
  });
  socket.on('connect_error', (err) => {
    // Identity collision (e.g. copied localStorage): mint a fresh identity.
    if (err.message === 'BAD_AUTH') {
      const fresh = resetIdentity();
      (socket!.auth as Record<string, string>).playerId = fresh.playerId;
      (socket!.auth as Record<string, string>).token = fresh.token;
      socket!.connect();
    }
  });
  return socket;
}

/** emit with ack as a promise */
export function request<T = { ok: boolean; error?: string;[k: string]: unknown }>(
  event: string,
  payload: unknown = {}
): Promise<T> {
  return new Promise((resolve) => {
    getSocket().timeout(8000).emit(event, payload, (err: unknown, res: T) => {
      if (err) resolve({ ok: false, error: 'Request timed out' } as T);
      else resolve(res);
    });
  });
}
