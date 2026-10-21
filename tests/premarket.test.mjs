import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePremarketQuote,premarketQuotes,limitedJson} from '../notification-worker/premarket.js';
import worker from '../notification-worker/worker.js';
import {refreshMarket} from '../quotes.js';
import {portfolio,sharedAsset} from '../core.js';
import {stockPremarket} from '../premarket-client.js';

const now=new Date('2026-10-21T09:00:00Z');
const start=Date.parse('2026-10-21T08:00:00Z')/1000,end=Date.parse('2026-10-21T13:30:00Z')/1000;
const source='Yahoo Finance 盤前（可能延遲）';
const payload=(symbol='MSTR',times=[start+60,start+120],prices=[110,115])=>({chart:{error:null,result:[{meta:{symbol,currency:'USD',instrumentType:'EQUITY',hasPrePostMarketData:true,currentTradingPeriod:{pre:{start,end}}},timestamp:times,indicators:{quote:[{close:prices}]}}]}});
const quote=(price=115,at='2026-10-21T08:59:00Z')=>({symbol:'MSTR',session:'pre',price,priceAt:at,source});
const asset={id:'one',name:'MSTR',mode:'stock',symbol:'MSTR',qty:2,costPer:100,quote:{nativePrice:100,fx:32,priceAt:'2026-10-20T20:00:00Z',fetchedAt:'2026-10-20T20:01:00Z',source:'Finnhub',error:''}};
const regular=async url=>Response.json(String(url).includes('open.er-api')?{rates:{TWD:32}}:{c:100,t:Date.parse('2026-10-20T20:00:00Z')/1000});
const premarketFetcher=async()=>({quotes:{MSTR:quote()}});

test('premarket uses the latest actual valid bar, not regular close, null, zero or a future sample',()=>{
  const data=payload('MSTR',[start-60,start+120,start+60,start+180,start+240,now.getTime()/1000+60],[999,115,110,null,0,999]);
  const result=parsePremarketQuote(data,'MSTR',now.getTime());
  assert.equal(result.price,115);assert.equal(result.priceAt,new Date((start+120)*1000).toISOString());assert.equal(result.session,'pre');
  assert.equal(result.source,source);assert.notEqual(result.priceAt,now.toISOString());
});

test('wrong symbols, non-USD assets, unsupported markets and malformed timestamps never become stock quotes',()=>{
  for(const change of [d=>d.chart.result[0].meta.symbol='BTC-USD',d=>d.chart.result[0].meta.currency='TWD',d=>d.chart.result[0].meta.instrumentType='CRYPTOCURRENCY',d=>d.chart.result[0].meta.hasPrePostMarketData=false,d=>d.chart.result[0].timestamp=[],d=>d.chart.result[0].meta.currentTradingPeriod.pre.end=start,d=>d.chart.error={code:'Not Found'}]){
    const data=payload();change(data);assert.equal(parsePremarketQuote(data,'MSTR',now.getTime()),null);
  }
  assert.equal(parsePremarketQuote(payload(),'MSTR',(start-1)*1000),null);
  assert.equal(parsePremarketQuote(payload(),'MSTR',end*1000),null);
  assert.equal(parsePremarketQuote(payload(),'MSTR',now.getTime()+86400000),null);
});

test('source session boundaries also handle winter time and holidays without inventing trades',()=>{
  const winter=payload(),pre=winter.chart.result[0].meta.currentTradingPeriod.pre;
  pre.start=Date.parse('2026-12-01T09:00:00Z')/1000;pre.end=Date.parse('2026-12-01T14:30:00Z')/1000;
  winter.chart.result[0].timestamp=[pre.start+60];winter.chart.result[0].indicators.quote[0].close=[120];
  assert.equal(parsePremarketQuote(winter,'MSTR',Date.parse('2026-12-01T09:05:00Z')).price,120);
  assert.equal(parsePremarketQuote(winter,'MSTR',Date.parse('2026-11-30T09:05:00Z')),null);
});

