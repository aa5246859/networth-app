import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('let strategyNotificationRoute=0;'),source.indexOf('function participationKey('));
function setup(posts=[]){
  const card={dataset:{strategyOwner:'author',strategyPost:'p1'},querySelector(){return {setAttribute(){},focus(){}}},scrollIntoView(){this.scrolled=true}};
  const s={user:{uid:'viewer'},demo:false,session:1,friends:[],friendPosts:[],ownPosts:[],page:'home'};
  const errors=[];
  const context=vm.createContext({s,URLSearchParams,cloud:{strategies:async()=>posts},render(){},requestAnimationFrame:fn=>fn(),document:{querySelectorAll:()=>[card]},subscribeParticipation(){},toast:text=>errors.push(text),message:e=>e.message});
  vm.runInContext(helpers,context);return {context,s,card,errors};
}
test('notification identifies one strategy; category is resolved from current strategy data',async()=>{
  const {context,s,card}=setup([{id:'p1',published:true,term:'short',ownerName:'Author'}]);
  const link=vm.runInContext('parseStrategyNotification("#sharing?owner=author&post=p1&term=long")',context);
  await context.openStrategyNotification(link);
  assert.equal(s.page,'sharing');assert.equal(s.friend,'author');assert.equal(s.sharingTab,'short');assert.equal(s.notificationTarget.postId,'p1');assert.equal(card.open,true);assert.equal(card.scrolled,true);
});
test('invalid notification identifiers are not routed',()=>{
  const {context}=setup();
  assert.equal(vm.runInContext('parseStrategyNotification("#sharing?owner=author&post=bad%2Fid")',context),null);
  assert.equal(vm.runInContext('parseStrategyNotification("#home")',context),null);
});
test('notification remains in URL until login and then resolves',async()=>{
  const {context,s}=setup([{id:'p1',published:true,term:'long'}]);
  s.user=null;const link={ownerUid:'author',postId:'p1',term:'long'};
  await context.openStrategyNotification(link);assert.equal(s.page,'home');
  s.user={uid:'viewer'};await context.openStrategyNotification(link);assert.equal(s.friend,'author');assert.equal(s.notificationTarget.postId,'p1');
  assert.ok(source.includes('const initial=location.hash.slice(1).split("?")[0]'));
  assert.ok(source.includes('if(notificationLink)await openStrategyNotification(notificationLink)'));
});
test('removed sharing permission shows a reason and does not display stale target data',async()=>{
  const {context,s,errors}=setup();
  context.cloud.strategies=async()=>{const error=new Error('denied');error.code='permission-denied';throw error};
  await context.openStrategyNotification({ownerUid:'author',postId:'p1'});
  assert.equal(s.notificationTarget,null);assert.equal(s.friendPosts.length,0);assert.ok(errors[0].includes('沒有查看權限'));
});
test('an outstanding strategy navigation cannot overwrite a new session',async()=>{
  const {context,s}=setup();let resolve;
  context.cloud.strategies=()=>new Promise(r=>resolve=r);
  const opening=context.openStrategyNotification({ownerUid:'author',postId:'p1'});
  s.session++;s.user=null;resolve([{id:'p1',published:true,term:'long'}]);await opening;
  assert.equal(s.notificationTarget,null);
});
test('notification click awaits navigation before focusing an existing app window',async()=>{
  const handlers={},actions=[];
  const existing={url:'https://example.test/app/#home',async navigate(url){actions.push(url);return this},focus(){actions.push('focus')}};
  const context=vm.createContext({URL,Response,self:{addEventListener(name,fn){handlers[name]=fn},registration:{scope:'https://example.test/app/'},clients:{matchAll:async()=>[existing],openWindow(){throw Error('unexpected new window')}}}});
  vm.runInContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
  let pending;
  handlers.notificationclick({notification:{data:{url:'./#sharing?owner=author&post=p1&term=short'},close(){}},waitUntil(p){pending=p}});
  await pending;assert.deepEqual(actions,['https://example.test/app/#sharing?owner=author&post=p1&term=short','focus']);
});
