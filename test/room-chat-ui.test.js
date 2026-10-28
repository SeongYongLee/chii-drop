import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRoomChat } from '../src/net/room-chat.js';
import { ONLINE_PORTRAIT_QUERY } from '../src/net/stage-layout.js';
function fixture() {
  const node = () => ({ hidden:false, disabled:false, value:'', textContent:'', children:[], scrollHeight:100,scrollTop:0,clientHeight:100,
    style:{setProperty(){}},dataset:{},classList:{toggle(){}},attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){},
    replaceChildren(){this.children=[];},append(...v){this.children.push(...v);},getBoundingClientRect(){return {left:0,top:0,width:960,height:540};} });
  const nodes = new Map(); const get = id => { if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let change; const media={matches:false,addEventListener(_,cb){change=cb;}};
  const view={matchMedia:query=>{assert.equal(query,ONLINE_PORTRAIT_QUERY);return media;},ResizeObserver:class{observe(){}}};
  const root={getElementById:get,ownerDocument:{createElement:node}},shell=node(),sent=[];
  const chat=attachRoomChat(root,shell,{view,send:m=>sent.push(m)}); chat.enter('12345678');
  const state={playing:true,finished:false,spectating:false,connected:true,playerId:'me'};
  return {chat,get,shell,sent,state,portrait(value){media.matches=value;change();}};
}
test('portrait active player is locked to a one-line preview without a read-only notice',()=>{
  const f=fixture(); f.portrait(true);f.chat.update(f.state);
  assert.equal(f.shell.dataset.chatExpanded,'false'); assert.equal(f.get('chat-toggle').disabled,true); assert.equal(f.get('chat-toggle').hidden,true);
  f.get('chat-toggle').onclick();assert.equal(f.shell.dataset.chatExpanded,'false');
  assert.equal(f.get('chat-form').hidden,true);assert.equal(f.get('chat-status').textContent,'');
  f.chat.receive({code:'12345678',message:{id:1,playerId:'watcher',name:'관전자',text:'응원합니다'}});
  assert.equal(f.get('chat-preview').textContent,'응원합니다');assert.equal(f.get('chat-preview').attrs['aria-label'],'관전자: 응원합니다');
});
test('landscape player can expand history and orientation change locks it without losing messages',()=>{
  const f=fixture();f.chat.update(f.state);f.get('chat-toggle').onclick();
  assert.equal(f.shell.dataset.chatExpanded,'true');assert.equal(f.get('chat-form').hidden,true);
  f.portrait(true);assert.equal(f.shell.dataset.chatExpanded,'false');
  f.portrait(false);assert.equal(f.shell.dataset.chatExpanded,'true');
});
test('observer defaults open, may collapse, and can chat in either orientation',()=>{
  const f=fixture();f.portrait(true);f.chat.update({...f.state,spectating:true});
  assert.equal(f.shell.dataset.chatExpanded,'true');assert.equal(f.get('chat-toggle').disabled,false);assert.equal(f.get('chat-toggle').hidden,false);
  assert.equal(f.get('chat-form').hidden,false);f.get('chat-input').value='안녕하세요';f.get('chat-form').onsubmit({preventDefault(){}});
  assert.deepEqual(f.sent,[{type:'chat',text:'안녕하세요'}]);
  f.get('chat-toggle').onclick();assert.equal(f.shell.dataset.chatExpanded,'false');
  f.portrait(false);assert.equal(f.shell.dataset.chatExpanded,'false');
});
test('result unlocks player chat; switching from player to observer opens the chat',()=>{
  const f=fixture();f.portrait(true);f.chat.update(f.state);
  f.chat.update({...f.state,finished:true});assert.equal(f.get('chat-toggle').disabled,false);assert.equal(f.get('chat-toggle').hidden,false);assert.equal(f.get('chat-form').hidden,false);
  f.chat.update(f.state);assert.equal(f.shell.dataset.chatExpanded,'false');f.chat.update({...f.state,spectating:true});assert.equal(f.shell.dataset.chatExpanded,'true');
});
