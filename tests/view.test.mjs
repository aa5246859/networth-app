import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core from '../core.js';
import * as backup from '../backup.js';
import {icon} from '../icons.js';
import {VERSION,DEFAULT_SETTINGS} from '../config.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
function harness(code=source,overrides={}){
  const nodes=new Map();
  for(const match of html.matchAll(/id="([^"]+)"/g)){
    const classes=new Set();nodes.set(match[1],{textContent:'',innerHTML:'',open:false,className:'',classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(v,on)=>{if(on)classes.add(v);else classes.delete(v);}},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},elements:new Proxy({}, {get:(o,k)=>o[k]||(o[k]={value:'',checked:false})}),reset(){}});
  }
  const calls=[];
  const cloud=new Proxy({isAdmin:()=>false}, {get:(target,key)=>target[key]||(()=>{calls.push(key);throw new Error('Demo must never call cloud: '+key);})});
  const context={...core,...backup,VERSION,DEFAULT_SETTINGS,icon,cloud,refreshMarket:()=>{throw new Error('Demo must never call a market API');},document:{getElementById:name=>{if(!nodes.has(name))throw new Error('Missing element: '+name);return nodes.get(name);},addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},scrollTo(){}},location:{search:'?demo=1',hash:''},navigator:{},URLSearchParams,crypto:webcrypto,structuredClone,setTimeout:()=>0,clearTimeout(){},console,...overrides};
  const api=vm.runInNewContext(code+'\n({s,render,sharing,startDemo,stopSession,loadSharing,publish,refreshOwn,saveSnapshot,assetRows,installedMode,changeHistoryPage});',context);
  return {api,nodes,calls};
}
test('demo initializes all five views without touching Firebase or external quotes',()=>{const {api,nodes,calls}=harness();assert.equal((nodes.get('navigation').innerHTML.match(/data-page=/g)||[]).length,5);for(const page of ['home','assets','sharing','history','settings']){api.s.page=page;api.render(true);assert.ok(nodes.get('content').innerHTML.length>100);assert.ok(!nodes.get('content').innerHTML.includes('NaN'));}assert.equal(calls.length,0);});
test('friend holdings are read-only and never contain owner edit actions',()=>{const {api,nodes}=harness();api.s.page='sharing';api.s.friend='demo-friend';api.render();const view=nodes.get('content').innerHTML;assert.match(view,/唯讀/);assert.ok(!view.includes('data-action="edit-asset"'));assert.ok(!view.includes('data-action="delete-asset"'));});
test('strategy-only access hides portfolio values and portfolio-only access hides strategies',()=>{const {api,nodes}=harness();const friend=api.s.friends[0];api.s.page='sharing';api.s.friend=friend.id;friend.portfolioAccess=false;api.render();assert.match(nodes.get('content').innerHTML,/尚未取得持倉授權/);assert.ok(!nodes.get('content').innerHTML.includes('Vanguard 全市場'));friend.strategyAccess=false;api.s.sharingTab='long';api.render();assert.match(nodes.get('content').innerHTML,/尚未取得策略授權/);});
test('friend strategies load after switching objects and never render private drafts',async()=>{const {api,nodes}=harness();api.s.page='sharing';api.s.friend='demo-friend';api.s.sharingTab='long';api.s.friendPosts=[];await api.loadSharing();assert.match(nodes.get('content').innerHTML,/維持核心部位/);api.s.friendPosts.push({...api.s.friendPosts[0],id:'secret',published:false,title:'PRIVATE SECRET'});api.render();assert.ok(!nodes.get('content').innerHTML.includes('PRIVATE SECRET'));});
test('demo publication preserves separate audiences and selected-asset boundaries',async()=>{const {api,calls}=harness();const chosen=api.s.assets[0].id;api.s.selected=[chosen];api.s.portfolioViewers=['p'];api.s.strategyViewers=['t'];await api.publish();assert.equal(api.s.published.assets.length,1);assert.equal(api.s.published.assets[0].id,chosen);assert.equal(api.s.published.viewerUids[0],'p');assert.equal(api.s.strategyAccess.viewerUids[0],'t');await api.refreshOwn();await api.saveSnapshot();assert.equal(calls.length,0);});
test('displayed imported names and strategy texts are escaped',()=>{const {api,nodes}=harness();api.s.assets[0].name='<img src=x onerror=alert(1)>';api.s.page='assets';api.render();assert.ok(!nodes.get('content').innerHTML.includes('<img src=x'));assert.match(nodes.get('content').innerHTML,/&lt;img src=x/);api.s.ownPosts[0].thesis='<script>alert(1)</script>';api.s.page='sharing';api.s.sharingTab='long';api.render();assert.ok(!nodes.get('content').innerHTML.includes('<script>alert'));});
test('standalone preview initializes its actual bundled script with no network imports',()=>{const preview=fs.readFileSync(new URL('../preview.html',import.meta.url),'utf8');const match=preview.match(/<script>([\s\S]*?)<\/script>/);assert.ok(match);new vm.Script(match[1]);assert.ok(!match[1].includes('firebasejs/'));assert.ok(!/\bimport\s*\(/.test(match[1]));assert.ok(!preview.includes('src="app.js"'));assert.ok(/startDemo\(\);\s*$/.test(match[1]),'Preview must start directly in demo mode');const {api,nodes}=harness(match[1]);assert.equal(api.s.demo,true);assert.match(nodes.get('content').innerHTML,/目前總資產/);});
test('session end clears previous account holdings, keys, strategies and grants',()=>{const {api}=harness();api.s.settings.finnhubKey='SECRET';api.stopSession();for(const key of ['assets','history','friends','ownPosts','friendPosts','selected','portfolioViewers','strategyViewers'])assert.equal(api.s[key].length,0);assert.equal(api.s.settings.finnhubKey,'');assert.equal(api.s.user,null);assert.equal(api.s.published.viewerUids.length,0);});

test("installed-mode detection supports iPhone and standards-based browsers",()=>{assert.equal(harness(source,{navigator:{standalone:true}}).api.installedMode(),true);assert.equal(harness(source,{window:{addEventListener(){},matchMedia:()=>({matches:true})}}).api.installedMode(),true);assert.equal(harness().api.installedMode(),false);});

test('daily records show newest ten by date while retaining all records and the previous value outside the window',()=>{
  const {api,nodes}=harness();
  const records=Array.from({length:15},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,total:100000+i*100}));
  api.s.history=[...records].reverse();api.s.page='history';api.render(true);
  const view=nodes.get('content').innerHTML,table=view.match(/<table class="history-table">([\s\S]*?)<\/table>/)[1];
  const dates=[...table.matchAll(/<td class="mono">(2026-09-\d{2})<\/td>/g)].map(m=>m[1]);
  assert.equal(dates.length,10);assert.equal(dates[0],'2026-09-15');assert.equal(dates[9],'2026-09-06');
  assert.ok(!table.includes('2026-09-05'));assert.ok(!view.includes('more-history'));assert.match(view,/最近 10 筆/);
  assert.ok(table.includes(core.signed(100)));assert.equal(api.s.history.length,15);assert.equal(api.s.history[0].date,'2026-09-15');
  const oldest=table.match(/<tr><td class="mono">2026-09-06<\/td>([\s\S]*?)<\/tr>/)[1];
  assert.ok(oldest.includes(core.signed(100)),'Oldest visible row compares against the hidden previous day');
  api.s.history=records.slice(0,3);api.render(true);assert.match(nodes.get('content').innerHTML,/最近 3 筆/);
  api.s.history=[];api.render(true);assert.match(nodes.get('content').innerHTML,/還沒有資產紀錄/);
});

