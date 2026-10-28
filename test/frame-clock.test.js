import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { startOnlineFrameClock } from '../src/net/frame-clock.js';

function fixture({ broken = false } = {}) {
  let now = 0, frame, worker, next = 0;
  const events = new Map(), timers = new Map(), ticks = [];
  const page = { hidden: false, addEventListener: (key, cb) => events.set(key, cb), removeEventListener: key => events.delete(key) };
  const view = { performance: { now: () => now }, requestAnimationFrame: cb => { frame = cb; return 1; }, cancelAnimationFrame: () => { frame = null; },
    setInterval: cb => { timers.set(++next, cb); return next; }, clearInterval: id => timers.delete(id),
    Worker: class { constructor() { if (broken) throw new Error('unavailable'); worker = this; this.messages = []; }
      postMessage(msg) { this.messages.push(msg); } terminate() { this.terminated = true; } } };
  let enabled = true;
  const clock = startOnlineFrameClock({ view, page, tick: time => ticks.push(time), enabled: () => enabled });
  return { clock, page, timers, ticks, events, get worker() { return worker; },
    display(time) { now = time; frame?.(time); }, hide(value) { page.hidden = value; events.get('visibilitychange')?.(); },
    background(time) { now = time; worker.onmessage({ data: 'tick' }); }, enable(value) { enabled = value; clock.refresh(); } };
}

test('hidden player continues 60 frame ticks without any animation frames, and foreground never double ticks', () => {
  const f = fixture(); f.display(0); f.hide(true);
  for (let n = 1; n <= 600; n++) f.background(n * 1000 / 60);
  assert.equal(f.ticks.length, 601); assert.deepEqual(f.worker.messages, ['start', 'watch', 'start']);
  f.display(10001); assert.equal(f.ticks.length, 601);
  f.hide(false); f.display(10001); f.background(10002); assert.equal(f.ticks.length, 602);
  f.display(10020); assert.equal(f.ticks.length, 603); assert.deepEqual(f.worker.messages, ['start', 'watch', 'start', 'watch']);
  f.clock.stop(); assert.equal(f.worker.terminated, true); assert.equal(f.events.size, 0);
});

test('closed online mode stops its background clock and reopening starts it', () => {
  const f = fixture(); f.hide(true); f.enable(false); f.background(20);
  assert.equal(f.ticks.length, 0); assert.deepEqual(f.worker.messages, ['start', 'stop']);
  f.enable(true); f.background(40); assert.deepEqual(f.ticks, [40]); f.clock.stop();
});

test('unavailable or failed Worker falls back to a timer and cleans up on visibility changes', () => {
  for (const broken of [true, false]) {
    const f = fixture({ broken }); f.hide(true); if (!broken) f.worker.onerror();
    assert.equal(f.timers.size, 1); [...f.timers.values()][0](); assert.equal(f.ticks.length, 1);
    f.enable(false); assert.equal(f.timers.size, 0); f.clock.stop();
  }
});

test('clock Worker only runs one interval and stops it when requested', () => {
  const self = {}, timers = new Map(); let count = 0, posts = 0;
  self.postMessage = () => posts++;
  runInNewContext(readFileSync(new URL('../src/net/frame-clock-worker.js', import.meta.url), 'utf8'), {
    self, setInterval(cb, ms) { assert.equal(ms, 1000 / 60); timers.set(++count, cb); return count; }, clearInterval(id) { timers.delete(id); },
  });
  self.onmessage({ data: 'start' }); self.onmessage({ data: 'start' }); assert.equal(timers.size, 1);
  [...timers.values()][0](); assert.equal(posts, 1);
  self.onmessage({ data: 'stop' }); assert.equal(timers.size, 0);
});

test('visible-but-detached embedded tab continues when animation frames stop', () => {
  const f = fixture(); f.display(0); f.background(16); f.background(33); assert.equal(f.ticks.length, 1);
  for (let n = 3; n <= 60; n++) f.background(n * 1000 / 60);
  assert.equal(f.ticks.length, 59); f.display(1016); f.background(1033); assert.equal(f.ticks.length, 60); f.clock.stop();
});


test('120Hz and 144Hz displays draw 60 times per second without slowing the frame clock', () => {
  for (const hz of [60, 120, 144]) {
    const f = fixture();
    for (let n = 0; n < hz * 10; n++) f.display(n * 1000 / hz);
    assert.equal(f.ticks.length, 600, `${hz}Hz`); f.clock.stop();
  }
});


test('foreground Worker wakes only 10 times per second, switching immediately to 60Hz when hidden', () => {
  const self = {}, timers = new Map(); let count = 0;
  runInNewContext(readFileSync(new URL('../src/net/frame-clock-worker.js', import.meta.url), 'utf8'), {
    self, setInterval(cb, ms) { timers.set(++count, {cb, ms}); return count; }, clearInterval(id) { timers.delete(id); },
  });
  self.onmessage({data:'watch'}); self.onmessage({data:'watch'});
  assert.equal(timers.size,1); assert.equal([...timers.values()][0].ms,100);
  self.onmessage({data:'start'}); assert.equal(timers.size,1); assert.equal([...timers.values()][0].ms,1000/60);
  self.onmessage({data:'stop'}); assert.equal(timers.size,0);
});
