import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeAsset,sharedAsset,parseStrategyCompletion} from '../core.js';
const source=fs.readFileSync(new URL('../store.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'').replace('let sdk,db,auth,firebaseApp;','let sdk=__sdk,db={},auth={},firebaseApp={};');
function harness(seed={}){
  const docs=new Map(Object.entries(structuredClone(seed))),deleted=Symbol('delete'),listeners=[];
  const snap=ref=>({id:ref.split('/').at(-1),exists:()=>docs.has(ref),data:()=>structuredClone(docs.get(ref))});
  const merge=(a,b)=>{const out={...a};for(const [k,v] of Object.entries(b)){if(v===deleted)delete out[k];else out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k]||{},v):structuredClone(v);}return out;};
  const sdk={doc:(_,...parts)=>parts.join('/'),collection:(_,...parts)=>parts.join('/'),deleteField:()=>deleted,setDoc:async(ref,data)=>{docs.set(ref,structuredClone(data));for(const listener of listeners)if(ref.startsWith(listener.ref+'/'))listener.emit();},onSnapshot:(ref,next)=>{const listener={ref,emit:()=>next({docs:[...docs.entries()].filter(([key])=>key.startsWith(ref+'/')).map(([key,value])=>({id:key.split('/').at(-1),data:()=>structuredClone(value)}))})};listeners.push(listener);listener.emit();return ()=>{const index=listeners.indexOf(listener);if(index>=0)listeners.splice(index,1);};},getDoc:async ref=>snap(ref),getDocFromServer:async ref=>snap(ref),getDocs:async ref=>({docs:[...docs.keys()].filter(k=>k.startsWith(ref+'/')&&k.slice(ref.length+1).split('/').length===1).map(snap)}),
    runTransaction:async(_,fn)=>{const writes=[];let writing=false;const tx={get:async ref=>{assert.equal(writing,false,'transaction reads must precede writes');return snap(ref);},set:(ref,data,options)=>{writing=true;writes.push(()=>docs.set(ref,options?.merge?merge(docs.get(ref),data):structuredClone(data)));},update:(ref,patch)=>{writing=true;writes.push(()=>{const next={...docs.get(ref)};for(const [field,value] of Object.entries(patch)){const parts=field.split('.');let target=next;for(const part of parts.slice(0,-1)){target[part]={...target[part]};target=target[part];}if(value===deleted)delete target[parts.at(-1)];else target[parts.at(-1)]=structuredClone(value);}docs.set(ref,next);});},delete:ref=>{writing=true;writes.push(()=>docs.delete(ref));}};const result=await fn(tx);for(const write of writes)write();for(const listener of [...listeners])listener.emit();return result;}};
  const context={__sdk:sdk,normalizeAsset,sharedAsset,parseStrategyCompletion,crypto:webcrypto,structuredClone,console,DEFAULT_SETTINGS:{goal:10000000,targetDate:'2030-05-17',monthly:0,finnhubKey:''},ADMIN_EMAIL:'admin@example.com'};
  const api=vm.runInNewContext(source+'\n({saveAsset,saveQuotes,deleteAsset,publish,loadUser,snapshot,listenStrategyParticipation,saveStrategyParticipation,saveStrategy});',context);
  return {api,docs,sdk,emitAll:()=>listeners.forEach(listener=>listener.emit())};
}
const asset={id:'a',name:'Stock',mode:'stock',symbol:'TEST',qty:10,costPer:100,updatedAt:'one',quote:{nativePrice:110,fx:32,lastAttemptAt:'2026-10-06T10:00:00Z'}};
test('editing holdings preserves a newer quote read inside the transaction',async()=>{const {api,docs}=harness({'users/u/assets/a':asset});const saved=await api.saveAsset('u',{...asset,qty:20,updatedAt:'two',quote:{nativePrice:1}},'one');assert.equal(saved.quote.nativePrice,110);assert.equal(docs.get('users/u/assets/a').qty,20);});
test('stale forms cannot overwrite newer edits or resurrect a deleted asset',async()=>{const {api,docs}=harness({'users/u/assets/a':asset});await assert.rejects(api.saveAsset('u',{...asset,qty:20},'older'),/其他裝置更新/);assert.equal(docs.get('users/u/assets/a').qty,10);docs.delete('users/u/assets/a');await assert.rejects(api.saveAsset('u',asset,'one'),/其他裝置刪除/);assert.equal(docs.has('users/u/assets/a'),false);});
test('quote refresh never overwrites quantities, costs, symbols or newer quotes',async()=>{const changed={...asset,symbol:'NEW',qty:99,costPer:75};const {api,docs}=harness({'users/u/assets/a':changed});const update={id:'a',mode:'stock',symbol:'TEST',quote:{nativePrice:200,fx:31,lastAttemptAt:'2026-10-06T11:00:00Z'}};assert.equal((await api.saveQuotes('u',[update])).length,0);assert.equal(docs.get('users/u/assets/a').qty,99);update.symbol='NEW';update.quote.lastAttemptAt='2026-10-06T09:00:00Z';assert.equal((await api.saveQuotes('u',[update])).length,0);update.quote.lastAttemptAt='2026-10-06T11:00:00Z';assert.equal((await api.saveQuotes('u',[update])).length,1);assert.equal(docs.get('users/u/assets/a').costPer,75);assert.equal(docs.get('users/u/assets/a').qty,99);});
test('publishing selects only chosen assets and keeps strategy audience separate',async()=>{const {api,docs}=harness({'users/u/assets/a':{...asset,finnhubKey:'SECRET',quote:{...asset.quote,apiKey:'SECRET'}},'users/u/assets/b':{...asset,id:'b',name:'Private'}});await api.publish('u','Owner',['a'],['viewer-portfolio'],['viewer-strategy']);const p=docs.get('sharedPortfolios/u');assert.equal(p.assets.length,1);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.equal(p.viewerUids[0],'viewer-portfolio');assert.equal(docs.get('strategyAccess/u').viewerUids[0],'viewer-strategy');});
test('deleting a holding removes it from the published projection atomically',async()=>{const {api,docs}=harness({'users/u/assets/a':asset,'sharedPortfolios/u':{assets:[sharedAsset(asset)],viewerUids:['v']}});await api.deleteAsset('u','a');assert.equal(docs.has('users/u/assets/a'),false);assert.equal(docs.get('sharedPortfolios/u').assets.length,0);});
test('legacy migration backs up source, uses stable generated IDs and does not run twice',async()=>{const legacy={assets:[{name:'Cash',mode:'manual',value:100},{...asset,id:'legacy',value:35200}],history:[{date:'2026-10-06',total:35300}],settings:{goal:12345},quotes:{fx:32}};const {api,docs}=harness({'users/u':legacy});const loaded=await api.loadUser({uid:'u',displayName:'Owner'});assert.equal(loaded.assets.length,2);const cash=[...docs.entries()].find(([key,a])=>key.startsWith('users/u/assets/')&&a.name==='Cash');assert.equal(cash[0].split('/').at(-1),cash[1].id);assert.equal(docs.get('users/u/backups/v1').assets.length,2);assert.equal(docs.get('users/u').schemaVersion,2);assert.equal(docs.get('users/u').assets,undefined);assert.equal(loaded.settings.goal,12345);docs.get('users/u/assets/legacy').qty=42;await api.loadUser({uid:'u',displayName:'Owner'});assert.equal(docs.get('users/u/assets/legacy').qty,42);});
test('automatic daily snapshot preserves an existing same-day record',async()=>{const {api,docs}=harness({'users/u/history/2026-10-06':{date:'2026-10-06',total:100}});await api.snapshot('u','2026-10-06',200,false);assert.equal(docs.get('users/u/history/2026-10-06').total,100);await api.snapshot('u','2026-10-06',200,true);assert.equal(docs.get('users/u/history/2026-10-06').total,200);});

