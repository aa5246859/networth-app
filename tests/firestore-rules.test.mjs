import {before,after,beforeEach,test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as firestoreSdk from 'firebase/firestore';
import {doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,collection,query,where,writeBatch} from 'firebase/firestore';
let env;
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const users={owner:'owner@example.com',viewer:'viewer@example.com',stranger:'stranger@example.com',pending:'pending@example.com',admin:'aaz52468599@gmail.com'};
const db=(uid,verified=true)=>env.authenticatedContext(uid,{email:users[uid]||uid+'@example.com',email_verified:verified}).firestore();
const write=(store,path,value)=>setDoc(doc(store,path),value);
const read=(store,path)=>getDoc(doc(store,path));
function participationStore(database,sdk=firestoreSdk){
  const source=readFileSync(new URL('../store.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'').replace('let sdk,db,auth,firebaseApp;','let sdk=__sdk,db=__db,auth={},firebaseApp={};');
  return new Function('__sdk','__db',source+'\nreturn {saveStrategyParticipation};')(sdk,database);
}
function interceptStrategyRead(action){
  let reads=0;
  return {sdk:{...firestoreSdk,runTransaction:(database,callback)=>firestoreSdk.runTransaction(database,tx=>callback(new Proxy(tx,{get(target,key){
    if(key==='get')return async reference=>{const snapshot=await target.get(reference);if(reference.path==='strategies/owner/posts/pub'&&++reads===1)await action();return snapshot;};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }})))},reads:()=>reads};
}
const post=id=>({id,ownerUid:'owner',ownerName:'Owner',title:'Strategy',symbol:'BTC',term:'long',thesis:'Reason',entry:'Entry',invalidation:'Exit',target:'Goal',status:'watching',published:id==='pub',createdAt:'2026-10-06',updatedAt:'2026-10-06'});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-wealth-tracker',firestore:{host:'127.0.0.1',port:8085,rules}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const f=c.firestore();for(const uid of ['owner','viewer','stranger'])await write(f,'access/'+uid,{status:'approved',email:users[uid]});await write(f,'access/pending',{status:'pending',email:users.pending});await write(f,'users/owner',{schemaVersion:2,settings:{goal:1000000,finnhubKey:'private'}});await write(f,'users/owner/assets/a',{id:'a',name:'Asset',mode:'stock',qty:2});await write(f,'users/owner/history/2026-10-06',{date:'2026-10-06',total:100});await write(f,'users/owner/backups/v1',{original:'private'});await write(f,'sharedPortfolios/owner',{ownerName:'Owner',viewerUids:['viewer'],assets:[{id:'a',name:'Asset'}],updatedAt:'now'});await write(f,'strategyAccess/owner',{ownerName:'Owner',viewerUids:['viewer','admin'],updatedAt:'now'});for(const id of ['pub','draft'])await write(f,'strategies/owner/posts/'+id,post(id));});});
test('first login can request pending access but cannot self-approve',async()=>{const f=db('new');await assertSucceeds(write(f,'access/new',{email:'new@example.com',name:'New',status:'pending',requestedAt:'now'}));await assertFails(updateDoc(doc(f,'access/new'),{status:'approved'}));await assertFails(write(db('other'),'access/other',{email:'other@example.com',status:'approved'}));});
test('admin can list, approve and reject applicants; ordinary users cannot',async()=>{const admin=db('admin');await assertSucceeds(getDocs(collection(admin,'access')));await assertSucceeds(updateDoc(doc(admin,'access/pending'),{status:'approved'}));await assertSucceeds(updateDoc(doc(admin,'access/pending'),{status:'denied'}));await assertFails(getDocs(collection(db('viewer'),'access')));await assertFails(updateDoc(doc(db('viewer'),'access/pending'),{status:'approved'}));});
test('pending, rejected, unverified and signed-out users cannot read app data',async()=>{await assertFails(read(db('pending'),'users/pending'));await env.withSecurityRulesDisabled(c=>write(c.firestore(),'access/pending',{status:'denied'}));await assertFails(read(db('pending'),'users/pending'));await assertFails(read(db('owner',false),'users/owner'));await assertFails(read(env.unauthenticatedContext().firestore(),'sharedPortfolios/owner'));});
test('private profile, holdings, history and backup are readable only by owner',async()=>{for(const path of ['users/owner','users/owner/assets/a','users/owner/history/2026-10-06','users/owner/backups/v1']){await assertSucceeds(read(db('owner'),path));await assertFails(read(db('viewer'),path));await assertFails(read(db('admin'),path));}});
test('portfolio viewers can read shared holdings but cannot change them',async()=>{await assertSucceeds(read(db('viewer'),'sharedPortfolios/owner'));await assertSucceeds(getDocs(query(collection(db('viewer'),'sharedPortfolios'),where('viewerUids','array-contains','viewer'))));await assertFails(read(db('stranger'),'sharedPortfolios/owner'));await assertFails(updateDoc(doc(db('viewer'),'sharedPortfolios/owner'),{assets:[]}));});
test('strategy viewers see only published posts and cannot write owner posts',async()=>{await assertSucceeds(read(db('viewer'),'strategies/owner/posts/pub'));await assertFails(read(db('viewer'),'strategies/owner/posts/draft'));await assertSucceeds(getDocs(query(collection(db('viewer'),'strategies/owner/posts'),where('published','==',true))));await assertFails(getDocs(collection(db('viewer'),'strategies/owner/posts')));await assertFails(updateDoc(doc(db('viewer'),'strategies/owner/posts/pub'),{title:'Changed'}));});
test('portfolio and strategy permissions are independent and revocation takes effect',async()=>{await updateDoc(doc(db('owner'),'strategyAccess/owner'),{viewerUids:[]});await assertSucceeds(read(db('viewer'),'sharedPortfolios/owner'));await assertFails(read(db('viewer'),'strategies/owner/posts/pub'));await updateDoc(doc(db('owner'),'strategyAccess/owner'),{viewerUids:['viewer']});await updateDoc(doc(db('owner'),'sharedPortfolios/owner'),{viewerUids:[]});await assertSucceeds(read(db('viewer'),'strategies/owner/posts/pub'));await assertFails(read(db('viewer'),'sharedPortfolios/owner'));});
test('backup is create-once and migrated profiles reject legacy overwrites',async()=>{const f=db('owner');await assertFails(updateDoc(doc(f,'users/owner/backups/v1'),{original:'changed'}));await assertFails(deleteDoc(doc(f,'users/owner/backups/v1')));await assertSucceeds(write(f,'users/owner/backups/v2',{original:'new'}));await assertFails(write(f,'users/owner',{assets:[],history:[]}));await assertSucceeds(updateDoc(doc(f,'users/owner'),{settings:{goal:2000000}}));});
test('valid holdings and daily records accepted; invalid data and cross-owner writes denied',async()=>{const f=db('owner');await assertSucceeds(write(f,'users/owner/assets/b',{id:'b',name:'BTC',mode:'crypto',qty:.1}));await assertFails(write(f,'users/owner/assets/c',{id:'c',name:'Bad',mode:'stock',qty:-1}));await assertFails(write(db('viewer'),'users/owner/assets/v',{id:'v',name:'Bad',mode:'stock',qty:1}));await assertSucceeds(write(f,'users/owner/history/2026-10-07',{date:'2026-10-07',total:200}));await assertFails(write(f,'users/owner/history/2026-10-08',{date:'2026-10-08',total:-1}));});
test('only invited recipient can accept without changing inviter identity',async()=>{const f=db('owner');await assertSucceeds(write(f,'shareInvites/i',{ownerUid:'owner',ownerName:'Owner',recipientEmail:users.viewer,status:'pending',createdAt:'now'}));await assertFails(updateDoc(doc(db('stranger'),'shareInvites/i'),{status:'accepted',viewerUid:'stranger',acceptedAt:'now'}));await assertFails(updateDoc(doc(db('viewer'),'shareInvites/i'),{status:'accepted',viewerUid:'viewer',ownerUid:'viewer',acceptedAt:'now'}));await assertSucceeds(updateDoc(doc(db('viewer'),'shareInvites/i'),{status:'accepted',viewerUid:'viewer',acceptedAt:'now'}));await assertFails(deleteDoc(doc(db('viewer'),'shareInvites/i')));});

const participationPath='strategyParticipation/owner/posts/pub/members/';
test('strategy participants can write only their own valid current response',async()=>{const viewer=db('viewer'),entry={choice:'participating',strategyUpdatedAt:'2026-10-06',displayName:'Viewer',photoURL:'https://lh3.googleusercontent.com/a',updatedAt:'now'};await assertSucceeds(write(viewer,participationPath+'viewer',entry));await assertSucceeds(read(db('owner'),participationPath+'viewer'));await assertFails(read(db('stranger'),participationPath+'viewer'));await assertFails(write(viewer,participationPath+'owner',entry));await assertFails(write(db('stranger'),participationPath+'stranger',entry));await assertFails(write(viewer,'strategyParticipation/owner/posts/draft/members/viewer',entry));await assertFails(read(viewer,'strategyParticipation/owner/posts/draft/members/viewer'));await assertSucceeds(read(db('owner'),'strategyParticipation/owner/posts/draft/members/viewer'));await assertFails(updateDoc(doc(viewer,participationPath+'viewer'),{choice:'approved'}));await assertSucceeds(updateDoc(doc(viewer,participationPath+'viewer'),{choice:'not-participating',updatedAt:'later'}));await updateDoc(doc(db('owner'),'strategies/owner/posts/pub'),{updatedAt:'revision-2'});await assertFails(updateDoc(doc(viewer,participationPath+'viewer'),{choice:'participating',updatedAt:'later'}));});

test('reproduces the old permission error after an edit; the actual store saves the latest revision without changing rules',async()=>{
  const viewer=db('viewer');
  await updateDoc(doc(db('owner'),'strategies/owner/posts/pub'),{updatedAt:'revision-2',title:'Changed'});
  await assertFails(write(viewer,participationPath+'viewer',{choice:'participating',strategyUpdatedAt:'2026-10-06',displayName:'Viewer',photoURL:'',updatedAt:'now'}));
  const saved=await participationStore(viewer).saveStrategyParticipation({uid:'viewer',displayName:'Viewer'},'owner','pub','participating','2026-10-06');
  if(saved.entry.strategyUpdatedAt!=='revision-2')throw new Error('The transaction used an old strategy version');
  const entry=await read(db('owner'),participationPath+'viewer');
  if(entry.data().strategyUpdatedAt!=='revision-2')throw new Error('Saved revision is stale');
});

test('an edit concurrent with participation retries using the new strategy revision',async()=>{
  const intercept=interceptStrategyRead(()=>updateDoc(doc(db('owner'),'strategies/owner/posts/pub'),{updatedAt:'revision-concurrent'}));
  const saved=await participationStore(db('viewer'),intercept.sdk).saveStrategyParticipation({uid:'viewer'},'owner','pub','participating','2026-10-06');
  if(saved.entry.strategyUpdatedAt!=='revision-concurrent'||intercept.reads()<2)throw new Error('Concurrent edit was not retried');
});

test('participation after an edit preserves other participants and remains visible to the same authorized audience',async()=>{
  await participationStore(db('owner')).saveStrategyParticipation({uid:'owner',displayName:'Owner'},'owner','pub','not-participating','2026-10-06');
  await updateDoc(doc(db('owner'),'strategies/owner/posts/pub'),{updatedAt:'revision-2'});
  await participationStore(db('viewer')).saveStrategyParticipation({uid:'viewer',displayName:'Viewer'},'owner','pub','participating','2026-10-06');
  const members=await assertSucceeds(getDocs(collection(db('viewer'),'strategyParticipation/owner/posts/pub/members')));
  if(members.size!==2)throw new Error('Existing participant was lost');
  await assertFails(getDocs(collection(db('stranger'),'strategyParticipation/owner/posts/pub/members')));
});

test('revocation while a participation transaction is in flight still blocks the write',async()=>{
  const intercept=interceptStrategyRead(()=>updateDoc(doc(db('owner'),'strategyAccess/owner'),{viewerUids:[]}));
  await assertFails(participationStore(db('viewer'),intercept.sdk).saveStrategyParticipation({uid:'viewer'},'owner','pub','participating','2026-10-06'));
  const response=await read(db('owner'),participationPath+'viewer');if(response.exists())throw new Error('Revoked viewer wrote a response');
});

test('deleted, unpublished and unauthorized strategies reject the actual participation function',async()=>{
  const owner=participationStore(db('owner'));
  await assert.rejects(owner.saveStrategyParticipation({uid:'owner'},'owner','missing','participating','old'),/已刪除/);
  await assert.rejects(owner.saveStrategyParticipation({uid:'owner'},'owner','draft','participating','old'),/停止分享/);
  await assertFails(participationStore(db('stranger')).saveStrategyParticipation({uid:'stranger'},'owner','pub','participating','old'));
  const members=await getDocs(collection(db('owner'),'strategyParticipation/owner/posts/pub/members'));
  if(members.size)throw new Error('Invalid participation created data');
});



