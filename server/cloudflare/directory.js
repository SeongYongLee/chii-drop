import { DurableObject } from 'cloudflare:workers';
import { randomBytes } from 'node:crypto';
import { createProfileStore } from '../profiles.js';
import { accept, checkVersion, closeUnauthenticated, parseMessage, rateLimit, readState, send, setupStorage, writeState } from './shared.js';

// 로비/신원/레이트만 직렬화한다. 프레임 입력은 이 객체를 통과하지 않는다.
export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); setupStorage(ctx);
    const saved = readState(ctx) ?? {};
    this.data = saved.profiles;
    this.rooms = saved.rooms ?? {};
    this.revisions = saved.revisions ?? {};
    this.claims = saved.claims ?? {};
    this.queue = saved.queue ?? {};
    this.chain = Promise.resolve();
    this.profiles = createProfileStore({ load: () => this.data, save: next => {
      this.persist(next); this.data = next;
    } });
  }
  persist(profiles = this.data) { writeState(this.ctx, { profiles, rooms: this.rooms, revisions: this.revisions, claims: this.claims, queue: this.queue }); }
  serial(action) {
    const result = this.chain.then(action);
    this.chain = result.catch(() => {});
    return result;
  }
  identify(token) {
    return this.serial(() => {
      if (!token && Object.keys(this.data?.players ?? {}).length >= 2000) throw new Error('새 플레이어 등록이 가득 찼습니다.');
      return this.profiles.authenticate(token);
    });
  }
  fetch() { return accept(this.ctx, 24); }
  hasRoom(code) { return !!this.rooms[code]; }
  sockets(id) { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && ws.deserializeAttachment()?.profileId === id); }
  lobbyMessage() {
    return { type: 'lobby', rooms: Object.values(this.rooms), online: new Set([
      ...this.ctx.getWebSockets().filter(ws => ws.readyState === 1).map(ws => ws.deserializeAttachment()?.profileId).filter(Boolean),
      ...Object.keys(this.claims),
    ]).size };
  }
  publish() { const msg = this.lobbyMessage(); for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment()?.profileId) send(ws, msg); }
  updateRoom(code, view, revision) {
    return this.serial(async () => {
      if ((this.revisions[code] ?? -1) >= revision) return;
      this.revisions[code] = revision;
      if (view) this.rooms[code] = view;
      else {
        delete this.rooms[code];
        for (const [id, room] of Object.entries(this.claims)) if (room === code) delete this.claims[id];
      }
      this.persist(); this.publish();
      if (!view) await this.matchmake();
    });
  }
  settle(code, match) {
    return this.serial(() => {
      const room = this.rooms[code];
      if (!room || room.rated !== match.rated || room.players.length !== 2
        || match.standings.length !== 2 || match.standings.some(s => !room.players.some(p => p.id === s.id))) throw new Error('invalid settlement');
      const result = this.profiles.record(match);
      return { result, profiles: result.standings.map(s => this.profiles.get(s.id)), rankings: this.profiles.rankings() };
    });
  }
  async enter(ws, profile, msg) {
    if (this.claims[profile.id]) { send(ws, { type: 'route', code: this.claims[profile.id] }); return; }
    const creating = msg.type === 'create';
    if (!creating && (typeof msg.code !== 'string' || !/^[A-F0-9]{8}$/i.test(msg.code))) throw new Error('방 코드를 확인해 주세요.');
    if (creating && Object.keys(this.rooms).length >= Number(this.env.MAX_ROOMS ?? 5)) throw new Error('방이 가득 찼습니다.');
    const code = creating ? randomBytes(4).toString('hex').toUpperCase() : msg.code.toUpperCase();
    if (!creating && !this.rooms[code]) throw new Error('입장 가능한 방이 없습니다.');
    if (!creating && (this.rooms[code].phase !== 'waiting' || this.rooms[code].players.length >= 2)) throw new Error('입장 가능한 방이 없습니다.');
    const view = await this.env.ROOMS.getByName(code).reserve(profile, { ...msg, code });
    // 이 RPC 안에서는 Directory로 역호출하지 않는다. 전역 직렬화 교착을 막는다.
    this.rooms[code] = view; this.claims[profile.id] = code;
    delete this.queue[profile.id]; this.persist(); this.publish();
    send(ws, { type: 'route', code });
  }
  async matchmake() {
    const entries = Object.entries(this.queue);
    for (const [id, entry] of entries) {
      if (!this.queue[id]) continue;
      const a = this.sockets(id)[0];
      if (!a) { delete this.queue[id]; continue; }
      const rating = this.profiles.get(id).rating;
      const opponent = entries.filter(([other, b]) => other !== id && this.queue[other] && b.rated === entry.rated && this.sockets(other).length)
        .map(([other, b]) => ({ id: other, gap: Math.abs(rating - this.profiles.get(other).rating), waited: Date.now() - Math.min(entry.at, b.at) }))
        .filter(o => !entry.rated || o.gap <= Math.min(800, 100 + o.waited / 100)).sort((a, b) => a.gap - b.gap)[0];
      if (!opponent || Object.keys(this.rooms).length >= Number(this.env.MAX_ROOMS ?? 5)) continue;
      await this.enter(a, this.profiles.get(id), { type: 'create', rated: entry.rated, name: '자동 매칭' });
      const code = this.claims[id], b = this.sockets(opponent.id)[0];
      await this.enter(b, this.profiles.get(opponent.id), { type: 'join', code });
    }
    this.persist();
    // 한 명만 기다리는 로비를 반복해서 깨우지 않는다. 레이트 범위가 만나는 시각에만 재평가한다.
    let retryAt = Infinity;
    const left = Object.entries(this.queue);
    if (Object.keys(this.rooms).length < Number(this.env.MAX_ROOMS ?? 5)) for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
      const [a, entryA] = left[i], [b, entryB] = left[j];
      if (entryA.rated !== entryB.rated) continue;
      const gap = Math.abs(this.profiles.get(a).rating - this.profiles.get(b).rating);
      if (gap <= 800) retryAt = Math.min(retryAt, Math.min(entryA.at, entryB.at) + Math.max(0, gap - 100) * 100 + 1);
    }
    if (Number.isFinite(retryAt)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 250, retryAt));
  }
  webSocketMessage(ws, data) {
    return this.serial(async () => {
      try {
        const meta = rateLimit(ws), msg = parseMessage(data);
        if (msg.type === 'ping') { send(ws, { type: 'pong', time: msg.time }); return; }
        if (msg.type === 'hello') {
          try { checkVersion(msg); } catch (e) { send(ws, { type: 'incompatible', reason: e.message }); return; }
          if (meta.profileId) throw new Error('이미 인증된 연결입니다.');
          if (!msg.token && Object.keys(this.data?.players ?? {}).length >= 2000) throw new Error('새 플레이어 등록이 가득 찼습니다.');
          const identity = this.profiles.authenticate(msg.token);
          if (this.sockets(identity.profile.id).some(other => other !== ws)) { send(ws, { type: 'error', retryable: true, reason: '이미 연결된 세션을 확인하고 있습니다.' }); return; }
          ws.serializeAttachment({ ...meta, profileId: identity.profile.id });
          send(ws, { type: 'welcome', ...identity, heartbeat: 'auto' });
          send(ws, { type: 'rankings', rankings: this.profiles.rankings() });
          if (this.claims[identity.profile.id]) send(ws, { type: 'route', code: this.claims[identity.profile.id] });
          else this.publish();
          return;
        }
        if (!meta.profileId) throw new Error('먼저 접속해 주세요.');
        const profile = this.profiles.get(meta.profileId);
        if (msg.type === 'list') { send(ws, this.lobbyMessage()); send(ws, { type: 'rankings', rankings: this.profiles.rankings() }); }
        else if (msg.type === 'rename') {
          if (this.claims[profile.id] || this.queue[profile.id]) throw new Error('로비에서 닉네임을 변경하세요.');
          send(ws, { type: 'profile', profile: this.profiles.rename(profile.id, msg.name) });
        } else if (msg.type === 'create' || msg.type === 'join') {
          if (msg.mode && msg.mode !== 'duel') throw new Error('현재 1대1만 지원합니다.');
          if (this.queue[profile.id]) throw new Error('매칭을 취소해 주세요.');
          await this.enter(ws, profile, msg);
        } else if (msg.type === 'queue') {
          if (this.claims[profile.id] || typeof msg.rated !== 'boolean') throw new Error('매칭 설정을 확인해 주세요.');
          this.queue[profile.id] = { at: Date.now(), rated: msg.rated }; this.persist();
          send(ws, { type: 'queued', active: true, rated: msg.rated }); await this.matchmake();
        } else if (msg.type === 'cancelQueue' || msg.type === 'leave') {
          delete this.queue[profile.id]; this.persist(); send(ws, { type: 'queued', active: false });
        } else throw new Error('로비에서 사용할 수 없는 요청입니다.');
      } catch (e) { send(ws, { type: 'error', reason: e.message }); }
    });
  }
  webSocketClose(ws) {
    return this.serial(() => {
      const id = ws.deserializeAttachment()?.profileId;
      if (id && !this.sockets(id).length && this.queue[id]) { delete this.queue[id]; this.persist(); }
      this.publish();
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() { return this.serial(() => { closeUnauthenticated(this.ctx); return this.matchmake(); }); }
}