test('new account loads empty personal records and defaults without copying another user',async()=>{const {api,docs}=harness({'users/owner':{schemaVersion:2,settings:{goal:123456,targetDate:'2040-01-01',finnhubKey:'OWNER_KEY'}},'users/owner/assets/a':asset,'users/owner/history/2026-10-06':{date:'2026-10-06',total:35200}});const before=structuredClone(docs.get('users/owner'));const loaded=await api.loadUser({uid:'new',displayName:'New'});assert.equal(loaded.assets.length,0);assert.equal(loaded.history.length,0);assert.equal(loaded.settings.goal,10000000);assert.equal(loaded.settings.finnhubKey,'');assert.equal(loaded.published.assets.length,0);assert.equal(loaded.published.viewerUids.length,0);assert.equal(loaded.strategyAccess.viewerUids.length,0);assert.deepEqual(docs.get('users/owner'),before);});

test('strategy participation saves caller choice and updates its live listener',async()=>{const {api,docs}=harness({'strategies/owner/posts/post':{id:'post',published:true,updatedAt:'revision-1'}});const user={uid:'viewer',displayName:'小明',photoURL:'https://lh3.googleusercontent.com/a'};let rows=[];const unsubscribe=api.listenStrategyParticipation('owner','post',value=>{rows=value;});await api.saveStrategyParticipation(user,'owner','post','participating','revision-1');assert.equal(docs.get('strategyParticipation/owner/posts/post/members/viewer').choice,'participating');assert.equal(rows.length,1);assert.equal(rows[0].uid,'viewer');assert.equal(rows[0].strategyUpdatedAt,'revision-1');await api.saveStrategyParticipation(user,'owner','post','not-participating','revision-1');assert.equal(rows.length,1);assert.equal(rows[0].choice,'not-participating');unsubscribe();await assert.rejects(api.saveStrategyParticipation(user,'owner','post','approve','revision-1'),/參與狀態無效/);});

