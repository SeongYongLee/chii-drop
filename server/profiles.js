import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INITIAL_RATING, ratingChanges, RATING_VERSION } from './rating.js';

function digest(token) { return createHash('sha256').update(token).digest('hex'); }
function publicProfile(p) { return { id: p.id, name: p.name, rating: p.rating, games: p.games, wins: p.wins, ...(p.charId ? { charId: p.charId } : {}) }; }
function cleanName(name) {
  if (typeof name !== 'string') throw new Error('닉네임을 입력하세요.');
  const value = name.trim().normalize('NFC');
  if (value.length < 1 || value.length > 16 || /[\p{C}<>]/u.test(value)) throw new Error('닉네임은 1~16자의 일반 문자로 입력하세요.');
  return value;
}

// 저장에 성공한 뒤에만 메모리를 갱신한다. 운영 저장소는 결과 이력을 따로 관리한다.
export function createProfileStore({ repository, load, save } = {}) {
  let data = repository?.load() ?? load?.() ?? { version: 1, players: {}, matches: {} };
  if (data.version !== 1 || !data.players || !data.matches) throw new Error('invalid profile database');
  function commit(next, match) {
    repository?.save(Object.values(next.players).filter(player => player !== data.players[player.id]), match);
    save?.(next);
    data = next;
  }
  function authenticate(token) {
    if (token !== undefined && token !== null) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('플레이어 키가 올바르지 않습니다.');
      const hash = digest(token);
      const p = Object.values(data.players).find((entry) => entry.keyHash === hash);
      if (!p) throw new Error('서버에 저장된 플레이어를 찾을 수 없습니다.');
      return { profile: publicProfile(p) };
    }
    const key = randomBytes(32).toString('hex');
    const id = randomUUID();
    const p = { id, keyHash: digest(key), name: `참가자 ${id.slice(0, 5)}`, rating: INITIAL_RATING, games: 0, wins: 0 };
    commit({ ...data, players: { ...data.players, [id]: p } });
    return { profile: publicProfile(p), token: key };
  }
  function rename(id, name, charId) {
    const value = cleanName(name);
    if (Object.values(data.players).some((p) => p.id !== id && p.name.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new Error('이미 사용 중인 닉네임입니다.');
    if (charId !== undefined && (typeof charId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(charId))) throw new Error('캐릭터를 확인하세요.');
    const profile = { ...data.players[id], name: value, ...(charId !== undefined ? { charId } : {}) };
    commit({ ...data, players: { ...data.players, [id]: profile } });
    return publicProfile(profile);
  }
  function get(id) { const p = data.players[id]; if (!p) throw new Error('unknown player'); return publicProfile(p); }
  function rankings() {
    const sorted = Object.values(data.players).filter((p) => p.games > 0)
      .sort((a, b) => b.rating - a.rating || b.games - a.games || a.id.localeCompare(b.id));
    return sorted.slice(0, 100).map((p) => ({ ...publicProfile(p), rank: sorted.findIndex((other) => other.rating === p.rating) + 1 }));
  }
  function record({ id, standings, rated, reason = 'played' }) {
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new Error('invalid match id');
    const previous = repository ? repository.getMatch(id) : data.matches[id];
    if (previous) return structuredClone(previous);
    if (standings.some((s) => !data.players[s.id])) throw new Error('unknown participant');
    const entries = standings.map((s) => ({ ...s, rating: data.players[s.id].rating }));
    const changes = ratingChanges(entries).map((p) => rated ? p : { ...p, delta: 0, after: p.rating });
    const players = { ...data.players };
    if (rated) for (const p of changes) players[p.id] = {
      ...players[p.id], rating: p.after, games: players[p.id].games + 1,
      wins: players[p.id].wins + (p.place === 1 && !standings.every((s) => s.place === 1) ? 1 : 0),
    };
    const result = { id, rated, reason, ratingVersion: RATING_VERSION, standings: changes, at: new Date().toISOString() };
    commit({ ...data, players, matches: repository ? {} : { ...data.matches, [id]: result } }, result);
    return structuredClone(result);
  }
  return { authenticate, rename, get, rankings, record, count: () => Object.keys(data.players).length };
}
