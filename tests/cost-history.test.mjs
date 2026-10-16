import test from 'node:test';
import assert from 'node:assert/strict';
import {costAmount,isRealized,parseAsset,valuation,portfolio,aggregateHoldings,sharedAsset,requiredRates} from '../core.js';
import {buildBackup,parseBackup} from '../backup.js';

const quote={nativePrice:0.25,fx:32,fetchedAt:'2026-10-16T13:35:00Z',error:''};
const reward={id:'reward',mode:'crypto',name:'ADA 質押獎勵',symbol:'ADA',qty:100,costPer:0,costFx:null,quote};
const realized=(amount=-500000)=>parseAsset({mode:'manual',manualKind:'realized',name:'App 建立前的損益',realizedPnl:String(amount)});

test('100 originally invested, 20 previously lost and remaining holdings worth 60 shows 100 principal and -40 total return',()=>{
  const p=portfolio([{id:'current',mode:'manual',value:60,cost:80},realized(-20)]);
  assert.equal(p.total,60);assert.equal(p.invested,100);assert.equal(p.overallPnl,-40);assert.equal(p.overallPercent,-40);
  assert.equal(p.total-p.invested,p.overallPnl);
});

test('reinvested realized gains and added cash are counted once in net invested principal',()=>{
  const positions=[{id:'current',mode:'manual',value:140,cost:120},realized(20)];
  const p=portfolio(positions);assert.equal(p.invested,100);assert.equal(p.overallPnl,40);assert.equal(p.overallPercent,40);
  const withDeposit=portfolio([...positions,{id:'new-cash',mode:'manual',value:30,cost:30}]);
  assert.equal(withDeposit.invested,130);assert.equal(withDeposit.total,170);assert.equal(withDeposit.overallPnl,40);
  assert.equal(portfolio([{mode:'manual',value:60,cost:60},realized(20)]).invested,40);
});

test('missing costs never produce a complete overall percentage and zero invested principal does not divide by zero',()=>{
  const missing=portfolio([{mode:'manual',value:60,cost:null},realized(-20)]);
  assert.equal(missing.costComplete,false);assert.equal(missing.pnlComplete,false);assert.equal(missing.overallPercent,null);
  const free=portfolio([reward]);assert.equal(free.invested,0);assert.equal(free.overallPnl,800);assert.equal(free.overallPercent,null);
});

test('zero cost is known while blank, null, missing and invalid costs remain unknown',()=>{
  for(const raw of [0,'0','0.000'])assert.equal(costAmount(raw),0);
  for(const raw of [null,undefined,'','   ',-1,'bad'])assert.equal(costAmount(raw),null);
  const value=valuation(reward);assert.equal(value.cost,0);assert.equal(value.pnl,800);assert.equal(value.percent,null);
  for(const costPer of [null,undefined,''])assert.equal(valuation({...reward,costPer}).pnl,null);
  const parsed=parseAsset({mode:'crypto',name:'獎勵',symbol:'ADA',qty:'100',costPer:'0',costFx:''});
  assert.equal(parsed.costPer,0);assert.equal(valuation({...parsed,quote}).pnl,800);
});

test('zero cost works for manual, Taiwan and USD records without overriding it with legacy cost',()=>{
  assert.equal(valuation({mode:'manual',value:500,cost:0}).pnl,500);
  assert.equal(valuation({mode:'tw',qty:10,costPer:0,quote:{nativePrice:20}}).pnl,200);
  assert.equal(valuation({mode:'usd',qty:100,costPer:0,quote:{fx:32}}).pnl,3200);
  assert.equal(valuation({...reward,cost:99999}).cost,0);
});

test('consolidation includes reward quantities in weighted average and leaves unknown cost out',()=>{
  const paid={...reward,id:'paid',qty:100,costPer:0.5};
  const unknown={...reward,id:'unknown',qty:100,costPer:null};
  const [group]=aggregateHoldings([reward,paid,unknown]);
  assert.equal(group.qty,300);assert.equal(group.averageCost,0.25);assert.equal(group.coverage,2);
  assert.equal(group.value,2400);assert.equal(group.cost,1600);assert.equal(group.pnl,0);
  const [free]=aggregateHoldings([reward,{...reward,id:'free-2'}]);
  assert.equal(free.averageCost,0);assert.equal(free.pnl,1600);assert.equal(free.percent,null);
});

