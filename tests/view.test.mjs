import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core from '../core.js';
import * as review from '../review.js';
import * as backup from '../backup.js';
import {icon} from '../icons.js';
import {VERSION,DEFAULT_SETTINGS} from '../config.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
function harness(code=source,overrides={}){
  const nodes=new Map();
  for(const match of html.matchAll(/id="([^"]+)"/g)){
    const classes=new Set();nodes.set(match[1],{dataset:{},textContent:'',innerHTML:'',open:false,className:'',classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(v,on)=>{if(on)classes.add(v);else classes.delete(v);},contains:v=>classes.has(v)},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},elements:new Proxy({}, {get:(o,k)=>o[k]||(o[k]={value:'',checked:false})}),reset(){}});
  }
  const calls=[];
  const cloud=new Proxy({isAdmin:()=>false}, {get:(target,key)=>target[key]||(()=>{calls.push(key);throw new Error('Demo must never call cloud: '+key);})});
  const notifications={notificationStatus:()=>({configured:false,permission:'default',prefs:{strategy:true,daily:true},subscribed:false}),appOpened:async()=>{},strategyPublished:async()=>{},enableNotifications:async()=>{},disableNotifications:async()=>{},updateNotificationPreferences:async()=>{}};
  const context={...review,...core,...backup,VERSION,DEFAULT_SETTINGS,icon,cloud,notifications,refreshMarket:()=>{throw new Error('Demo must never call a market API');},document:{getElementById:name=>{if(!nodes.has(name))throw new Error('Missing element: '+name);return nodes.get(name);},querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},scrollTo(){}},location:{search:'?demo=1',hash:''},navigator:{},URLSearchParams,URL,crypto:webcrypto,structuredClone,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},console,...overrides};
  const api=vm.runInNewContext(code+'\n({s,render,sharing,startDemo,stopSession,loadSharing,publish,refreshOwn,saveSnapshot,assetRows,assetIcon,avatarContent,installedMode,changeHistoryPage,admin,renderAdminUsers,openStrategy,handleReviewAction,strategyReviewHtml,loadVisibleReviews});',context);
  return {api,nodes,calls};
}
test("asset and strategy dialogs use a consistent accessible close icon without the oversized gold focus ring",()=>{const buttons=[...html.matchAll(/data-close="(assetDialog|strategyDialog)" aria-label="關閉">([\s\S]*?)<\/button>/g)];assert.equal(buttons.length,2);for(const button of buttons)assert.match(button[2],/<svg viewBox="0 0 24 24"/);assert.match(styles,/\.modal-heading \.icon-button\{[^}]*min-width:44px[^}]*min-height:44px/);assert.match(styles,/\.modal-heading \.icon-button::before\{content:"";position:absolute;inset:5px/);assert.match(styles,/\.modal-heading \.icon-button:focus-visible\{outline:none/);});
test("manual quote refresh is never delayed by the previous refresh timestamp",async()=>{const {api,nodes}=harness();api.s.demo=true;api.s.user={uid:"demo-self",displayName:"小陽",email:"demo@example.com"};api.s.assets=[{id:"mstr",name:"MSTR",mode:"stock",symbol:"MSTR",qty:10,quote:{nativePrice:100,fx:32,fetchedAt:"2026-10-05T00:00:00Z",error:""}}];api.s.lastRefresh=Date.now();await api.refreshOwn(true);assert.match(nodes.get("toast").textContent,/示範行情已更新/);assert.equal(api.s.refreshing,false);});
test('demo initializes all five views without touching Firebase or external quotes',()=>{const {api,nodes,calls}=harness();assert.equal((nodes.get('navigation').innerHTML.match(/data-page=/g)||[]).length,5);for(const page of ['home','assets','sharing','history','settings']){api.s.page=page;api.render(true);assert.ok(nodes.get('content').innerHTML.length>100);assert.ok(!nodes.get('content').innerHTML.includes('NaN'));}assert.equal(calls.length,0);});
test('settings adds a separate notification setup card without changing other app logic',()=>{const {api,nodes}=harness();api.s.page='settings';api.render(true);const view=nodes.get('content').innerHTML;assert.match(view,/手機通知/);assert.match(view,/Cloudflare Worker/);assert.match(view,/每日提醒預設開啟/);assert.match(view,/目標日期/);});
test("USD market value is clearly labeled and stale prices are identified as last successful values",()=>{const {api}=harness();const asset={id:"mstr",name:"MSTR",mode:"stock",symbol:"MSTR",qty:241,quote:{nativePrice:166.68,fx:31.78,fetchedAt:"2026-10-06T14:11:00Z",error:""}};assert.match(api.assetRows([asset]),/美元市值估算 · 約 US\$ 40,170/);asset.quote.error="報價更新失敗";assert.match(api.assetRows([asset]),/上次成功市值 · 約 US\$ 40,170/);});
test("avatar uses the Google profile photo from a trusted origin and escapes the fallback",()=>{const {api}=harness();assert.match(api.avatarContent({displayName:"小陽",photoURL:"https://lh3.googleusercontent.com/a/profile"}),/<img class="avatar-photo"/);assert.equal(api.avatarContent({displayName:"<script>",photoURL:"https://attacker.example/avatar.png"}),"&lt;");});
test("holding badges use a symbol-specific accent and a readable ticker initial",()=>{const {api}=harness();const html=api.assetIcon({mode:"stock",symbol:"MSTR",name:"MicroStrategy"});assert.match(html,/aria-label="MSTR 標的圖示"/);assert.match(html,/>M</);assert.match(html,/--asset-accent:#[0-9a-f]{6}/i);});
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

test('mobile financial goal date control stays within its card and keeps a usable date field',()=>{
  const {api,nodes}=harness();api.s.page='settings';api.render(true);
  const view=nodes.get('content').innerHTML;
  assert.match(view,/<form id="goalForm"[\s\S]*?<input type="date" name="targetDate"/);
  assert.match(styles,/input\[type=date\]\{[^}]*box-sizing:border-box[^}]*width:100%[^}]*min-width:0[^}]*max-width:100%/);
  assert.match(styles,/#goalForm,#goalForm label\{width:100%;min-width:0;max-width:100%\}/);
});

test('account management toggles while loading and reuses the completed list',async()=>{
  let finish,calls=0;const cloud={isAdmin:()=>true,adminUsers:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}};
  const {api,nodes}=harness(source,{cloud});api.s.demo=false;api.s.user={uid:'admin',displayName:'管理者',email:'admin@example.com'};api.s.page='settings';api.render(true);
  assert.match(nodes.get('content').innerHTML,/data-action="admin" aria-expanded="false" aria-controls="adminCard"/);
  assert.ok(nodes.get('content').innerHTML.indexOf('id="adminCard"')<nodes.get('content').innerHTML.indexOf('KEEP A COPY'));
  const classes=new Set(['hidden']);const card={innerHTML:'',dataset:{},classList:{remove:value=>classes.delete(value),add:value=>classes.add(value),contains:value=>classes.has(value)}};nodes.set('adminCard',card);
  const attrs=new Map([['aria-expanded','false']]);const button={dataset:{action:'admin'},textContent:'管理使用者',getAttribute:key=>attrs.get(key)||null,setAttribute:(key,value)=>attrs.set(key,value)};
  const loading=api.admin(button);assert.equal(classes.has('hidden'),false);assert.match(card.innerHTML,/正在載入使用者名單/);assert.equal(button.textContent,'收合名單');
  await api.admin(button);assert.equal(classes.has('hidden'),true);assert.equal(attrs.get('aria-expanded'),'false');assert.equal(button.textContent,'管理使用者');
  const reopened=api.admin(button);assert.equal(classes.has('hidden'),false);assert.equal(calls,1,'Reopening during a request must not create duplicate cloud reads');
  finish([{id:'new-user',name:'新使用者',email:'new@example.com',status:'pending'}]);await Promise.all([loading,reopened]);
  assert.match(card.innerHTML,/new@example.com/);assert.match(card.innerHTML,/data-action="approve"/);assert.equal(card.dataset.loaded,'true');
  await api.admin(button);assert.equal(classes.has('hidden'),true);await api.admin(button);assert.equal(classes.has('hidden'),false);assert.equal(calls,1,'Reopening a loaded panel should not refetch the list');
});

test("strategy cards are collapsed by default and use participation rather than votes or approvals",()=>{const {api,nodes}=harness();api.startDemo();api.s.page="sharing";api.s.sharingTab="long";api.render();const markup=nodes.get("content").innerHTML;assert.match(markup,/<details class="strategy-card strategy-collapse"/);assert.doesNotMatch(markup,/<details class="strategy-card strategy-collapse"[^>]*open/);assert.match(markup,/data-action="participation"[^>]*data-choice="participating"/);assert.match(markup,/data-choice="not-participating"/);assert.match(markup,/暫不參與/);assert.doesNotMatch(markup,/策略投票|老師審核|teacher-approve|teacher-submit/);});


test("admin users are grouped by access state, searchable, and show counts",()=>{const {api}=harness();const card={dataset:{statusFilter:"approved"},innerHTML:""};const users=[{id:"a",name:"Approved User",email:"a@example.com",status:"approved"},{id:"p",name:"Pending User",email:"p@example.com",status:"pending"}];api.renderAdminUsers(card,users);assert.match(card.innerHTML,/已核准/);assert.match(card.innerHTML,/Approved User/);assert.doesNotMatch(card.innerHTML,/Pending User|p@example.com/);assert.match(card.innerHTML,/id="adminSearch"/);assert.match(styles,/\.admin-filters/);});

test('duplicate investment holdings consolidate by default and retain editable original lots',()=>{
  const {api}=harness();
  const base={mode:'crypto',symbol:'BTC',type:'加密貨幣',quote:{nativePrice:100000,fx:32,currency:'USD',source:'Demo',fetchedAt:'2026-10-07T00:00:00Z'}};
  const lots=[{...base,id:'btc-a',name:'Bitcoin',qty:0.1,costPer:80000,costFx:32},{...base,id:'btc-b',name:'BTC 冷錢包',qty:0.2,costPer:90000,costFx:31}];
  let view=api.assetRows(lots);assert.match(view,/BTC · 整合 2 筆/);assert.match(view,/data-action="toggle-asset-group"/);assert.doesNotMatch(view,/data-id="btc-a"/);
  api.s.expandedAssetGroups.add('crypto:BTC');view=api.assetRows(lots);assert.match(view,/Bitcoin/);assert.match(view,/BTC 冷錢包/);assert.match(view,/data-id="btc-a"/);assert.match(view,/原始持倉/);
  api.s.assetDisplayMode='individual';view=api.assetRows(lots);assert.doesNotMatch(view,/整合 2 筆/);assert.match(view,/Bitcoin/);assert.match(view,/BTC 冷錢包/);
});



test('consolidated holdings sort by combined market value',()=>{
  const {api}=harness();const q={nativePrice:100,fx:1,currency:'USD',fetchedAt:'2026-10-07'};
  const lots=[{id:'btc1',name:'BTC one',mode:'crypto',symbol:'BTC',qty:1,quote:q},{id:'btc2',name:'BTC two',mode:'crypto',symbol:'BTC',qty:1,quote:q},{id:'mstr',name:'MSTR',mode:'stock',symbol:'MSTR',qty:1,quote:q}];
  const html=api.assetRows(lots);assert.ok(html.indexOf('BTC · 整合 2 筆')<html.indexOf('MSTR · 美股'));
});