test('historical loss edits replace the existing record and keep its shared projection in sync',async()=>{
  const old={id:'old-loss',name:'過往虧損',mode:'manual',value:0,cost:500000,symbol:null,updatedAt:'one'};
  const {api,docs}=harness({'users/u/assets/old-loss':old,'sharedPortfolios/u':{assets:[sharedAsset(old)],viewerUids:['v']}});
  const saved=await api.saveAsset('u',{...old,cost:null,recordKind:'realized',realizedPnl:-500000,updatedAt:'two'},'one');
  assert.equal(saved.value,0);assert.equal(saved.realizedPnl,-500000);assert.equal(docs.get('users/u/assets/old-loss').cost,null);
  const shared=docs.get('sharedPortfolios/u').assets;assert.equal(shared.length,1);assert.equal(shared[0].recordKind,'realized');assert.equal(shared[0].realizedPnl,-500000);
});

test('participation uses the current strategy revision even when the displayed version is stale',async()=>{
  const post={id:'post',published:true,updatedAt:'revision-2',title:'New content'};
  const other={choice:'not-participating',strategyUpdatedAt:'revision-1',displayName:'Other'};
  const {api,docs}=harness({'strategies/owner/posts/post':post,'strategyParticipation/owner/posts/post/members/other':other});
  const result=await api.saveStrategyParticipation({uid:'viewer',displayName:'Viewer'},'owner','post','participating','revision-1');
  assert.equal(result.entry.strategyUpdatedAt,'revision-2');assert.equal(result.post.title,'New content');
  assert.equal(docs.get('strategyParticipation/owner/posts/post/members/viewer').strategyUpdatedAt,'revision-2');
  assert.deepEqual(docs.get('strategyParticipation/owner/posts/post/members/other'),other);
});

test('deleted and unpublished strategies reject participation without writing a response',async()=>{
  const user={uid:'owner'};const {api,docs}=harness({'strategies/owner/posts/draft':{published:false,updatedAt:'r1'}});
  await assert.rejects(api.saveStrategyParticipation(user,'owner','missing','participating','r1'),/已刪除/);
  await assert.rejects(api.saveStrategyParticipation(user,'owner','draft','participating','r1'),/停止分享/);
  assert.ok(![...docs.keys()].some(key=>key.startsWith('strategyParticipation/')));
});

