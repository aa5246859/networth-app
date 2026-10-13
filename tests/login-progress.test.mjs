import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('let loginState="idle";'),source.indexOf('\nfunction toast('));
const funcs=['showLogin','showApp','startUser','initFirebase'].map(name=>source.split('\n').find(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('))).join('\n');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function setup(){
  const nodes=new Map();
  const element=id=>{if(!nodes.has(id)){const classes=new Set(['appView','pendingView','loginProgress'].includes(id)?['hidden']:[]);nodes.set(id,{disabled:false,innerHTML:'',textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,force){if(force??!classes.has(x))classes.add(x);else classes.delete(x)}}})}return nodes.get(id)};
  let calls=0,observer;
  const s={user:null,demo:false,session:0,friends:[],ownPosts:[],friendPosts:[],subscriptions:[],page:'home'};
  const cloud={connect:async()=>{},watchAuth(fn){observer=fn;return ()=>{}},login:async()=>{calls++},checkAccess:async()=>'approved',loadUser:async()=>({}),listenUser:()=>[],listenFriends:()=>[],listenInvitations:()=>[]};
  const context=vm.createContext({s,cloud,$:element,location:{hash:'#home'},PAGES:{home:[],sharing:[]},notifications:{appOpened:async()=>{}},stopSession(){s.session++;s.user=null;s.subscriptions=[]},render(){},syncSelection(){},message:e=>e.message,toast(){},parseStrategyNotification:()=>null,openStrategyNotification:async()=>{},refreshOwn:async()=>{},saveSnapshot:async()=>{},loadSharing:async()=>{},setTimeout,clearTimeout});
  vm.runInContext('let firebaseReady=true,authUnsubscribe=null;'+helper+'\n'+funcs,context);
  return {context,s,node:element,cloud,loginCalls:()=>calls,observer:()=>observer,state:()=>vm.runInContext('loginState',context)};
}
const user={uid:'user',displayName:'Test'};
test('login stays locked after Google resolves until authorization and data have loaded',async()=>{
  const h=setup(),popup=deferred(),profile=deferred();let calls=0;
  h.cloud.login=()=>{calls++;return popup.promise};
  h.cloud.loadUser=()=>profile.promise;
  const login=h.context.beginLogin();await h.context.beginLogin();await h.context.beginLogin();
  assert.equal(calls,1);assert.equal(h.node('loginButton').disabled,true);assert.ok(h.node('loginButton').innerHTML.includes('登入中'));
  popup.resolve();await login;
  assert.equal(h.node('loginButton').disabled,true);
  const loading=h.context.startUser(user);await Promise.resolve();
  assert.equal(h.state(),'loading');assert.equal(h.node('demoButton').disabled,true);
  assert.equal(h.node('loginProgress').classList.contains('hidden'),false);
  assert.ok(h.node('loginProgressDetail').textContent.includes('完成後會自動進入'));
  await h.context.beginLogin();assert.equal(calls,1);
  profile.resolve({});await loading;
  assert.equal(h.node('loginView').classList.contains('hidden'),true);
  assert.equal(h.node('appView').classList.contains('hidden'),false);
});
test('an existing Google session shows data loading without asking for another login',async()=>{
  const h=setup(),profile=deferred();h.cloud.loadUser=()=>profile.promise;
  const loading=h.context.startUser(user);
  assert.equal(h.node('loginButton').disabled,true);
  profile.resolve({});await loading;
  assert.equal(h.loginCalls(),0);assert.equal(h.state(),'idle');
  assert.equal(h.node('loginProgress').classList.contains('hidden'),true);
});
test('Firebase connection does not reenable login before the first auth result',async()=>{
  const h=setup();vm.runInContext('firebaseReady=false',h.context);
  await h.context.initFirebase();assert.equal(h.node('loginButton').disabled,true);
  await h.observer()(null);assert.equal(h.node('loginButton').disabled,false);
  assert.ok(h.node('loginButton').innerHTML.includes('使用 Google 登入'));
});
test('a cancelled Google popup unlocks retry and displays the actual error',async()=>{
  const h=setup();h.cloud.login=async()=>{throw new Error('Google 登入已取消')};
  await h.context.beginLogin();assert.equal(h.state(),'error');
  assert.equal(h.node('loginButton').disabled,false);assert.equal(h.node('demoButton').disabled,false);
  assert.equal(h.node('loginError').textContent,'Google 登入已取消');assert.equal(h.node('loginButton').innerHTML,'重新登入');
});
test('failed profile reading can retry the existing authenticated session',async()=>{
  const h=setup();h.cloud.loadUser=async()=>{throw new Error('資料讀取失敗')};
  await h.context.startUser(user);assert.equal(h.state(),'error');assert.equal(h.node('loginButton').disabled,false);
  assert.equal(h.node('loginError').textContent,'資料讀取失敗');
  h.cloud.loadUser=async()=>({});await h.context.beginLogin();
  assert.equal(h.loginCalls(),0);assert.equal(h.node('appView').classList.contains('hidden'),false);
});
test('pending or denied access continues to show the existing authorization screen',async()=>{
  for(const status of ['pending','denied']){
    const h=setup();h.cloud.checkAccess=async()=>status;
    await h.context.startUser(user);
    assert.equal(h.node('pendingView').classList.contains('hidden'),false);
    assert.equal(h.node('loginView').classList.contains('hidden'),true);
    assert.equal(h.node('appView').classList.contains('hidden'),true);
  }
});
test('an old loading result cannot override a newer logged-out session',async()=>{
  const h=setup(),profile=deferred();h.cloud.loadUser=()=>profile.promise;
  const loading=h.context.startUser(user);await Promise.resolve();
  h.context.showLogin();profile.resolve({});await loading;
  assert.equal(h.node('loginView').classList.contains('hidden'),false);
  assert.equal(h.node('appView').classList.contains('hidden'),true);
  assert.equal(h.node('loginButton').disabled,false);
});
test('connection failure provides a reconnect action instead of a stuck spinner',async()=>{
  const h=setup();vm.runInContext('firebaseReady=false',h.context);h.cloud.connect=async()=>{throw new Error('連線失敗')};
  await h.context.initFirebase();assert.equal(h.node('loginButton').disabled,false);assert.equal(h.node('loginButton').innerHTML,'重新連線');assert.equal(h.node('loginProgress').classList.contains('hidden'),true);
});