test('free upstream requests deduplicate symbols and use a short public quote cache without credentials',async()=>{
  const cached=new Map(),calls=[];
  const cache={match:async key=>cached.get(key.url)?.clone(),put:async(key,response)=>{assert.match(response.headers.get('Cache-Control'),/max-age=30/);cached.set(key.url,response.clone());}};
  const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(payload());};
  let result=await premarketQuotes(['MSTR','MSTR'],'https://worker.example/premarket-quotes',{fetchImpl,cache,now:now.getTime()});
  assert.equal(result.quotes.MSTR.price,115);assert.equal(calls.length,1);
  assert.ok(calls[0].url.includes('includePrePost=true'));assert.equal(calls[0].options.headers.Authorization,undefined);
  result=await premarketQuotes(['MSTR'],'https://worker.example/premarket-quotes',{fetchImpl,cache,now:now.getTime()+10000});
  assert.equal(result.quotes.MSTR.price,115);assert.equal(calls.length,1);
  result=await premarketQuotes(['MSTR'],'https://worker.example/premarket-quotes',{fetchImpl,cache,now:end*1000});
  assert.deepEqual(result.quotes,{});assert.equal(calls.length,2,'an expired market session cannot reuse a cached premarket quote');
});

test('lookup validates bounded symbols, isolates per-symbol failure, and maps class shares safely',async()=>{
  let calls=0;
  for(const symbols of [[],Array(21).fill('MSTR'),['https://attacker.example'],['MSTR?token=secret'],[null],['A'.repeat(21)]])await assert.rejects(premarketQuotes(symbols,'https://worker.example',{fetchImpl:async()=>{calls++;}}),/20/);
  assert.equal(calls,0);
  const result=await premarketQuotes(['MSTR','BRK.B'],'https://worker.example',{cache:null,now:now.getTime(),fetchImpl:async url=>{
    if(url.includes('/MSTR?'))return Response.json({},{status:429});
    assert.ok(url.includes('/BRK-B?'));return Response.json(payload('BRK-B'));
  }});
  assert.equal(result.quotes['BRK.B'].symbol,'BRK.B');assert.equal(result.quotes.MSTR,undefined);assert.ok(result.errors.MSTR);
});

test('public market route needs no login, never queries account data, and other Worker routes stay protected',async(t)=>{
  t.mock.method(Date,'now',()=>now.getTime());let calls=0;
  t.mock.method(globalThis,'fetch',async url=>{assert.ok(String(url).startsWith('https://query1.finance.yahoo.com/'));calls++;return Response.json(payload());});
  const env={APP_ORIGIN:'https://wealth.example'};
  const request=origin=>new Request('https://worker.example/premarket-quotes',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({symbols:['MSTR']})});
  const response=await worker.fetch(request(env.APP_ORIGIN),env);
  assert.equal(response.status,200);assert.equal((await response.json()).quotes.MSTR.price,115);assert.equal(calls,1);
  assert.equal((await worker.fetch(request('https://attacker.example'),env)).status,403);assert.equal(calls,1);
  const denied=await worker.fetch(new Request('https://worker.example/strategy-event',{method:'POST',headers:{Origin:env.APP_ORIGIN},body:'{}'}),env);
  assert.equal(denied.status,400);assert.match((await denied.json()).error,/登入/);assert.equal(calls,1);
});

test('new premarket price updates value and P&L in all lots and shared holdings without changing costs or quantities',async()=>{
  const assets=[asset,{...asset,id:'two',qty:1,costPer:0}],before=structuredClone(assets);let calls=0;
  const result=await refreshMarket(assets,'free-key',{now,fetchImpl:regular,premarketFetcher:async symbols=>{calls++;assert.deepEqual(symbols,['MSTR']);return premarketFetcher();}});
  const updated=assets.map((a,i)=>({...a,quote:result.updates[i].quote})),total=portfolio(updated);
  assert.equal(calls,1);assert.ok(updated.every(a=>a.quote.nativePrice===115&&a.quote.source===source));
  assert.equal(total.total,3*115*32);assert.equal(total.cost,2*100*32);assert.equal(total.pnl,total.total-total.cost);
  assert.deepEqual(portfolio(updated.map(sharedAsset)),total);assert.deepEqual(assets,before);
  assert.ok(result.updates.every(update=>update.qty===undefined&&update.costPer===undefined));
});

