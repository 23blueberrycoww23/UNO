// End-to-end test over real Socket.IO connections against a running server.
// Usage: node test-e2e.mjs   (requires `npm start` running)

import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
const ok = (msg) => console.log('  ✓', msg);

function connect(name) {
  const socket = io(URL, {
    auth: { playerId: `test-${name}-${Date.now()}`, token: 'secret-token-' + name + '-0123456789' }
  });
  socket.req = (event, payload = {}) =>
    new Promise((res) => socket.timeout(5000).emit(event, payload, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)));
  socket.next = (event) => new Promise((res) => socket.once(event, res));
  return socket;
}

const A = connect('alice');
const B = connect('bob');
await Promise.all([A.next('connect'), B.next('connect')]);
ok('both clients connected');

// invalid auth must be rejected
const bad = io(URL, { auth: { playerId: 'x', token: 'y' } });
const badErr = await new Promise((res) => bad.once('connect_error', res));
if (badErr.message !== 'BAD_AUTH') fail('weak auth accepted');
bad.close();
ok('bad auth rejected');

// create lobby
const created = await A.req('lobby:create', {
  playerName: 'Alice', name: 'Test Lobby', maxPlayers: 4, password: 'pw123',
  rules: { stackDraw2: true, turnTime: 30 }
});
if (!created.ok || !/^[A-Z0-9]{6,8}$/.test(created.code)) fail('lobby create: ' + JSON.stringify(created));
ok(`lobby created with code ${created.code}`);

// join without password fails
let join = await B.req('lobby:join', { code: created.code, playerName: 'Bob' });
if (join.ok || join.error !== 'PASSWORD_REQUIRED') fail('password not enforced: ' + JSON.stringify(join));
ok('password enforced');

join = await B.req('lobby:join', { code: created.code, playerName: 'Bob', password: 'pw123' });
if (!join.ok) fail('join failed: ' + join.error);
ok('joined with password');

// chat
const chatPromise = A.next('chat:message');
B.emit('lobby:chat', { text: 'hello world' });
let msg = await chatPromise;
while (msg.system) msg = await A.next('chat:message');
if (msg.text !== 'hello world') fail('chat broken');
ok('chat works');

// start blocked until ready
let start = await A.req('lobby:start');
if (start.ok) fail('start allowed without ready players');
ok('start blocked until everyone is ready');

// non-host cannot add bots
B.emit('lobby:addBot', { difficulty: 'hard' });
const errMsg = await B.next('error:msg');
if (!/host/i.test(errMsg.message)) fail('non-host bot add not rejected properly');
ok('host-only controls enforced');

// ready + add bot + start
B.emit('lobby:ready', { ready: true });
A.emit('lobby:addBot', { difficulty: 'medium' });
await new Promise((r) => setTimeout(r, 300));

const gameStateA = A.next('game:state');
const gameStateB = B.next('game:state');
start = await A.req('lobby:start');
if (!start.ok) fail('start failed: ' + start.error);
const [gA, gB] = await Promise.all([gameStateA, gameStateB]);
ok('game started, both clients got state');

if (gA.yourHand.length !== 7 || gB.yourHand.length !== 7) fail('wrong hand size');
if (gA.players.some((p) => p.handCount !== 7)) fail('wrong opponent counts');
if (JSON.stringify(gA.yourHand) === JSON.stringify(gB.yourHand)) fail('players share a hand?!');
ok('7 cards dealt each, hands are private per player');

// play through a few turns: whoever has the turn draws or plays a playable card
const sockets = { };
sockets[gA.players.find(p => p.name === 'Alice').id] = { s: A, state: gA };
sockets[gB.players.find(p => p.name === 'Bob').id] = { s: B, state: gB };
A.on('game:state', (g) => { const e = Object.values(sockets).find(x => x.s === A); e.state = g; });
B.on('game:state', (g) => { const e = Object.values(sockets).find(x => x.s === B); e.state = g; });

// security: try to play a card we don't own
const victim = Object.entries(sockets)[0];
const res = await victim[1].s.req('game:play', { cardId: 'c999999' });
if (res.ok) fail('SECURITY: foreign card accepted');
ok('foreign card rejected');

let plays = 0;
for (let i = 0; i < 40 && plays < 6; i++) {
  await new Promise((r) => setTimeout(r, 350));
  for (const [pid, entry] of Object.entries(sockets)) {
    const st = entry.state;
    if (!st || st.finished || st.turnPlayerId !== pid) continue;
    if (st.challenge && st.challenge.victimId === pid) {
      await entry.s.req('game:challenge', { accept: false });
      plays++;
    } else if (st.playableIds.length > 0) {
      const card = st.yourHand.find((c) => c.id === st.playableIds[0]);
      const payload = { cardId: card.id };
      if (card.color === 'wild') payload.color = 'red';
      const r = await entry.s.req('game:play', payload);
      if (!r.ok) { await entry.s.req('game:draw'); }
      plays++;
    } else if (st.pendingDrawnCardId) {
      await entry.s.req('game:pass');
      plays++;
    } else {
      await entry.s.req('game:draw');
      plays++;
    }
  }
}
if (plays < 4) fail('game did not progress (only ' + plays + ' actions)');
ok(`played ${plays} human actions across turns (bot played too)`);

// reconnect: drop Bob and reconnect with same identity
const bobAuth = B.auth;
B.close();
await new Promise((r) => setTimeout(r, 400));
const B2 = io(URL, { auth: bobAuth });
const session = await new Promise((res) => B2.once('session', res));
if (!session.inLobby || !session.game) fail('reconnect state recovery failed');
if (session.game.yourHand.length === 0 && !session.game.finished) fail('hand lost on reconnect');
ok('reconnect recovered lobby + game state with hand intact');

A.close(); B2.close();
console.log('\nE2E: all checks passed.');
process.exit(0);