test('permission failures retain their error code and identify strategy participation rather than claiming missing rules',async()=>{
  const {api,sdk}=harness();const rejected=Object.assign(new Error('denied'),{code:'permission-denied'});
  sdk.runTransaction=async()=>{throw rejected;};
  await assert.rejects(api.saveStrategyParticipation({uid:'viewer'},'owner','post','participating','r1'),error=>{
    assert.equal(error.code,'permission-denied');assert.equal(error.operation,'strategy-participation-read');
    assert.match(error.userMessage,/策略授權/);assert.ok(!error.userMessage.includes('發布'));return true;
  });
});

test('a denied write retries once only when the server confirms that the strategy version changed',async()=>{
  const path='strategies/owner/posts/post',seed={[path]:{id:'post',published:true,updatedAt:'r1'}};
  const {api,sdk,docs}=harness(seed),run=sdk.runTransaction;let attempts=0;
  sdk.runTransaction=async(database,callback)=>{
    attempts++;const result=await run(database,callback);
    if(attempts===1){docs.delete('strategyParticipation/owner/posts/post/members/viewer');docs.get(path).updatedAt='r2';throw Object.assign(new Error('revision changed'),{code:'permission-denied'});}
    return result;
  };
  const saved=await api.saveStrategyParticipation({uid:'viewer'},'owner','post','participating','r1');
  assert.equal(attempts,2);assert.equal(saved.entry.strategyUpdatedAt,'r2');
});

test('a denied write with an unchanged revision is not retried or reported as success',async()=>{
  const {api,sdk}=harness({'strategies/owner/posts/post':{id:'post',published:true,updatedAt:'r1'}});let attempts=0;
  sdk.runTransaction=async(_database,callback)=>{attempts++;await callback({get:sdk.getDoc,set(){}});throw Object.assign(new Error('denied'),{code:'permission-denied'});};
  await assert.rejects(api.saveStrategyParticipation({uid:'viewer'},'owner','post','participating','r1'),error=>error.code==='permission-denied'&&error.operation==='strategy-participation-write');
  assert.equal(attempts,1);
});






test('completing a selected strategy keeps participation, read records and holdings intact',async()=>{
  const path='selectedStrategies/owner/posts/p',post={id:'p',ownerUid:'owner',title:'Plan',symbol:'BTC',thesis:'Reason',term:'short',status:'active',published:true,audienceUids:['viewer'],viewerUids:['viewer'],holdingPeriod:'一週',updatedAt:'v1'};
  const member='strategyParticipation/owner/posts/p/members/viewer',read='strategyReads/owner/posts/p/members/viewer',assetPath='users/owner/assets/a';
  const {api,docs}=harness({[path]:post,'strategyAccess/owner':{viewerUids:['viewer']},[member]:{choice:'participating'},[read]:{strategyUpdatedAt:'v1'},[assetPath]:asset});
  const done=await api.saveStrategy('owner',{...post,status:'closed',updatedAt:'v2',completion:{outcome:'loss',amount:50,currency:'USD',closedOn:'2026-10-20',note:'Stop'}},'v1');
  assert.equal(done.completion.amount,50);assert.equal(docs.get(member).choice,'participating');assert.equal(docs.get(read).strategyUpdatedAt,'v1');assert.deepEqual(docs.get(assetPath),asset);
  const edit={...done,title:'Corrected',updatedAt:'v3'};delete edit.completion;delete edit.holdingPeriod;
  const saved=await api.saveStrategy('owner',edit,'v2');assert.equal(saved.completion.outcome,'loss');assert.equal(saved.holdingPeriod,'一週');
  await assert.rejects(api.saveStrategy('owner',{...saved,status:'active'},'v3'),/已完成結單/);
  await assert.rejects(api.saveStrategy('owner',{...done,completion:{...done.completion,amount:999}},'v1'),/其他裝置更新/);
  assert.equal(docs.get(path).completion.amount,50);
});
