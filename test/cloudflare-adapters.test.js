import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { createProfileStore } from '../server/profiles.js';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { roomSocketURL } from '../src/net/socket-route.js';
import { runtimeConfig } from '../server/runtime-config.js';
import { parseOnlineConfig, onlineTokenKey } from '../src/net/config.js';

test('durable room snapshots preserve pending inputs, password locks and reconnect deadlines without tokens or sockets', () => {
  let clock = 100000;
  const profiles = createProfileStore();
  const lobby = createRooms({ profiles, now: () => clock });
  const peer = () => ({ messages: [], send(m) { this.messages.push(structuredClone(m)); } });
  const a = peer(), b = peer();
  const hello = { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION };
  for (const p of [a, b]) lobby.handle(p, hello);
  const token = a.messages.find(m => m.type === 'welcome').token;
  lobby.handle(a, { type: 'create', password: 'local-only', rated: true });
  lobby.handle(b, { type: 'join', code: a.room.code, password: 'local-only' });
  for (const p of [a, b]) lobby.handle(p, { type: 'ready' });
  for (const p of [a, b]) lobby.handle(p, { type: 'confirmCharacter', selectionId: a.room.selectionId });
  lobby.handle(a, { type: 'inputBatch', matchId: a.room.matchId, frame: 0, inputs: [2, 0, 0] });
  lobby.disconnect(a);
  const deadline = a.room.deadline, saved = JSON.parse(JSON.stringify(lobby.snapshot()));
  assert.ok(!JSON.stringify(saved).includes(token));
  assert.ok(!JSON.stringify(saved).includes('local-only'));
  assert.ok(!JSON.stringify(saved).includes('messages'));
  clock += 1000;
  const recovered = createRooms({ profiles, now: () => clock });
  recovered.restore(saved, () => peer());
  const room = recovered.rooms.values().next().value;
  assert.equal(room.deadline, deadline);
  assert.equal(stateHash(room.state), stateHash(a.room.state));
  assert.deepEqual([...room.inputs[0]], [[0, 2], [1, 0], [2, 0]]);
  assert.ok(Buffer.isBuffer(room.password));
  const rejoined = peer(); recovered.handle(rejoined, { ...hello, token });
  assert.equal(rejoined.room.code, room.code);
  assert.equal(room.deadline, deadline);
  assert.equal(room.epoch, 1);
  assert.equal(room.inputs[0].size, 0);
});

test('profile storage adapter restores identities and ratings; failed persistence cannot acknowledge a mutation', () => {
  let saved;
  const store = createProfileStore({ save: data => { saved = structuredClone(data); } });
  const a = store.authenticate(), b = store.authenticate();
  const match = { id: 'once', rated: true, standings: [{ id: a.profile.id, place: 1 }, { id: b.profile.id, place: 2 }] };
  store.record(match);
  const restored = createProfileStore({ load: () => saved, save: data => { saved = structuredClone(data); } });
  assert.equal(restored.authenticate(a.token).profile.rating, 1516);
  restored.record(match);
  assert.equal(restored.get(a.profile.id).games, 1);
  const failing = createProfileStore({ load: () => saved, save: () => { throw new Error('quota'); } });
  assert.throws(() => failing.rename(a.profile.id, '변경실패'), /quota/);
  assert.equal(failing.get(a.profile.id).name, a.profile.name);
});

test('room redirects keep the configured server origin and reject non-code routes', () => {
  const base = 'wss://game.example/socket';
  assert.equal(roomSocketURL(base, 'ABCDEF12'), base + '?room=ABCDEF12');
  assert.equal(roomSocketURL(base + '?room=ABCDEF12', null), base);
  for (const code of ['https://other.example', '../socket', '', undefined, ['ABCDEF12']]) assert.throws(() => roomSocketURL(base, code));
});

test('Cloudflare local bridge accepts only loopback HTTP in development', () => {
  assert.equal(runtimeConfig({ LOCAL_CLOUDFLARE_URL: 'http://127.0.0.1:8787' }).cloudflareURL, 'http://127.0.0.1:8787');
  for (const url of ['http://remote.example', 'http://user:pass@localhost:8787', 'http://localhost:8787/path', 'https://localhost:8787']) {
    assert.throws(() => runtimeConfig({ LOCAL_CLOUDFLARE_URL: url }));
  }
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', ONLINE_DATA_FILE: '/data/profiles.json', ALLOWED_ORIGINS: 'https://example.com', LOCAL_CLOUDFLARE_URL: 'http://localhost:8787' }));
});

test('Node and Cloudflare identities use separate keys without replacing existing player tokens', () => {
  assert.equal(onlineTokenKey({}), 'online-player-key-v1');
  const config = parseOnlineConfig({ enabled: true, identityScope: 'cloudflare-local-v1' }, 'http://localhost:5180');
  assert.equal(onlineTokenKey(config), 'online-player-key-v1:cloudflare-local-v1');
  for (const identityScope of ['', '../key', 123, 'x'.repeat(65)]) assert.throws(() => parseOnlineConfig({ enabled: true, identityScope }, 'http://localhost:5180'));
});
