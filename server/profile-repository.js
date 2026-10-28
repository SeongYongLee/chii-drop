// Node SQLite와 Durable Objects가 같은 스키마·원자적 저장 규칙을 사용한다.
// 경기 결과는 경기별로 영구 보관하고 필요할 때 한 건씩 읽는다. 자동 삭제하지 않는다.
export function createSqlProfileRepository({ exec, transaction, legacy }) {
  exec('CREATE TABLE IF NOT EXISTS player_profiles (id TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
  exec('CREATE TABLE IF NOT EXISTS match_history (id TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
  exec('CREATE TABLE IF NOT EXISTS profile_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
  const upsert = player => exec('INSERT INTO player_profiles VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value', player.id, JSON.stringify(player));
  if (!exec("SELECT value FROM profile_meta WHERE key = 'initialized'").length) {
    if (legacy && (legacy.version !== 1 || !legacy.players || !legacy.matches)) throw new Error('invalid profile database');
    transaction(() => {
      for (const player of Object.values(legacy?.players ?? {})) upsert(player);
      for (const [id, match] of Object.entries(legacy?.matches ?? {})) exec('INSERT INTO match_history VALUES (?, ?)', id, JSON.stringify(match));
      exec("INSERT INTO profile_meta VALUES ('initialized', '1')");
    });
  }
  return {
    load: () => ({ version: 1, players: Object.fromEntries(exec('SELECT id, value FROM player_profiles').map(row => [row.id, JSON.parse(row.value)])), matches: {} }),
    getMatch: id => {
      const row = exec('SELECT value FROM match_history WHERE id = ?', id)[0];
      return row ? JSON.parse(row.value) : undefined;
    },
    save(players, match) {
      transaction(() => {
        if (match) exec('INSERT INTO match_history VALUES (?, ?)', match.id, JSON.stringify(match));
        for (const player of players) upsert(player);
      });
    },
  };
}
