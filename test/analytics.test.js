import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, cleanURL } from '../src/analytics/client.js';
import { ANALYTICS_CONFIG } from '../src/analytics/config.js';
import { eventParams } from '../src/analytics/events.js';
import { createRoundTracker } from '../src/analytics/round.js';
import { createOnlineTelemetry } from '../src/analytics/online.js';
import { createDiagnostics } from '../server/cloudflare/diagnostics.js';

function fixture() {
  const scripts = [];
  const view = { location: { hostname: 'game.example', protocol: 'https:', href: 'https://game.example/play?room=SECRET#secret' },
    navigator: {}, localStorage: { getItem() { return null; } },
    document: { referrer: 'https://example.com/invite?token=SECRET#secret', head: { append(script) { scripts.push(script); } }, createElement() { return {}; } } };
  const config = { production: 'G-PROD', development: 'G-DEV', allowedHosts: ['game.example'] };
  return { scripts, view, config };
}
const info = { version: '0.1.0', dirty: false, deployment: 'production' };

test('deployed development and production builds send page and play events to the existing GA property', () => {
  for (const deployment of ['development', 'production']) {
    const f = fixture();
    f.view.location = new URL('https://seongyonglee.github.io/chii-drop/');
    const client = createAnalytics({ view: f.view });
    client.track('game_ready', { load_ms: 100 });
    client.start({ ...info, deployment });
    assert.equal(f.scripts.length, 1);
    assert.equal(f.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_CONFIG.production}`);
    f.scripts[0].onload();
    const rounds = createRoundTracker({ track: (...args) => client.track(...args) });
    rounds.begin('test-round', { mode: 'cpu', role: 'player' });
    rounds.end('test-round', { winner: 0 });
    assert.equal(client.state, 'ready');
    const events = f.view.dataLayer.map(args => [...args]).filter(call => call[0] === 'event');
    assert.deepEqual(events.map(call => call[1]), ['page_view', 'game_ready', 'round_started', 'round_ended']);
    for (const [, , params] of events) {
      assert.equal(params.send_to, 'G-99S8RZ03E0');
      assert.equal(params.environment, deployment);
    }
  }
});

test('GA is off on local, dirty, unconfigured, opted-out and privacy-controlled sessions', () => {
  for (const mutate of [f => { f.config.production = ''; }, f => { f.view.location.hostname = 'localhost'; },
    f => { f.view.navigator.globalPrivacyControl = true; }, f => { f.view.localStorage.getItem = () => 'true'; },
    f => { f.view.localStorage.getItem = () => { throw Error('blocked'); }; }]) {
    const f = fixture(); mutate(f); const client = createAnalytics(f);
    client.track('game_ready'); client.start(info);
    assert.equal(client.state, 'disabled'); assert.equal(f.scripts.length, 0);
  }
  const f = fixture(), client = createAnalytics(f); client.start({ ...info, dirty: true });
  assert.equal(f.scripts.length, 0);
});

test('only sanitized events and URLs are sent, page view once, development ID is isolated', () => {
  const f = fixture(), client = createAnalytics(f);
  client.track('round_started', { mode: 'cpu', role: 'player', char_id: 'char-1', password: 'SECRET', token: 'SECRET', room: 'SECRET' });
  client.start({ ...info, deployment: 'development' }); f.scripts[0].onload();
  client.start(info); f.scripts[0].onload();
  const calls = f.view.dataLayer.map(args => [...args]);
  assert.equal(calls.filter(c => c[1] === 'page_view').length, 1);
  assert.equal(calls.find(c => c[0] === 'config')[1], 'G-DEV');
  assert.equal(calls.find(c => c[0] === 'config')[2].send_page_view, false);
  assert.equal(JSON.stringify(calls).includes('SECRET'), false);
  assert.equal(calls.at(-1)[2].mode, 'cpu');
  assert.equal(calls.at(-1)[2].page_location, 'https://game.example/play');
  assert.equal(cleanURL('javascript:bad'), '');
  assert.equal(eventParams('arbitrary_event', {}), null);
  assert.deepEqual(eventParams('round_ended', { mode: 'secret', score: Infinity, play_ms: -1, error: 'secret' }), {});
});

test('blocked script has bounded buffering, no retry or impact on game callers', async () => {
  const f = fixture(), client = createAnalytics({ ...f, timeoutMs: 5 });
  for (let i = 0; i < 500; i++) client.track('game_ready', { load_ms: i });
  client.start(info);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(client.state, 'disabled'); f.scripts[0].onload();
  assert.equal(f.view.dataLayer.length, 0);
  assert.doesNotThrow(() => client.track('round_ended', { score: 3 }));
  const g = fixture(), buffered = createAnalytics(g);
  for (let i = 0; i < 500; i++) buffered.track('game_ready');
  buffered.start(info); g.scripts[0].onload();
  assert.equal(g.view.dataLayer.filter(c => c[1] === 'game_ready').length, 48);
});

test('reconnect, repeated results and snapshots do not duplicate rounds; spectators stay separate', () => {
  const events = [], round = createRoundTracker({ track: (...args) => events.push(args) });
  round.begin('private-id', { mode: 'cpu', role: 'player' });
  round.begin('private-id', { mode: 'cpu', role: 'player' });
  round.end('private-id', { winner: 0, player: { score: 120, maxChain: 3 }, playMs: 2000 });
  round.end('private-id', { winner: 1 }); round.viewed('private-id'); round.viewed('private-id'); round.action('private-id', 'retry');
  assert.deepEqual(events.map(e => e[0]), ['round_started','round_ended','result_viewed','result_action']);
  assert.equal(events[1][1].outcome, 'win'); assert.equal(JSON.stringify(events).includes('private-id'), false);
  round.begin('watch', { mode: 'watch', role: 'spectator' }); round.end('watch', { winner: 0 });
  assert.equal(events.at(-1)[1].mode, 'cpu_watch'); assert.equal(events.at(-1)[1].outcome, 'not_applicable');
  round.begin('quit', { mode: 'solo', role: 'player' }); round.end('quit', { reason: 'quit' }); round.end('quit');
  assert.equal(events.at(-1)[1].end_reason, 'quit');
});

test('online routes preserve request timing and match identity; failure messages never escape', () => {
  let time = 0, timeout;
  const events = [], online = createOnlineTelemetry({ track: (...args) => events.push(args), now: () => time,
    schedule: cb => { timeout = cb; return 1; }, cancel() {} });
  online.requestStart('join', true); time = 100; online.joined();
  assert.equal(events.at(-1)[1].elapsed_ms, 100);
  online.begin('m', { role: 'player' }, true);
  online.connectionIssue('playing', 'socket_closed'); online.connectionIssue('playing', 'socket_closed');
  online.attempt(); online.recovered('lobby');
  assert.equal(events.at(-1)[0], 'connection_issue');
  online.begin('m', { role: 'player' }, false); time = 600; online.recovered('playing');
  assert.equal(events.filter(e => e[0] === 'round_started').length, 1);
  assert.equal(events.at(-1)[1].recovery_ms, 500);
  online.end({ winner: 1, side: 1 }); online.end({ winner: 1, side: 1 }); online.viewed(); online.viewed();
  assert.equal(events.filter(e => e[0] === 'round_ended').length, 1);
  online.requestStart('create', true); timeout();
  assert.equal(events.at(-1)[1].error_code, 'request_timeout');
  online.requestStart('join', true); online.failed('비밀번호 SECRET');
  assert.equal(JSON.stringify(events).includes('SECRET'), false);
  online.begin('restored-without-start', { role: 'player' }, false); online.end({ winner: 0 });
  assert.equal(events.filter(e => e[0] === 'round_ended').length, 1);
});

test('server diagnostics omit secrets, throttle repeated failures and tolerate logger failure', () => {
  let time = 0; const lines = [];
  const log = createDiagnostics('room', { write: line => lines.push(line), now: () => time });
  for (let i = 0; i < 30; i++) log('request_failed', '비밀번호 SECRET', 'join');
  assert.equal(lines.length, 5); assert.equal(lines.join('').includes('SECRET'), false);
  time = 60001; log('request_failed', '비밀번호 SECRET', 'join'); assert.equal(lines.length, 6);
  assert.doesNotThrow(() => createDiagnostics('room', { write() { throw Error('broken'); } })('server_error'));
});

test('switching from player to spectator retains separate participation and delayed forfeits', () => {
  const events = [], online = createOnlineTelemetry({ track: (...args) => events.push(args) });
  online.begin('m', { role: 'player' }, true); online.end({ reason: 'quit' });
  online.begin('m', { role: 'spectator' }, true); online.end({ winner: 0 }); online.viewed();
  online.endFor('m', { reason: 'forfeit', winner: 1, side: 0 });
  assert.deepEqual(events.filter(e => e[0] === 'round_ended').map(e => e[1].role), ['player', 'spectator']);
  online.begin('next', { role: 'player' }, true); online.waiting();
  online.endFor('next', { reason: 'forfeit', winner: 1, side: 0 });
  assert.equal(events.at(-1)[1].outcome, 'loss');
});
