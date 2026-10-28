import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqlProfileRepository } from '../server/profile-repository.js';
import { createProfileStore } from '../server/profiles.js';
import { createNodeProfileStore } from '../server/node-profile-store.js';

test('큰 기존 이력은 행별로 이전하고 정산 실패는 이력·프로필·메모리를 함께 되돌린다', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let legacy;
  const original = createProfileStore({ save: value => { legacy = structuredClone(value); } });
  const a = original.authenticate(), b = original.authenticate();
  const request = { id: 'once', rated: true, standings: [{ id: a.profile.id, place: 1 }, { id: b.profile.id, place: 2 }] };
  const result = original.record(request);
  for (let i = 0; i < 5000; i++) legacy.matches[`old-${i}`] = { id: `old-${i}`, note: 'x'.repeat(350) };
  assert.ok(JSON.stringify(legacy).length > 1500000);
  const exec = (query, ...params) => db.prepare(query).all(...params);
  const transaction = action => {
    db.exec('BEGIN');
    try { const value = action(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const repository = createSqlProfileRepository({ exec, transaction, legacy });
  let store = createProfileStore({ repository });
  assert.deepEqual(store.record(request), result);
  assert.ok(JSON.stringify(repository.load()).length < 2000, '시작할 때 전체 이력을 읽지 않는다');
  assert.equal(exec('SELECT COUNT(*) AS n FROM match_history')[0].n, 5001);
  db.exec(`CREATE TRIGGER reject_profile BEFORE UPDATE ON player_profiles WHEN NEW.id = '${b.profile.id}' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  assert.throws(() => store.record({ ...request, id: 'next' }), /disk full/);
  assert.equal(repository.getMatch('next'), undefined);
  assert.equal(store.get(a.profile.id).games, 1);
  assert.equal(createProfileStore({ repository }).get(a.profile.id).games, 1);
  db.exec('DROP TRIGGER reject_profile'); store.record({ ...request, id: 'next' });
  store = createProfileStore({ repository: createSqlProfileRepository({ exec, transaction, legacy }) });
  assert.equal(store.get(a.profile.id).games, 2, '이전 자료로 다시 덮어쓰지 않는다');
});

test('Node는 기존 JSON을 보존하고 재시작 후 SQLite의 최신 레이트·중복 정산 상태를 복구한다', t => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-migration-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let legacy;
  const old = createProfileStore({ save: data => { legacy = data; } });
  const a = old.authenticate(), b = old.authenticate();
  const file = join(dir, 'online.json'), backup = JSON.stringify(legacy);
  writeFileSync(file, backup);
  let store = createNodeProfileStore({ file });
  const match = { id: 'once', rated: true, standings: [{ id: a.profile.id, place: 1 }, { id: b.profile.id, place: 2 }] };
  const result = store.record(match); store.close();
  store = createNodeProfileStore({ file });
  try {
    assert.equal(store.authenticate(a.token).profile.rating, 1516);
    assert.deepEqual(store.record(match), result);
    assert.equal(store.get(a.profile.id).games, 1);
    assert.equal(readFileSync(file, 'utf8'), backup);
  } finally { store.close(); }
});
