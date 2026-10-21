import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const block=app.slice(app.indexOf('let quoteRefreshJob=null;'),app.indexOf('async function saveSnapshot('));
const asset=(id,symbol='BTC')=>({id,name:symbol,mode:'crypto',symbol,qty:1,costPer:100,quote:{nativePrice:100,fx:32,fetchedAt:'2026-10-16T00:00:00Z'}});
function setup(overrides={}){
  const s={session:1,user:{uid:'owner'},demo:false,page:'home',sharingTab:'portfolios',friend:'self',shareDirty:false,refreshing:false,lastQuoteAttempt:0,lastRefresh:123,assets:[asset('own')],friends:[{id:'a',portfolioAccess:true,assets:[asset('a')]},{id:'b',portfolioAccess:true,assets:[asset('b','ETH')]}],settings:{finnhubKey:'key'}};
  let now=Date.now(),calls=[],saves=[],toasts=[];
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const fresh=async(assets,key,{now})=>({updates:assets.filter(a=>a.mode!=='manual').map(a=>({id:a.id,mode:a.mode,symbol:a.symbol,quote:{nativePrice:200,fx:32,fetchedAt:now.toISOString(),error:''}})),issues:[],fx:null});
  const cloud={saveQuotes:async(uid,updates)=>{saves.push({uid,updates});return updates;}};
  const stockPremarket=async()=>({quotes:{}});
  const context={s,Date:Clock,AUTO_QUOTE_INTERVAL:60000,document:{visibilityState:'visible',querySelector:()=>null,activeElement:null},render(){},toast:(value,error)=>toasts.push({value,error}),message:error=>error.message||'failed',cloud,stockPremarket,refreshMarket:async(...args)=>{calls.push(args);return (overrides.market||fresh)(...args);},...overrides.context};
  const api=vm.runInNewContext(block+'\n({refreshOwn,refreshFriend,autoRefreshQuotes,mergeFriendQuotes});',context);
  return {s,api,calls,saves,toasts,context,advance:amount=>{now+=amount;},fresh};
}
test('visible shared portfolio automatically batches own and friend quotes and writes only own updates',async()=>{
  const x=setup();x.s.page='sharing';x.s.friend='a';await x.api.autoRefreshQuotes();
  assert.equal(x.calls.length,1);assert.equal(x.calls[0][0].length,2);assert.equal(x.s.assets[0].quote.nativePrice,200);assert.equal(x.s.friends[0].assets[0].quote.nativePrice,200);
  assert.equal(x.calls[0][2].premarketFetcher,x.context.stockPremarket);
  assert.equal(x.saves.length,1);assert.equal(x.saves[0].updates[0].id,'own');assert.equal(x.s.friends[0].localRefreshed,x.s.friends[0].assets[0].quote.fetchedAt);
  assert.equal(x.toasts.length,0);assert.equal(x.s.refreshing,false);
});
test('automatic refresh waits a minute while manual refresh can always fetch immediately',async()=>{
  const x=setup();await x.api.autoRefreshQuotes();await x.api.autoRefreshQuotes();assert.equal(x.calls.length,1);
  x.advance(59000);await x.api.autoRefreshQuotes();assert.equal(x.calls.length,1);
  await x.api.refreshOwn();assert.equal(x.calls.length,2);
  x.advance(60000);await x.api.autoRefreshQuotes();assert.equal(x.calls.length,3);
});
test('switching friends during an outstanding request queues the newly viewed friend instead of dropping it',async()=>{
  let finish;const x=setup({market:async(...args)=>{if(!finish)return new Promise(resolve=>{finish=()=>resolve(x.fresh(...args));});return x.fresh(...args);}});
  x.s.page='sharing';x.s.friend='a';const first=x.api.autoRefreshQuotes();await Promise.resolve();
  x.s.friend='b';const next=x.api.autoRefreshQuotes();finish();await Promise.all([first,next]);
  assert.equal(x.calls.length,2);assert.equal(x.s.friends[1].assets[0].quote.nativePrice,200);assert.equal(x.s.friends[1].quoteRefreshError,'');
});
test('a live friend snapshot keeps newer queried quotes while taking new quantities and removing revoked holdings',async()=>{
  const x=setup();x.s.page='sharing';x.s.friend='a';await x.api.autoRefreshQuotes();
  const incoming=[{id:'a',portfolioAccess:true,assets:[{...asset('a'),qty:7}]}];
  const [merged]=x.api.mergeFriendQuotes(incoming);assert.equal(merged.assets[0].qty,7);assert.equal(merged.assets[0].quote.nativePrice,200);
  const [revoked]=x.api.mergeFriendQuotes([{id:'a',portfolioAccess:false,assets:[]}]);assert.equal(revoked.assets.length,0);assert.equal(revoked.localRefreshed,undefined);
});
test('failed quotes keep the last successful time and show a status without claiming a successful update',async()=>{
  const x=setup({market:async assets=>({updates:assets.map(a=>({id:a.id,mode:a.mode,symbol:a.symbol,quote:{...a.quote,error:'報價來源暫時無法使用'}})),issues:['報價來源暫時無法使用'],fx:null})});
  const before=x.s.lastRefresh;await x.api.autoRefreshQuotes();assert.equal(x.s.lastRefresh,before);assert.equal(x.s.assets[0].quote.nativePrice,100);assert.match(x.s.quoteRefreshError,/暫時無法使用/);assert.equal(x.toasts.length,0);
  x.advance(60000);await x.api.autoRefreshQuotes();assert.equal(x.calls.length,2);
});
test('a thrown quote error does not become an unhandled automatic rejection and retries at the next interval',async()=>{
  const x=setup({market:async()=>{throw Error('offline');}});await x.api.autoRefreshQuotes();assert.equal(x.s.refreshing,false);assert.equal(x.s.lastRefresh,123);assert.equal(x.s.quoteRefreshError,'offline');
  x.advance(60000);await x.api.autoRefreshQuotes();assert.equal(x.calls.length,2);
});
test('quotes do not apply to a new session, a revoked friend or a changed ticker',async()=>{
  let finish;const x=setup({market:(...args)=>new Promise(resolve=>{finish=()=>resolve(x.fresh(...args));})});
  x.s.page='sharing';x.s.friend='a';const pending=x.api.autoRefreshQuotes();await Promise.resolve();
  x.s.friends=[];x.s.assets[0].symbol='ETH';finish();await pending;assert.equal(x.s.friends.length,0);assert.equal(x.s.assets[0].quote.nativePrice,100);
  const y=setup({market:(...args)=>new Promise(resolve=>{finish=()=>resolve(y.fresh(...args));})});const old=y.api.autoRefreshQuotes();await Promise.resolve();y.s.session++;finish();await old;assert.equal(y.s.assets[0].quote.nativePrice,100);
});
test('hidden app, open forms and strategy screens do not trigger quote requests',async()=>{
  const x=setup();x.context.document.visibilityState='hidden';await x.api.autoRefreshQuotes();assert.equal(x.calls.length,0);
  x.context.document.visibilityState='visible';x.context.document.querySelector=()=>({open:true});await x.api.autoRefreshQuotes();assert.equal(x.calls.length,0);
  x.context.document.querySelector=()=>null;x.s.page='sharing';x.s.sharingTab='long';await x.api.autoRefreshQuotes();assert.equal(x.calls.length,0);
});

