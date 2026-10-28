import test from 'node:test';
import assert from 'node:assert/strict';
import { prefersReducedMotion } from '../src/view/motion-preference.js';
test('repeated animation frames reuse the media query while live OS changes remain visible',t=>{
  const old=globalThis.matchMedia;let calls=0;const media={matches:false};
  globalThis.matchMedia=pattern=>{assert.equal(pattern,'(prefers-reduced-motion: reduce)');calls++;return media;};
  t.after(()=>{if(old===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=old;});
  for(let i=0;i<3600;i++)assert.equal(prefersReducedMotion(),false);
  assert.equal(calls,1);media.matches=true;assert.equal(prefersReducedMotion(),true);assert.equal(calls,1);
  globalThis.matchMedia=()=>({matches:false});assert.equal(prefersReducedMotion(),false);
});
