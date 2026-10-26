import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRooms } from '../server/rooms.js';
import { createProfileStore } from '../server/profiles.js';
import { ratingChanges } from '../server/rating.js';
import { PROTOCOL } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';

function peer(lobby, token) {
  const p = { messages: [], send(message) { this.messages.push(message); } };
  lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token });
  return p;
}
const latest = (p, type) => p.messages.findLast((m) => m.type === type);
function make(lobby, a, options = {}) { lobby.handle(a, { type: 'create', ...options }); return a.room; }
function joinRoom(lobby, b, room, password) { lobby.handle(b, { type: 'join', code: room.code, password }); }
function start(lobby, a, b) { lobby.handle(a, { type: 'ready' }); lobby.handle(b, { type: 'ready' }); lobby.handle(a, { type: 'confirmCharacter', selectionId: a.room.selectionId }); lobby.handle(b, { type: 'confirmCharacter', selectionId: b.room.selectionId }); }

test('Elo rewards upsets more and rates 4-player placements with zero-sum integer deltas', () => {
  const favorite = [{ id: 'a', rating: 1900, place: 1 }, { id: 'b', rating: 1500, place: 2 }];
  const expected = ratingChanges(favorite), upset = ratingChanges(favorite.map((e) => ({ ...e, place: 3 - e.place })));
  assert.ok(upset[1].delta > expected[0].delta);
  const four = ratingChanges([1, 2, 3, 4].map((place) => ({ id: String(place), rating: 1500, place })));
  assert.deepEqual(four.map((p) => p.delta), [16, 5, -5, -16]);
  assert.equal(four.reduce((sum, p) => sum + p.delta, 0), 0);
  assert.deepEqual(ratingChanges([{ id: 'a', rating: 1500, place: 1 }, { id: 'b', rating: 1500, place: 1 }]).map((p) => p.delta), [0, 0]);
  assert.throws(() => ratingChanges([{ id: 'a', rating: 1500, place: 1 }, { id: 'a', rating: 1500, place: 2 }]));
});
test('profiles and match settlement survive restart; duplicate match IDs cannot change rating twice', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chii-rank-')); t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, 'profiles.json'); let store = createProfileStore({ file });
  const a = store.authenticate(), b = store.authenticate(); store.rename(a.profile.id, '테스트A');
  const request = { id: 'match1', rated: true, standings: [{ id: a.profile.id, place: 1 }, { id: b.profile.id, place: 2 }] };
  const result = store.record(request); assert.equal(result.standings[0].delta, 16);
  store = createProfileStore({ file });
  assert.equal(store.authenticate(a.token).profile.rating, 1516);
  assert.deepEqual(store.record(request), result);
  assert.equal(store.get(a.profile.id).games, 1);
  assert.equal(store.rankings()[0].name, '테스트A');
  assert.ok(!readFileSync(file, 'utf8').includes(a.token));
  assert.throws(() => store.authenticate('a'.repeat(64)));
  assert.throws(() => store.rename(b.profile.id, '테스트A'));
});
test('password rooms do not leak secrets and reject bad passwords without losing the lobby connection', () => {
  const lobby = createRooms(), a = peer(lobby), b = peer(lobby);
  const room = make(lobby, a, { name: '비밀방', password: 'secret!', rated: true });
  const listing = latest(b, 'lobby').rooms[0];
  assert.equal(listing.locked, true); assert.equal(listing.rated, true);
  assert.ok(!JSON.stringify(latest(b, 'lobby')).includes('secret!'));
  joinRoom(lobby, b, room, 'wrong'); assert.equal(b.room, undefined); assert.equal(latest(b, 'error').reason, '비밀번호가 일치하지 않습니다.');
  joinRoom(lobby, b, room, 'secret!'); assert.equal(b.room, room);
  assert.equal(room.state, null); start(lobby, a, b); assert.equal(room.state.frame, 0);
});
test('rated disconnect is a single forfeit, pre-game/casual departures do not change ratings', () => {
  const lobby = createRooms(), a = peer(lobby), b = peer(lobby);
  let room = make(lobby, a, { rated: true }); joinRoom(lobby, b, room); lobby.handle(a, { type: 'leave' });
  assert.equal(lobby.profiles.get(a.profileId).games, 0);
  lobby.handle(b, { type: 'leave' });
  room = make(lobby, a, { rated: false }); joinRoom(lobby, b, room); start(lobby, a, b); lobby.handle(a, { type: 'leave' });
  assert.equal(lobby.profiles.get(a.profileId).rating, 1500);
  lobby.handle(b, { type: 'leave' });
  room = make(lobby, a, { rated: true }); joinRoom(lobby, b, room); start(lobby, a, b); lobby.leave(a); lobby.leave(a);
  assert.equal(lobby.profiles.get(a.profileId).rating, 1484);
  assert.equal(lobby.profiles.get(b.profileId).rating, 1516);
  assert.equal(lobby.profiles.get(a.profileId).games, 1);
  assert.equal(lobby.rooms.size, 1);
  assert.equal(latest(b, 'settlement').result.reason, 'forfeit');
});
test('same identity cannot join twice, spoofed results and unsupported 4-player rooms are rejected', () => {
  const lobby = createRooms(), a = peer(lobby);
  const duplicate = peer(lobby, latest(a, 'welcome').token);
  assert.equal(duplicate.profileId, undefined);
  assert.match(latest(duplicate, 'error').reason, /이미/);
  make(lobby, a, { mode: 'four' }); assert.equal(a.room, undefined);
  assert.throws(() => lobby.handle(a, { type: 'settlement', winner: 0, rating: 9999 }));
});
test('automatic matching separates casual/rated queues, supports cancellation and widens with wait time', () => {
  let time = 0; const lobby = createRooms({ now: () => time });
  const a = peer(lobby), b = peer(lobby), c = peer(lobby);
  lobby.handle(a, { type: 'queue', rated: true }); lobby.handle(b, { type: 'queue', rated: false });
  assert.equal(lobby.rooms.size, 0);
  lobby.handle(b, { type: 'cancelQueue' }); assert.equal(lobby.queue.size, 1);
  lobby.handle(c, { type: 'queue', rated: true }); assert.equal(a.room, c.room); assert.ok(a.room.rated);
  assert.equal(lobby.queue.size, 0); lobby.handle(a, { type: 'leave' });
  // 여러 승리로 레이트 차이를 만든 뒤 매칭 범위가 늘어나는지 확인한다.
  for (let i = 0; i < 30; i++) lobby.profiles.record({ id: `boost${i}`, rated: true, standings: [{ id: a.profileId, place: 1 }, { id: b.profileId, place: 2 }] });
  lobby.handle(a, { type: 'queue', rated: true }); lobby.handle(b, { type: 'queue', rated: true });
  assert.equal(a.room, null); assert.equal(b.room, undefined);
  time = 120000; lobby.matchmake(); assert.equal(a.room, b.room); assert.ok(a.room);
});
test('a completed room can rematch with fresh match ID and ignores frames from the old match', () => {
  const lobby = createRooms(), a = peer(lobby), b = peer(lobby);
  const room = make(lobby, a, { rated: true }); joinRoom(lobby, b, room); start(lobby, a, b);
  const oldId = room.matchId; room.started -= 600000;
  for (let frame = 0; frame < 5000 && !room.finished; frame++) {
    for (const p of [a, b]) lobby.handle(p, { type: 'input', matchId: oldId, frame, input: 4 });
  }
  assert.ok(room.finished); assert.equal(lobby.profiles.get(a.profileId).games, 1);
  lobby.handle(a, { type: 'returnRoom' });
  lobby.handle(b, { type: 'input', matchId: oldId, frame: 5000, input: 0 }); assert.equal(room.state, null);
  start(lobby, a, b); assert.notEqual(room.matchId, oldId);
  lobby.handle(b, { type: 'input', matchId: oldId, frame: 0, input: 0 }); assert.equal(room.next[1], 0);
  assert.equal(lobby.profiles.get(a.profileId).games, 1);
});