test('free premarket works without a new key or notification permission and unavailable sources preserve newer prices',async()=>{
  let finnhub=0;
  const fresh=await refreshMarket([asset],'',{now,premarketFetcher,fetchImpl:async url=>{if(url.includes('finnhub'))finnhub++;return Response.json({rates:{TWD:32}});}});
  assert.equal(fresh.updates[0].quote.nativePrice,115);assert.equal(finnhub,0);assert.deepEqual(fresh.issues,[]);
  const saved={...asset,quote:{...asset.quote,nativePrice:120,priceAt:'2026-10-21T08:58:00Z',fetchedAt:'2026-10-21T08:58:30Z',source}};
  const failed=await refreshMarket([saved],'free-key',{now,fetchImpl:regular,premarketFetcher:async()=>{throw Error('upstream unavailable');}});
  const retained=failed.updates[0].quote;
  assert.equal(retained.nativePrice,120);assert.equal(retained.priceAt,saved.quote.priceAt);assert.equal(retained.fetchedAt,saved.quote.fetchedAt);assert.match(retained.error,/較舊/);
});

test('daylight-saving, weekends and market opening gate premarket requests; fresh regular trades replace premarket prices',async()=>{
  for(const [instant,expected] of [['2026-10-21T08:01:00Z',1],['2026-12-01T09:01:00Z',1],['2026-12-01T08:01:00Z',0],['2026-10-24T09:00:00Z',0],['2026-10-21T13:30:00Z',0]]){
    let calls=0;await refreshMarket([asset],'key',{now:new Date(instant),fetchImpl:regular,premarketFetcher:async()=>{calls++;return {quotes:{}};}});assert.equal(calls,expected,instant);
  }
  const saved={...asset,quote:{...asset.quote,nativePrice:115,priceAt:'2026-10-21T13:29:00Z',source}};
  const result=await refreshMarket([saved],'key',{now:new Date('2026-10-21T13:32:00Z'),premarketFetcher:()=>{throw Error('must not run after open');},fetchImpl:async url=>Response.json(url.includes('open.er-api')?{rates:{TWD:32}}:{c:116,t:Date.parse('2026-10-21T13:31:00Z')/1000})});
  assert.equal(result.updates[0].quote.nativePrice,116);assert.equal(result.updates[0].quote.source,'Finnhub');assert.equal(result.updates[0].quote.error,'');
});

test('invalid, stale and future extension samples never override a valid newer regular quote',async()=>{
  for(const bad of [quote(-1),quote(999,'2026-10-21T09:02:00Z'),quote(999,'2026-10-20T08:59:00Z'),{...quote(),symbol:'OTHER'},{...quote(),session:'regular'}]){
    const result=await refreshMarket([asset],'key',{now,fetchImpl:regular,premarketFetcher:async()=>({quotes:{MSTR:bad}})});assert.equal(result.updates[0].quote.nativePrice,100);
  }
  const result=await refreshMarket([asset],'key',{now,fetchImpl:async url=>Response.json(url.includes('open.er-api')?{rates:{TWD:32}}:{c:117,t:Date.parse('2026-10-21T08:59:30Z')/1000}),premarketFetcher});
  assert.equal(result.updates[0].quote.nativePrice,117);assert.equal(result.updates[0].quote.source,'Finnhub');
});

test('market client sends only symbols to the free Worker endpoint, without a Firebase or market API key',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).pathname,'/premarket-quotes');assert.deepEqual(JSON.parse(options.body),{symbols:['MSTR']});assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal);
    return Response.json({ok:true,quotes:{MSTR:quote()}});
  });
  assert.equal((await stockPremarket(['MSTR'])).quotes.MSTR.price,115);
});

test('chunked requests and upstream data are bounded even when Content-Length is missing',async()=>{
  const chunked=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(3000)));controller.close();}}));
  await assert.rejects(limitedJson(chunked,2048),/大小/);
  assert.deepEqual(await limitedJson(Response.json({symbols:['MSTR']}),2048),{symbols:['MSTR']});
});

test('a quote created while the upstream request is in flight is validated against response time',async(t)=>{
  let clock=now.getTime();t.mock.method(Date,'now',()=>clock);
  const result=await premarketQuotes(['MSTR'],'https://worker.example',{cache:null,fetchImpl:async()=>{
    clock+=5000;return Response.json(payload('MSTR',[now.getTime()/1000+3],[118]));
  }});
  assert.equal(result.quotes.MSTR.price,118);
  const applied=await refreshMarket([asset],'key',{now,fetchImpl:regular,premarketFetcher:async()=>result});
  assert.equal(applied.updates[0].quote.nativePrice,118);
});
