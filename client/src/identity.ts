// Persistent player identity stored in localStorage.
// playerId + token form an auth pair the server uses to prevent
// impersonation and to support reconnection / state recovery.

export interface Identity {
  playerId: string;
  token: string;
  name: string;
  avatar: string; // emoji or small data-URL
}

const KEY = 'uno.identity.v1';

const EMOJI_AVATARS = ['😎', '🤠', '🦊', '🐼', '🦁', '🐸', '👻', '🤖', '🐙', '🦄', '🍕', '🎩'];

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const id = JSON.parse(raw) as Identity;
      if (id.playerId && id.token) return id;
    }
  } catch { /* fall through */ }
  const fresh: Identity = {
    playerId: uuid(),
    token: uuid() + uuid().slice(0, 8),
    name: '',
    avatar: EMOJI_AVATARS[Math.floor(Math.random() * EMOJI_AVATARS.length)]
  };
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

export function saveIdentity(partial: Partial<Identity>): Identity {
  const next = { ...loadIdentity(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function resetIdentity(): Identity {
  localStorage.removeItem(KEY);
  return loadIdentity();
}

export { EMOJI_AVATARS };