test('older history starts collapsed, pages in tens and retains its previous-record comparison',()=>{
  const {api,nodes}=harness();api.s.history=Array.from({length:35},(_,i)=>({date:core.taipeiDay(new Date(Date.UTC(2026,7,i+1))),total:100000+i*100}));api.s.page='history';api.render();
  let view=nodes.get('content').innerHTML;assert.match(view,/<details id="olderHistory" class="history-archive" >/);
  const rows=()=>nodes.get('content').innerHTML.match(/<details id="olderHistory"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1];
  assert.equal((rows().match(/<tr>/g)||[]).length,10);assert.match(view,/較早紀錄 <small>25 筆/);
  api.changeHistoryPage(1);assert.equal(api.s.historyArchivePage,1);assert.equal(api.s.historyArchiveOpen,true);assert.match(nodes.get('content').innerHTML,/<details id="olderHistory" class="history-archive" open>/);assert.equal((rows().match(/<tr>/g)||[]).length,10);
  api.changeHistoryPage(1);assert.equal((rows().match(/<tr>/g)||[]).length,5);api.changeHistoryPage(1);assert.equal(api.s.historyArchivePage,2);
  api.changeHistoryPage(-1);api.changeHistoryPage(-1);api.changeHistoryPage(-1);assert.equal(api.s.historyArchivePage,0);assert.equal(api.s.history.length,35);
  api.s.history=api.s.history.slice(0,10);api.render();assert.ok(!nodes.get('content').innerHTML.includes('id="olderHistory"'));
});
