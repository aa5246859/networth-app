import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrategyCompletion,strategyCompletion,applyStrategyCompletion} from '../core.js';
import {buildBackup,parseBackup} from '../backup.js';

const today='2026-10-22';
const fields={outcome:'profit',amount:'1250.50',currency:'USD',closedOn:today,note:'  依計劃出場\n保留心得  '};
const post={id:'p',ownerUid:'owner',ownerName:'Owner',title:'Plan',symbol:'BTC',term:'short',thesis:'Reason',entry:'Entry',invalidation:'Exit',target:'70000',holdingPeriod:'一週',status:'active',published:true,audienceUids:['one'],viewerUids:['one'],createdAt:'2026-10-20T08:00:00Z',updatedAt:'2026-10-21T08:00:00Z'};

test('completion distinguishes a known result with unknown amount from an actual zero',()=>{
  assert.equal(parseStrategyCompletion({...fields,amount:''},today).amount,null);
  assert.equal(parseStrategyCompletion({...fields,outcome:'loss',amount:''},today).amount,null);
  assert.equal(parseStrategyCompletion({...fields,outcome:'flat',amount:''},today).amount,0);
  assert.equal(parseStrategyCompletion(fields,today).amount,1250.5);
  for(const outcome of ['profit','loss'])assert.throws(()=>parseStrategyCompletion({...fields,outcome,amount:'0'},today));
  assert.throws(()=>parseStrategyCompletion({...fields,outcome:'flat',amount:'1'},today));
});

test('completion rejects incorrect signs, unsafe amounts, malformed dates and unsupported values',()=>{
  for(const amount of ['-50','NaN','Infinity','1e100',true,{},[]])assert.throws(()=>parseStrategyCompletion({...fields,amount},today));
  for(const closedOn of ['2026-02-30','2026-13-01','2026-10-23','bad'])assert.throws(()=>parseStrategyCompletion({...fields,closedOn},today));
  assert.throws(()=>parseStrategyCompletion({...fields,currency:'EUR'},today));
  assert.throws(()=>parseStrategyCompletion({...fields,outcome:'approved'},today));
  assert.throws(()=>parseStrategyCompletion({...fields,note:'a'.repeat(1001)},today));
});

test('completing and correcting a strategy retain its identity, original plan and selected audience',()=>{
  const original=structuredClone(post),done=applyStrategyCompletion(post,fields,'2026-10-22T08:00:00Z');
  assert.deepEqual(post,original);assert.equal(done.status,'closed');
  for(const key of ['id','createdAt','target','holdingPeriod','audienceUids','viewerUids','thesis','entry'])assert.deepEqual(done[key],post[key]);
  assert.equal(done.completion.note,'依計劃出場\n保留心得');
  const correction=applyStrategyCompletion(done,{...fields,outcome:'loss',amount:'50'},'2026-10-22T09:00:00Z');
  assert.equal(strategyCompletion(correction).outcome,'loss');assert.equal(strategyCompletion(correction).amount,50);
  assert.equal(correction.id,done.id);assert.equal(done.completion.outcome,'profit');
});

test('legacy closed strategies stay closed without inventing a financial result',()=>{
  assert.equal(strategyCompletion({...post,status:'closed'}),null);
  assert.equal(strategyCompletion({...post,status:'closed',completion:{...fields,amount:-10}}),null);
  assert.equal(strategyCompletion({...post,completion:fields}),null);
});

test('backup restores split fields and completed results privately without sharing grants',()=>{
  const done=applyStrategyCompletion(post,fields,'2026-10-22T08:00:00Z');
  const state={settings:{goal:1000,targetDate:'2030-01-01',monthly:0,finnhubKey:'SECRET'},assets:[],history:[],ownPosts:[done]};
  const backup=buildBackup(state);assert.equal(backup.version,3);assert.ok(!JSON.stringify(backup).includes('audienceUids'));assert.ok(!JSON.stringify(backup).includes('SECRET'));
  const restored=parseBackup(backup).strategies[0];assert.notEqual(restored.id,post.id);assert.equal(restored.published,false);assert.equal(restored.holdingPeriod,'一週');assert.equal(restored.target,'70000');assert.deepEqual(restored.completion,done.completion);
  for(const version of [1,2]){const legacy=parseBackup({version,assets:[],history:[],strategies:[{...post,holdingPeriod:undefined}]}).strategies[0];assert.equal(legacy.target,post.target);}
  assert.throws(()=>parseBackup({...backup,strategies:[{...done,status:'active'}]}));
});