test('overview cost includes known cost even before quotes arrive without inflating return denominator',()=>{
  const pending={id:'pending',mode:'stock',qty:10,costPer:100,costFx:32,quote:{nativePrice:null,fx:null}};
  const paid={...reward,id:'paid',costPer:0.1};
  const p=portfolio([pending,paid]);
  assert.equal(p.cost,32320);assert.equal(p.costCount,2);assert.equal(p.covered,1);
  assert.equal(p.pnlCost,320);assert.equal(p.pnl,480);assert.equal(p.percent,150);
  assert.equal(p.estimatedCost,1);
});

test('historical loss never reduces current assets, changes current cost or appears as floating P&L',()=>{
  const current={id:'cash',mode:'manual',value:2500000,cost:2500000};
  const loss=realized();const p=portfolio([current,loss]);
  assert.equal(isRealized(loss),true);assert.equal(loss.value,0);assert.equal(loss.cost,null);
  assert.equal(p.total,2500000);assert.equal(p.cost,2500000);assert.equal(p.count,1);
  assert.equal(p.pnl,0);assert.equal(p.realizedPnl,-500000);assert.equal(p.cumulativePnl,-500000);
  assert.equal(valuation(loss).pnl,null);assert.equal(p.realizedCount,1);
  assert.deepEqual(requiredRates([current,loss],{goal:3000000,targetDate:'2030-05-17',monthly:0},new Date('2026-10-16')),requiredRates([current],{goal:3000000,targetDate:'2030-05-17',monthly:0},new Date('2026-10-16')));
});

test('several historical profits and losses add once, including when no holdings have known costs',()=>{
  const p=portfolio([{mode:'manual',value:2500000,cost:null},realized(-500000),realized(100000)]);
  assert.equal(p.pnl,null);assert.equal(p.realizedPnl,-400000);assert.equal(p.cumulativePnl,-400000);
  assert.equal(p.costCount,0);assert.equal(p.realizedCount,2);assert.equal(p.total,2500000);
});

test('changing an existing manual record to historical loss preserves its ID and removes its former cost',()=>{
  const old={id:'old-loss',mode:'manual',name:'賠錢50萬',value:0,cost:500000};
  const updated=parseAsset({mode:'manual',name:old.name,manualKind:'realized',realizedPnl:'-500000',cost:'500000',value:'0'},old);
  assert.equal(updated.id,old.id);assert.equal(updated.cost,null);assert.equal(updated.realizedPnl,-500000);
  const p=portfolio([updated]);assert.equal(p.pnl,null);assert.equal(p.cumulativePnl,-500000);
  const back=parseAsset({mode:'manual',name:'現金',manualKind:'asset',value:'100',cost:'0'},updated);
  assert.equal(isRealized(back),false);assert.equal(back.realizedPnl,undefined);assert.equal(valuation(back).pnl,100);
});

test('historical input requires a finite amount and does not permit negative current asset values',()=>{
  for(const raw of ['',null,'   ','NaN','Infinity'])assert.throws(()=>parseAsset({mode:'manual',name:'歷史損益',manualKind:'realized',realizedPnl:raw}),/歷史損益/);
  assert.throws(()=>parseAsset({mode:'manual',name:'資產',value:'-500000',cost:''}),/非負/);
  assert.equal(realized(500000).realizedPnl,500000);
});

test('backup round trip preserves both historical losses and zero costs without disclosing private settings',()=>{
  const loss={...realized(),finnhubKey:'PRIVATE'};
  const backup=buildBackup({settings:{goal:3000000,targetDate:'2030-05-17',monthly:0,finnhubKey:'PRIVATE'},assets:[reward,loss],history:[],ownPosts:[]});
  const restored=parseBackup(backup);const p=portfolio(restored.assets);
  assert.equal(restored.assets[0].costPer,0);assert.equal(p.total,800);assert.equal(p.pnl,800);
  assert.equal(p.realizedPnl,-500000);assert.equal(p.cumulativePnl,-499200);
  assert.equal(sharedAsset(loss).realizedPnl,-500000);assert.ok(!JSON.stringify(backup).includes('PRIVATE'));
});
