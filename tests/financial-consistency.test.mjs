import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHoldings,portfolio,valuation,sharedAsset,num,isRealized} from '../core.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=Math.max(1e-7,Math.abs(expected)*1e-12),`${actual} != ${expected}`);
const quote={nativePrice:0.223749,fx:32,fetchedAt:'2026-10-16T18:40:00Z',error:''};
const ada=[
  {id:'paid',mode:'crypto',symbol:'ADA',name:'ADA',qty:111200,costPer:0.74,costFx:null,quote},
  {id:'reward',mode:'crypto',symbol:'ADA',name:'ADA 質押獎勵',qty:1917,costPer:0,costFx:null,quote}
];

test('the reported ADA example includes all 1,917 free coins in average cost and P&L exactly once',()=>{
  const original=structuredClone(ada),[group]=aggregateHoldings(ada),p=portfolio(ada);
  assert.equal(group.qty,113117);
  close(group.averageCost,82288/113117);
  assert.equal(num(group.averageCost,4),'0.7275');
  assert.equal(num(group.averageCost,2),'0.73');
  close(group.nativeValue,25309.815633);
  close(group.cost,82288*32);
  close(group.pnl,(25309.815633-82288)*32);
  assert.equal(num(group.percent,2),'-69.24');
  assert.equal(num(valuation(ada[0]).percent,2),'-69.76');
  close(group.pnl-valuation(ada[0]).pnl,valuation(ada[1]).value);
  for(const key of ['total','cost','pnl'])close(p[key],group[key==='total'?'value':key]);
  close(p.total-p.invested,p.overallPnl);
  assert.deepEqual(ada,original);
});

test('a new quote and quantity are recalculated without keeping old merged averages or prices',()=>{
  aggregateHoldings(ada);
  const changed=ada.map(a=>({...a,qty:a.id==='reward'?2500:a.qty,quote:{...a.quote,nativePrice:0.3}}));
  const [group]=aggregateHoldings(changed),p=portfolio(changed);
  close(group.averageCost,82288/113700);
  close(group.value,113700*0.3*32);
  close(group.pnl,(113700*0.3-82288)*32);
  close(p.total,group.value);close(p.overallPnl,group.pnl);
});

test('shared and owner numbers agree for the same selected lots, including zero-cost rewards',()=>{
  const shared=ada.map(sharedAsset);
  assert.deepEqual(portfolio(shared),portfolio(ada));
  const [group]=aggregateHoldings(shared);
  close(group.averageCost,82288/113117);
  const selectedOnly=portfolio([shared[1]]);
  assert.equal(selectedOnly.cost,0);assert.equal(selectedOnly.overallPercent,null);
  close(selectedOnly.overallPnl,selectedOnly.total);
});

test('mixed currencies, rewards, cash, reference balances and historical losses reconcile',()=>{
  const assets=[...ada,
    {id:'tw',mode:'tw',symbol:'2330',qty:10,costPer:500,quote:{nativePrice:600,fx:1}},
    {id:'stock',mode:'stock',symbol:'MSTR',qty:2,costPer:100,costFx:30,quote:{nativePrice:110,fx:32}},
    {id:'usd',mode:'usd',qty:100,costPer:100,costFx:30,quote:{fx:32}},
    {id:'cash',mode:'manual',value:20000,cost:20000},
    {id:'reference',mode:'usd',qty:999999,costPer:999999,quote:{fx:32},isSummary:true},
    {id:'loss',mode:'manual',recordKind:'realized',value:0,realizedPnl:-500000},
    {id:'gain',mode:'manual',recordKind:'realized',value:0,realizedPnl:10000}
  ];
  const p=portfolio(assets);
  close(p.total,25309.815633*32+6000+7040+3200+20000);
  close(p.cost,82288*32+5000+6000+3000+20000);
  assert.equal(p.realizedPnl,-490000);
  close(p.invested,p.cost+490000);
  close(p.overallPnl,p.total-p.invested);
  close(p.overallPercent,p.overallPnl/p.invested*100);
  assert.equal(p.count,6);
  assert.equal(p.costComplete,true);assert.equal(p.pnlComplete,true);
});

test('300 varied portfolios preserve market value, costs and return through grouping and sharing',()=>{
  let seed=1376;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let round=0;round<300;round++){
    const assets=Array.from({length:1+round%35},(_,i)=>{
      const mode=['stock','crypto','tw','manual','usd'][i%5],qty=(1+Math.floor(random()*100000))/100;
      const price=(1+Math.floor(random()*100000))/100,unitCost=i%7===0?0:Math.floor(random()*100000)/100;
      return {id:String(i),mode,symbol:'ASSET'+i%3,name:'Test '+i,qty,
        costPer:mode==='usd'?qty*unitCost:unitCost,costFx:mode==='tw'?null:30+random()*4,
        cost:mode==='manual'?unitCost*qty:null,value:price*qty,
        quote:{nativePrice:price,fx:mode==='tw'?1:30+random()*4,fetchedAt:'2026-10-16',error:''}};
    });
    assets.push({id:'past',mode:'manual',recordKind:'realized',value:0,realizedPnl:Math.round((random()-0.7)*1000000)});
    const before=structuredClone(assets),p=portfolio(assets),groups=aggregateHoldings(assets);
    close(p.total-p.cost,p.pnl);
    close(p.total-p.invested,p.overallPnl);
    const visible=groups.filter(a=>!isRealized(a)&&!a.isSummary);
    close(visible.reduce((sum,a)=>sum+(a.aggregate?a.value:valuation(a).value),0),p.total);
    close(visible.reduce((sum,a)=>sum+(a.aggregate?a.cost:valuation(a).cost),0),p.cost);
    close(visible.reduce((sum,a)=>sum+(a.aggregate?a.pnl:valuation(a).pnl),0),p.pnl);
    for(const a of visible.filter(a=>a.aggregate)){
      close(a.averageCost*a.qty,a.lots.reduce((sum,lot)=>sum+lot.qty*lot.costPer,0));
    }
    assert.deepEqual(portfolio(assets.map(sharedAsset)),p);
    assert.deepEqual(assets,before);
  }
});

test('unknown costs and unavailable quotes remain incomplete rather than invented as zero',()=>{
  const assets=[...ada,{...ada[0],id:'unknown',costPer:null,qty:10}];
  const p=portfolio(assets),[group]=aggregateHoldings(assets);
  close(group.averageCost,82288/113117);
  assert.equal(group.qty,113127);assert.equal(group.coverage,2);
  assert.equal(p.costComplete,false);assert.equal(p.pnlComplete,false);assert.equal(p.overallPercent,null);
  const pending=portfolio([{...ada[0],costFx:32,quote:{nativePrice:null,fx:null}}]);
  assert.equal(pending.costComplete,true);assert.equal(pending.pnlComplete,false);assert.equal(pending.overallPercent,null);
  assert.equal(pending.overallPnl,null);
});