test('양쪽 준비 후 캐릭터를 선택하고 모두 결정해야 시작하며 취소·오래된 결정을 안전하게 처리한다', () => {
  const lobby=createRooms({characters:['actor-a','actor-b','actor-c']});
  const a=peer(lobby),b=peer(lobby);const room=make(lobby,a);joinRoom(lobby,b,room);
  lobby.handle(a,{type:'character',charId:'actor-c'}); assert.equal(a.charId,'actor-a');
  for(const p of [a,b]) lobby.handle(p,{type:'ready'});
  const selectionId=room.selectionId; assert.ok(selectionId); assert.equal(room.state,null);
  assert.equal(latest(b,'room').room.phase,'selecting');
  lobby.handle(a,{type:'character',charId:'actor-c',selectionId}); assert.equal(a.charId,'actor-c');
  lobby.handle(a,{type:'character',charId:'hidden',selectionId}); assert.equal(latest(a,'error').reason,'선택할 수 없는 캐릭터입니다.');
  lobby.handle(a,{type:'confirmCharacter',selectionId}); assert.equal(room.state,null);
  lobby.handle(a,{type:'character',charId:'actor-b',selectionId}); assert.equal(a.charId,'actor-c');
  lobby.handle(b,{type:'cancelSelection',selectionId}); assert.equal(room.state,null); assert.equal(room.selectionId,null); assert.equal(room.ready.size,0);
  assert.equal(lobby.profiles.get(a.profileId).games,0);
  for(const p of [a,b]) lobby.handle(p,{type:'ready'});
  lobby.handle(a,{type:'confirmCharacter',selectionId}); assert.equal(room.confirmed.size,0);
  const current=room.selectionId;
  lobby.handle(a,{type:'character',charId:'actor-b',selectionId:current});
  lobby.handle(b,{type:'character',charId:'actor-a',selectionId:current});
  for(const p of [a,b]) lobby.handle(p,{type:'confirmCharacter',selectionId:current});
  assert.deepEqual(latest(a,'start').players.map(p=>p.charId),['actor-b','actor-a']);
  lobby.handle(b,{type:'character',charId:'actor-c',selectionId:current}); assert.equal(b.charId,'actor-a');
  room.finished=true;lobby.handle(a,{type:'returnRoom'}); start(lobby,a,b);
  assert.deepEqual(latest(b,'start').players.map(p=>p.charId),['actor-b','actor-a']);
});

