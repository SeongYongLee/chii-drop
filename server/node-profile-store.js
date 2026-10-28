import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createProfileStore } from './profiles.js';
import { createSqlProfileRepository } from './profile-repository.js';

export function createNodeProfileStore({ file, ...options } = {}) {
  if (!file) return createProfileStore(options);
  mkdirSync(dirname(file), { recursive: true });
  const path = `${file}.sqlite`;
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    const exec = (query, ...params) => db.prepare(query).all(...params);
    // 이전 JSON은 백업으로 보존한다. 초기화 완료 이후에는 다시 읽거나 덮어쓰지 않는다.
    const initialized = exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_meta'").length
      && exec("SELECT value FROM profile_meta WHERE key = 'initialized'").length;
    const legacy = !initialized && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const repository = createSqlProfileRepository({ exec, legacy, transaction(action) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = action(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } });
    return { ...createProfileStore({ repository }), close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
