import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms, CHAT_HISTORY_LIMIT } from '../server/rooms.js';
import { createProfileStore } from '../server/profiles.js';
import { PROTOCOL } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';

const last = (p, type) => p.messages.findLast(m => m.type === type);
function setup() {
  let time = 10000;
  const lobby = createRooms({ now: () => time, characters: ['actor-0', 'actor-1'] });
  const connect = token => {
    const p = { messages: [], send(m) { this.messages.push(structuredClone(m)); } };
    lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token }); return p;
  };
  const a = connect(), b = connect(), watcher = connect(), outsider = connect();
  lobby.handle(a, { type: 'create' });
  const room = a.room;
  lobby.handle(b, { type: 'join', code: room.code });
  lobby.handle(watcher, { type: 'watch', code: room.code });
  return { lobby, a, b, watcher, outsider, room, connect, advance: n => { time += n; } };
}
test('room chat reaches only members; identity is server supplied and reconnect restores ordered history', () => {
  const { lobby, a, b, watcher, outsider, room, connect } = setup();
  lobby.handle(a, { type: 'chat', text: ' 안녕하세요 ', name: '위조', playerId: outsider.profileId });
  for (const p of [a, b, watcher]) {
    assert.equal(last(p, 'chat').message.text, '안녕하세요');
    assert.equal(last(p, 'chat').message.playerId, a.profileId);
    assert.notEqual(last(p, 'chat').message.name, '위조');
  }
  assert.equal(last(outsider, 'chat'), undefined);
  assert.ok(!JSON.stringify(last(outsider, 'lobby')).includes('안녕하세요'));
  lobby.disconnect(watcher);
  const returning = connect(last(watcher, 'welcome').token);
  assert.deepEqual(last(returning, 'chatHistory').messages, room.chat);
  assert.equal(last(returning, 'chatHistory').code, room.code);
});
test('chat survives selection, playing, result and return to room; active players can read but only observers can send', () => {
  const { lobby, a, b, watcher, room } = setup();
  lobby.handle(a, { type: 'chat', text: '시작 전' });
  for (const p of [a, b]) lobby.handle(p, { type: 'ready' });
  for (const p of [a, b]) lobby.handle(p, { type: 'confirmCharacter', selectionId: room.selectionId });
  lobby.handle(a, { type: 'chat', text: '경기 중 입력 금지' });
  assert.match(last(a, 'chatError').reason, /읽기만/);
  lobby.handle(watcher, { type: 'chat', text: '응원합니다' });
  assert.equal(last(a, 'chat').message.text, '응원합니다');
  room.finished = true;
  lobby.handle(b, { type: 'chat', text: '한 판 더?' });
  const history = structuredClone(room.chat);
  lobby.handle(a, { type: 'returnRoom', matchId: room.matchId });
  assert.equal(room.state, null); assert.deepEqual(room.chat, history);
  lobby.handle(a, { type: 'chat', text: '다시 준비' });
  assert.equal(room.chat.length, 4);
});
test('chat validates text, throttles bursts, bounds history and persists across host restore', () => {
  const { lobby, a, room, advance } = setup();
  for (const text of ['', ' ', 'x'.repeat(161), 'a\nb', 'a\u0000b', 'a\u202Eb', 123]) lobby.handle(a, { type: 'chat', text });
  assert.equal(room.chat.length, 0);
  for (let n = 0; n < 4; n++) lobby.handle(a, { type: 'chat', text: `message ${n}` });
  assert.equal(room.chat.length, 3); assert.match(last(a, 'chatError').reason, /5초/);
  for (let n = 0; n < 110; n++) { advance(5000); lobby.handle(a, { type: 'chat', text: `history ${n}` }); }
  assert.equal(room.chat.length, CHAT_HISTORY_LIMIT);
  assert.equal(room.chat.at(-1).id, 113);
  const saved = structuredClone(lobby.snapshot());
  const restored = createRooms({ profiles: lobby.profiles, characters: ['actor-0', 'actor-1'] });
  restored.restore(saved, () => ({ send() {} }));
  assert.deepEqual(restored.rooms.get(room.code).chat, room.chat);
  lobby.handle(a, { type: 'leave' });
  assert.equal(room.chatTimes[a.profileId], undefined);
});
test('waiting players reconnect into the same room with chat and cannot start while a peer is offline', () => {
  const { lobby, a, b, room, connect, advance } = setup();
  lobby.handle(a, { type: 'chat', text: '대기실 기록' });
  const token = last(a, 'welcome').token;
  lobby.disconnect(a);
  lobby.handle(b, { type: 'ready' });
  assert.equal(room.selectionId, undefined);
  const returning = connect(token);
  assert.equal(returning.room.code, room.code);
  assert.equal(last(returning, 'chatHistory').messages[0].text, '대기실 기록');
  lobby.disconnect(returning); advance(30000); lobby.sweep();
  assert.equal(room.peers.length, 1);
  assert.equal(room.chat[0].text, '대기실 기록');
});
test('profile character is validated, persists with the account, and does not change during battle character selection', () => {
  let saved;
  const profiles = createProfileStore({ save: data => { saved = structuredClone(data); } });
  const identity = profiles.authenticate();
  profiles.rename(identity.profile.id, '프로필', 'actor-1');
  assert.throws(() => profiles.rename(identity.profile.id, '프로필', '../invalid'));
  const reloaded = createProfileStore({ load: () => saved });
  assert.equal(reloaded.authenticate(identity.token).profile.charId, 'actor-1');
  const lobby = createRooms({ profiles: reloaded, characters: ['actor-0', 'actor-1'] });
  const p = { messages: [], send(m) { this.messages.push(m); } };
  lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token: identity.token });
  assert.equal(p.charId, 'actor-1');
  lobby.handle(p, { type: 'rename', name: '프로필', charId: 'unreleased' });
  assert.match(last(p, 'error').reason, /선택할 수 없는/);
  lobby.handle(p, { type: 'create' });
  p.charId = 'actor-0';
  assert.equal(profiles.get(p.profileId).charId, 'actor-1');
});