test('캐릭터 선택 단계는 저장·복원하고 선택 중 이탈은 레이트 없이 대기실로 돌린다', () => {
  const lobby=createRooms(), a=peer(lobby), b=peer(lobby), observer=peer(lobby);
  const room=make(lobby,a,{rated:true});joinRoom(lobby,b,room);
  lobby.handle(observer,{type:'watch',code:room.code});
  for(const p of [a,b]) lobby.handle(p,{type:'ready'});
  const selectionId=room.selectionId; lobby.handle(a,{type:'confirmCharacter',selectionId});
  const copy=createRooms({profiles:lobby.profiles});
  copy.restore(JSON.parse(JSON.stringify(lobby.snapshot())),()=>({send(){}}));
  const restored=copy.rooms.get(room.code);
  assert.equal(restored.selectionId,selectionId);assert.deepEqual([...restored.confirmed],[0]);assert.equal(restored.state,null);
  lobby.handle(observer,{type:'confirmCharacter',selectionId});assert.equal(room.confirmed.size,1);
  lobby.handle(b,{type:'leave'});
  assert.equal(a.room,room);assert.equal(room.state,null);assert.equal(room.selectionId,null);assert.equal(room.ready.size,0);
  assert.equal(lobby.profiles.get(a.profileId).games,0);assert.equal(lobby.profiles.get(b.profileId).games,0);
  assert.ok(latest(observer,'reset'));
});
