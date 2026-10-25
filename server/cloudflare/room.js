import { DurableObject } from 'cloudflare:workers';
import { createRooms } from '../rooms.js';
import { createProfileStore } from '../profiles.js';
import manifest from '../../skins/chiikawa/pages-runtime/manifest.json';
import { PROTOCOL } from '../../src/net/rollback.js';
import { RULES_VERSION } from '../../src/engine/rules.js';
import { accept, checkVersion, closeUnauthenticated, parseMessage, rateLimit, readState, send, setupStorage, writeState } from './shared.js';

const characters = manifest.characters.filter(c => c.selectable !== false && c.selectionVisible !== false).map(c => c.id);
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); setupStorage(ctx);
    this.tasks = []; this.draining = false; this.deliveries = []; this.dirty = false; this.publishDirty = false;
    this.volatile = false; this.checkpointTimer = null;
    this.load();
  }
  load() {
    const saved = readState(this.ctx) ?? {};
    this.profileCache = saved.profiles ?? {}; this.pending = saved.pending ?? {};
    this.code = saved.code; this.revision = saved.revision ?? 0; this.expires = saved.expires ?? Date.now() + 600000;
    this.actions = saved.actions ?? {}; this.meter = saved.meter ?? { writes: 0, inputMessages: 0, inputFrames: 0 };
    const profiles = {
      authenticate: () => { if (!this.identity) throw new Error('authentication required'); return this.identity; },
      get: id => { if (!this.profileCache[id]) throw new Error('unknown player'); return this.profileCache[id]; },
      rankings: () => [],
      record: match => {
        const store = createProfileStore({ load: () => ({ version: 1, players: this.profileCache, matches: {} }) });
        const result = store.record(match);
        this.pending[match.id] = match;
        this.dirty = true;
        return result;
      },
    };
    this.lobby = createRooms({ profiles, characters, reconnectGrace: Number(this.env.RECONNECT_GRACE_MS ?? 30000) });
    this.lobby.restore(saved.rooms ?? [], meta => this.makePeer(this.ctx.getWebSockets().find(ws =>
      ws.readyState === 1 && ws.deserializeAttachment()?.profileId === meta.profileId)));
    // 호스트 재시작 후 연결이 사라졌다면 저장된 경기에서 유예를 시작한다.
    for (const p of [...this.lobby.peers]) if (!p.ws) { this.lobby.disconnect(p); this.dirty = true; }
    const room = this.room();
    if (room?.state && !room.finished && !room.paused) {
      // 복원된 체크포인트보다 앞선 클라이언트 입력은 새 epoch에서 다시 시작한다.
      this.lobby.synchronize(room); this.dirty = true;
    }
  }
  room() { return this.lobby.rooms.values().next().value; }
  view() {
    const room = this.room();
    return room ? { code: room.code, name: room.name, rated: room.rated, locked: !!room.password, mode: 'duel', capacity: 2,
      phase: room.state ? 'playing' : 'waiting', players: room.peers.map(p => ({ ...this.profileCache[p.profileId], side: p.side, charId: p.charId, ready: room.ready.has(p.side) })) } : null;
  }
  makePeer(ws) {
    const peer = { ws, send: msg => this.emit(peer, msg) };
    return peer;
  }
  emit(peer, msg) {
    if (peer.silent) return;
    if (msg.type === 'lobby') { this.publishDirty = true; return; }
    if (['profile', 'rankings', 'settlement'].includes(msg.type)) return;
    if (['checksum', 'result', 'finished'].includes(msg.type)) this.dirty = true;
    this.deliveries.push([peer.ws, msg]);
    if (msg.type === 'ended') this.deliveries.push([peer.ws, { type: 'route', code: null }]);
  }
  persist() {
    this.meter.writes++; this.revision++;
    const rows = writeState(this.ctx, { code: this.code, revision: this.revision, rooms: this.lobby.snapshot(), profiles: this.profileCache, pending: this.pending,
      expires: this.expires, actions: this.actions, meter: this.meter });
    this.meter.sqlRowsWritten = (this.meter.sqlRowsWritten ?? 0) + rows;
  }
  // 5ms 안에 양쪽에서 도착한 이벤트를 묶는다. 공식 체크섬·결과는 저장 후 전달한다.
  enqueue(action) {
    return new Promise((resolve, reject) => {
      if (this.tasks.length >= 64) { reject(new Error('overloaded')); return; }
      this.tasks.push({ action, resolve, reject });
      if (!this.draining) {
        this.draining = true;
        setTimeout(() => this.ctx.waitUntil(this.flush()), 5);
      }
    });
  }
  async flush() {
    const tasks = this.tasks.splice(0), outcomes = [];
    try {
      const before = JSON.stringify(this.view());
      for (const task of tasks) {
        try { outcomes.push({ task, value: await task.action() }); }
        catch (error) { outcomes.push({ task, error }); }
      }
      if (before !== JSON.stringify(this.view())) this.publishDirty = true;
      if (this.dirty) {
        this.persist(); await this.ctx.storage.sync(); this.dirty = false; this.volatile = false;
        clearTimeout(this.checkpointTimer); this.checkpointTimer = null;
      }
      if (Object.keys(this.pending).length) await this.ctx.storage.setAlarm(Date.now() + 2000);
      for (const match of Object.values(this.pending)) {
        const result = await this.env.DIRECTORY.getByName('lobby').settle(this.code, match);
        for (const p of result.profiles) this.profileCache[p.id] = p;
        if (this.room()?.matchId === match.id) this.room().settlement = result.result;
        delete this.pending[match.id];
        this.persist(); await this.ctx.storage.sync();
        for (const peer of this.room()?.peers ?? []) {
          this.deliveries.push([peer.ws, { type: 'settlement', matchId: match.id, result: result.result }]);
          this.deliveries.push([peer.ws, { type: 'profile', profile: this.profileCache[peer.profileId] }]);
          this.deliveries.push([peer.ws, { type: 'rankings', rankings: result.rankings }]);
        }
      }
      await this.planAlarm();
      const routes = [];
      for (const [ws, msg] of this.deliveries.splice(0)) {
        if (msg.type === 'route' && msg.code === null) routes.push([ws, msg]);
        else send(ws, msg);
      }
      if (this.publishDirty && this.code) {
        const view = this.view(); this.publishDirty = false;
        // 로비의 입장 RPC가 이 방을 기다릴 수 있어 방의 직렬 처리에서 기다리지 않는다.
        this.ctx.waitUntil(this.env.DIRECTORY.getByName('lobby').updateRoom(this.code, view, this.revision)
          .then(() => { for (const [ws, msg] of routes) send(ws, msg); }));
      } else for (const [ws, msg] of routes) send(ws, msg);
      for (const { task, error, value } of outcomes) error ? task.reject(error) : task.resolve(value);
      if (this.volatile && this.checkpointTimer === null) {
        // 이 일회성 타이머가 끝나기 전에는 유휴 hibernation으로 미저장 입력을 잃지 않는다.
        this.checkpointTimer = setTimeout(() => {
          this.checkpointTimer = null;
          this.ctx.waitUntil(this.enqueue(() => { this.dirty = true; }));
        }, 1000);
      }
    } catch (error) {
      this.deliveries = [];
      for (const task of tasks) task.reject(error);
      for (const ws of this.ctx.getWebSockets()) ws.close(1011, 'State unavailable');
      this.ctx.abort('Room storage or settlement unavailable');
    } finally {
      this.draining = false;
      if (this.tasks.length) { this.draining = true; setTimeout(() => this.ctx.waitUntil(this.flush()), 5); }
    }
  }
  async planAlarm() {
    const room = this.room();
    let desired = Object.keys(this.pending).length ? Date.now() + 2000 : null;
    if (room) desired = Math.min(desired ?? Infinity, room.paused ? room.deadline : room.state && !room.finished ? Date.now() + 10000 : this.expires);
    const current = await this.ctx.storage.getAlarm();
    if (desired !== null && (current === null || desired < current)) await this.ctx.storage.setAlarm(desired);
    else if (desired === null && current !== null) await this.ctx.storage.deleteAlarm();
  }
  fetch() { return accept(this.ctx, 6); }
  reserve(profile, options) {
    return this.enqueue(() => {
      if (this.code && this.code !== options.code) throw new Error('invalid room');
      if (this.room()?.peers.some(p => p.profileId === profile.id)) return this.view();
      this.profileCache[profile.id] = profile;
      const peer = this.makePeer(null); peer.silent = true; this.identity = { profile };
      try {
        this.lobby.handle(peer, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION });
        this.lobby.handle(peer, options.type === 'create' ? options : { type: 'join', code: this.code, password: options.password });
      } finally { this.identity = null; }
      if (!peer.room) { this.lobby.peers.delete(peer); throw new Error('방 설정·비밀번호 또는 입장 가능 여부를 확인해 주세요.'); }
      if (options.type === 'create') {
        this.code = options.code;
        this.lobby.rooms.delete(peer.room.code); peer.room.code = this.code; this.lobby.rooms.set(this.code, peer.room);
      }
      peer.disconnected = true; this.lobby.peers.delete(peer);
      this.dirty = true;
      return this.view();
    });
  }
  webSocketMessage(ws, data) {
    return this.enqueue(async () => {
      try {
        const meta = rateLimit(ws), msg = parseMessage(data);
        if (msg.type === 'ping') { this.deliveries.push([ws, { type: 'pong', time: msg.time }]); return; }
        if (msg.type === 'hello') {
          try { checkVersion(msg); } catch (error) { this.deliveries.push([ws, { type: 'incompatible', reason: error.message }]); return; }
          if (meta.profileId || typeof msg.token !== 'string') throw new Error('authentication required');
          const identity = await this.env.DIRECTORY.getByName('lobby').identify(msg.token);
          if (!this.room()?.peers.some(p => p.profileId === identity.profile.id)) {
            this.deliveries.push([ws, { type: 'route', code: null }]); return;
          }
          if (this.room().peers.some(p => p.profileId === identity.profile.id && !p.disconnected)) {
            this.deliveries.push([ws, { type: 'error', retryable: true, reason: '이전 연결을 확인하고 있습니다. 잠시 후 재접속합니다.' }]); return;
          }
          this.profileCache[identity.profile.id] = identity.profile;
          const peer = this.makePeer(ws); this.identity = { ...identity, heartbeat: 'auto' };
          try { this.lobby.handle(peer, msg); } finally { this.identity = null; }
          ws.serializeAttachment({ ...meta, profileId: identity.profile.id });
          this.actions[identity.profile.id] = Date.now();
          this.dirty = true;
          return;
        }
        const peer = this.room()?.peers.find(p => p.profileId === meta.profileId && p.ws === ws && !p.disconnected);
        if (!peer) throw new Error('먼저 방에 접속해 주세요.');
        const wasFinished = !!this.room().finished;
        this.lobby.handle(peer, msg);
        if (['input', 'inputBatch'].includes(msg.type)) {
          this.meter.inputMessages++; this.meter.inputFrames += msg.type === 'inputBatch' ? msg.inputs.length : 1;
        }
        this.actions[peer.profileId] = Date.now();
        if (['input', 'inputBatch'].includes(msg.type)) this.volatile = true;
        else this.dirty = true;
        if ((wasFinished && msg.type === 'returnRoom') || (!wasFinished && this.room()?.finished)) this.expires = Date.now() + 600000;
      } catch (error) { this.deliveries.push([ws, { type: 'error', reason: error.message }]); }
    });
  }
  webSocketClose(ws) {
    return this.enqueue(() => {
      const id = ws.deserializeAttachment()?.profileId;
      const peer = this.room()?.peers.find(p => p.profileId === id && p.ws === ws);
      if (peer && !peer.disconnected) { this.lobby.disconnect(peer); this.dirty = true; }
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() {
    return this.enqueue(() => {
      closeUnauthenticated(this.ctx);
      const room = this.room();
      if (!room) return;
      if (room.state && !room.finished && !room.paused) for (const peer of room.peers) {
        if (!peer.disconnected && Date.now() - (this.actions[peer.profileId] ?? 0) >= 30000) {
          this.lobby.disconnect(peer); peer.ws?.close(1001, 'Idle');
        }
      }
      this.lobby.sweep();
      if (this.room() && (!room.state || room.finished) && Date.now() >= this.expires) this.lobby.leave(room.peers[0]);
      this.dirty = true;
    });
  }
}
