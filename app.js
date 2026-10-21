import {reviewState,createReview,castReviewVote,teacherDecisionState} from './review.js?v=2.4.19';
import {VERSION,DEFAULT_SETTINGS} from "./config.js?v=2.4.29";
import {TYPES,finite,costAmount,isRealized,id,taipeiDay,stamp,num,money,compact,signed,esc,normalizeAsset,valuation,portfolio,aggregateHoldings,requiredRates,sharedAsset,parseAsset} from "./core.js";
import {refreshMarket} from "./quotes.js";
import {icon} from "./icons.js";
import {buildBackup,parseBackup} from "./backup.js";
import * as cloud from "./store.js?v=2.4.29";
import * as notifications from "./notifications.js";

const $=name=>document.getElementById(name);
const renderedHeaderHtml=new WeakMap();
function updateHeaderHtml(node,html){if(renderedHeaderHtml.get(node)!==html){node.innerHTML=html;renderedHeaderHtml.set(node,html);}}
const PAGES={home:["總覽","OVERVIEW"],assets:["我的持倉","PORTFOLIO"],sharing:["共享空間","SHARED SPACE"],history:["資產紀錄","HISTORY"],settings:["設定","PREFERENCES"]};
const colors=["#e3b34c","#b29f70","#798d80","#a5a68b","#647b70","#c7b786"];
const s={user:null,demo:false,page:"home",assets:[],history:[],settings:{...DEFAULT_SETTINGS},published:{assets:[],viewerUids:[]},strategyAccess:{viewerUids:[]},friends:[],ownPosts:[],friendPosts:[],participation:{},participationErrors:{},participationUnsubs:new Map(),invites:{sent:[],received:[]},sharingTab:"portfolios",friend:"self",search:"",filter:"all",sort:"value",sharedFilter:"all",sharedSort:"value",assetDisplayMode:"aggregate",expandedAssetGroups:new Set(),historyArchivePage:0,historyArchiveOpen:false,refreshing:false,lastRefresh:0,selected:[],portfolioViewers:[],strategyViewers:[],shareDirty:false,settingsDirty:false,dirtyForms:new Set(),inviteEmail:"",adminUsers:[],subscriptions:[],session:0,reviews:{},reviewHistory:{},reviewActor:"author"};
let firebaseReady=false,toastTimer,editingAsset=null,editingPost=null,pendingConfirmation=null,authUnsubscribe=null,adminRequest=null;

// Strategy lists and read receipts are separate from participation responses.
Object.assign(s,{strategyReads:{},strategyReadErrors:{},strategyReadUnsubs:new Map(),strategyListOff:null,strategyListKey:"",strategyListGeneration:0,strategyListRevision:0});
let loginState="idle";
function setLoginState(state,error=""){
  loginState=state;
  const busy=["connecting","signing","loading"].includes(state),button=$("loginButton"),progress=$("loginProgress"),demo=$("demoButton");
  const labels={connecting:"正在連線…",signing:"登入中，請稍候…",loading:"登入中，請稍候…"};
  button.disabled=busy;button.setAttribute("aria-busy",String(busy));
  button.innerHTML=busy?'<span class="login-button-spinner" aria-hidden="true"></span><span>'+labels[state]+'</span>':(state==="error"?(firebaseReady?"重新登入":"重新連線"):(firebaseReady?"使用 Google 登入":"重新連線"));
  progress.classList.toggle("hidden",!busy);
  $("loginProgressTitle").textContent=state==="loading"?"正在讀取你的資料":state==="signing"?"正在使用 Google 登入":"正在確認登入狀態";
  $("loginProgressDetail").textContent=state==="loading"?"登入已完成，正在確認授權與讀取資料。完成後會自動進入。":state==="signing"?"請完成 Google 帳號登入；完成後會自動進入。":"正在連線，請稍候。";
  $("loginError").textContent=error;
  demo.disabled=state==="signing"||state==="loading";
}
async function beginLogin(){
  if(["connecting","signing","loading"].includes(loginState))return;
  if(!firebaseReady)return initFirebase();
  if(loginState==="error"&&s.user)return startUser(s.user);
  setLoginState("signing");
  try{await cloud.login();}catch(error){if(loginState==="signing")setLoginState("error",message(error));}
}

function toast(message,error=false){clearTimeout(toastTimer);$("toast").textContent=message;$("toast").className="toast visible"+(error?" error":"");toastTimer=setTimeout(()=>$("toast").classList.remove("visible"),error?6500:3500);}
function message(error){if(error?.userMessage)return error.userMessage;if(error?.code==="permission-denied")return "這次操作未完成：目前帳號沒有存取權限。請重新整理，並確認登入與分享授權仍有效。";return error?.message||"操作失敗，請稍後再試。";}
async function task(button,fn,errorElement=null){const old=button?.innerHTML;if(button){button.disabled=true;button.innerHTML="處理中…";}document.body.classList.add("saving");try{if(errorElement)errorElement.textContent="";await fn();}catch(e){if(errorElement)errorElement.textContent=message(e);toast(message(e),true);}finally{document.body.classList.remove("saving");if(button){button.disabled=false;if(button.innerHTML==="處理中…")button.innerHTML=old;}}}
function pnl(value,percent=null){if(!finite(value))return '<span class="muted">未設定成本／待更新</span>';return `<span class="${value>=0?"up":"down"}">${signed(value)}${finite(percent)?` <small>(${value>0?"+":""}${num(percent,2)}%)</small>`:""}</span>`;}
function badge(text,kind=""){return `<span class="badge ${kind}">${esc(text)}</span>`;}
function quoteText(a){if(a.mode==="manual")return "手動輸入";if(a.quote?.error)return a.quote.error;if(a.mode==="tw"&&!a.quote?.priceAt)return "收盤價 · 查詢 "+stamp(a.quote?.fetchedAt);return "行情 "+stamp(a.quote?.priceAt||a.quote?.fetchedAt);}
function assetAccent(symbol){const palette=["#e3b34c","#65a98b","#7b9ad1","#bd82ba","#d88764","#7eb8bd"];const sum=[...String(symbol||"asset").toUpperCase()].reduce((n,c)=>n+c.charCodeAt(0),0);return palette[sum%palette.length];}
function assetIcon(a){const symbol=(a.symbol||a.name||"USD").trim();const label=a.mode==="manual"?"$":symbol.slice(0,1).toUpperCase();return `<span class="asset-icon ${esc(a.mode)}" style="--asset-accent:${assetAccent(symbol)}" aria-label="${esc(symbol)} 標的圖示">${esc(label)}</span>`;}
function googlePhotoUrl(value){try{const url=new URL(value);return url.protocol==="https:"&&(url.hostname==="googleusercontent.com"||url.hostname.endsWith(".googleusercontent.com"))?url.href:"";}catch{return "";}}
function avatarContent(user=s.user){const photo=googlePhotoUrl(user?.photoURL);return photo?`<img class="avatar-photo" src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`:esc(user?.displayName?.slice(0,1)||"W");}
function heading(description,actions=""){const [title,kicker]=PAGES[s.page];return `<div class="page-heading"><div class="heading-title"><div class="eyebrow">${kicker}</div><h1>${title}</h1></div>${actions?`<div class="heading-actions">${actions}</div>`:""}<p class="page-description">${description}</p></div>`;}
function empty(title,text,action="",name="assets"){return `<div class="empty-state"><div class="empty-icon">${icon(name)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;}
function refreshButton(action="refresh"){return `<button class="button secondary refresh-button" aria-label="${s.refreshing?'更新報價中':'更新報價'}" title="更新報價" data-action="${action}" ${s.refreshing?"disabled":""}>${icon("refresh")}<span>${s.refreshing?"更新中":"更新報價"}</span></button>`;}
function graph(history,height=152){const entries=history.slice(-30);if(entries.length<2)return '<div class="chart-empty">累積兩筆紀錄後，顯示資產曲線。</div>';const min=Math.min(...entries.map(x=>x.total)),max=Math.max(...entries.map(x=>x.total)),span=(max-min)||Math.max(max*.01,1);const pts=entries.map((x,i)=>[12+i*576/(entries.length-1),height-20-(x.total-min)/span*(height-45)]);const path=pts.map((p,i)=>(i?"L":"M")+p.map(v=>v.toFixed(2)).join(" ")).join(" ");const last=pts.at(-1);return `<svg class="chart" viewBox="0 0 600 ${height}" preserveAspectRatio="none" role="img" aria-label="最近 ${entries.length} 筆資產變化"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e3b34c" stop-opacity=".14"/><stop offset="1" stop-color="#e3b34c" stop-opacity="0"/></linearGradient></defs>${[35,80,125].map(y=>`<path d="M0 ${y}H600" stroke="#2a362f" stroke-dasharray="3 6"/>`).join("")}<path d="${path} L${last[0]} ${height} L12 ${height}Z" fill="url(#chartFill)"/><path d="${path}" stroke="#e3b34c" stroke-width="2.3" fill="none" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#e3b34c" stroke="#18211c" stroke-width="3"/></svg><div class="chart-labels"><span>${esc(entries[0].date.slice(5))}</span><span>${esc(entries[Math.floor(entries.length/2)].date.slice(5))}</span><span>${esc(entries.at(-1).date.slice(5))}</span></div>`;}
function allocation(){const map=new Map();for(const a of s.assets){const v=valuation(a);if(a.isSummary||!finite(v.value)||v.value<=0)continue;const label=a.mode==="manual"?(a.type||"其他"):TYPES[a.mode];map.set(label,(map.get(label)||0)+v.value);}const entries=[...map.entries()].sort((a,b)=>b[1]-a[1]);const total=entries.reduce((sum,x)=>sum+x[1],0);if(!total)return empty("配置尚未建立","新增資產後即可查看分布。","","assets");let cursor=0;const parts=entries.map(([_,value],i)=>{const start=cursor;cursor+=value/total*100;return `${colors[i%colors.length]} ${start}% ${cursor}%`;});return `<div class="allocation"><div class="donut" style="background:conic-gradient(${parts.join(",")})"><div class="donut-label">${entries.length}<small>資產類別</small></div></div><div class="legend">${entries.map(([label,value],i)=>`<div class="legend-row"><span class="legend-dot" style="background:${colors[i%colors.length]}"></span><span>${esc(label)}</span><span class="percent mono">${num(value/total*100,1)}%</span></div>`).join("")}</div></div>`;}
function historicalSummary(p){
  if(!p.realizedCount)return "";
  return `<dl class="summary-ledger" aria-label="歷史與累計損益"><div><dt>歷史已實現</dt><dd class="mono">${pnl(p.realizedPnl)}</dd></div><div><dt>${p.covered<p.count?"已知累計損益":"累計損益"}</dt><dd class="mono">${pnl(p.cumulativePnl)}</dd></div></dl>`;
}
function home(){
  const p=portfolio(s.assets),goal=+s.settings.goal||1;
  const progress=Math.min(100,p.total/goal*100),rates=requiredRates(s.assets,s.settings);
  const latest=s.assets.map(a=>a.quote?.fetchedAt).filter(Boolean).sort().at(-1);
  const priceOnly=s.assets.some(a=>!a.isSummary&&valuation(a).kind.includes("未計匯差"));
  const amountClass=String(Math.round(p.total)).length>9?" long-amount":"";
  return `${heading("持倉與目標，一眼掌握。")}
    <div class="overview-grid"><section class="hero wealth-summary" aria-label="資產總覽">
      <div class="summary-heading"><span>目前總資產</span><span class="summary-currency">NT$ · 台幣</span></div>
      <div class="summary-amount mono${amountClass}">${num(p.total,0)}</div>
      <div class="summary-cost"><span>${p.costComplete?"總投入本金":"已知投入本金"}</span><strong class="mono">${finite(p.invested)?money(p.invested):"尚未設定"}</strong></div>
      <div class="summary-return">
        <div class="summary-return-label">${p.pnlComplete?"總損益":"已知總損益"}</div>
        <div class="summary-pnl mono">${pnl(p.overallPnl,p.overallPercent)}</div>
        <details class="summary-method"><summary>計算說明 ${icon("chevron")}</summary><div class="summary-explanation"><dl><div><dt>目前持倉成本</dt><dd class="mono">${p.costCount?money(p.cost):"尚未設定"}</dd></div><div><dt>持倉浮動損益</dt><dd class="mono">${pnl(p.pnl)}</dd></div><div><dt>歷史已實現損益</dt><dd class="mono">${pnl(p.realizedPnl)}</dd></div></dl><p>總投入本金＝目前持倉成本－已記錄的歷史已實現損益；總損益＝持倉浮動損益＋歷史已實現損益。過往虧損不會再從目前總資產扣除。</p><p>${p.costCount} / ${p.count} 筆已填成本；未填成本不當成零，資料未齊時顯示已知金額。${priceOnly?"部分美元成本依目前匯率估算，未計入匯差。":""}本金依已記錄資料彙總，同一筆損益請勿同時記入持倉成本與歷史損益；入金或提領需反映在資產紀錄中。</p></div></details>
      </div>
      <div class="summary-footer"><div class="summary-updated"><span>${s.refreshing?"行情更新中":"行情更新"}</span><span class="mono">${latest?stamp(latest):"尚未取得行情"}</span>${s.quoteRefreshError?`<span class="quote-refresh-error" role="status">${esc(s.quoteRefreshError)}</span>`:p.stale?'<span class="quote-refresh-error">部分行情待確認</span>':""}</div><button class="button secondary summary-refresh" data-action="refresh" ${s.refreshing?"disabled":""}>${icon("refresh")}${s.refreshing?"更新中…":"更新報價"}</button></div>
    </section>
    <div class="home-grid">
      <section class="card trend-card"><div class="card-header"><h2>資產變化</h2><button class="text-button" data-page="history">查看紀錄 ${icon("arrow")}</button></div>${graph(s.history,165)}</section>
      <section class="card goal-card"><div class="card-header"><h2>目標進度</h2><button class="text-button" data-page="settings">調整</button></div><div class="goal-top"><span class="goal-percent mono">${num(progress,1)}<small>%</small></span><span class="small muted">${esc(s.settings.targetDate)}</span></div><div class="progress"><span style="width:${Math.max(0,progress)}%"></span></div><div class="goal-detail"><div>距離目標<strong class="mono">${compact(Math.max(0,goal-p.total))}</strong></div><div>目標金額<strong class="mono">${compact(goal)}</strong></div></div><div class="goal-foot"><span class="muted">${rates.state==="done"?"目標已達成":rates.state==="expired"?"目標日期已到期":`剩餘約 ${Math.ceil(rates.days||0)} 天`}</span><span class="muted">每月投入 ${compact(+s.settings.monthly||0)}</span></div></section>
    </div>
    </div><details class="card disclosure"><summary>資產配置與達標試算</summary><div class="disclosure-body"><div class="analysis-grid"><section><h2>資產配置</h2>${allocation()}<p class="rate-note" style="margin-top:18px">已填持倉成本 ${p.costCount?money(p.cost):"尚未設定"}${p.estimatedCost?"（部分依目前匯率估算）":""}。未填成本不視為零；歷史已實現損益不列入目前持倉成本。</p></section><section><h2>達標所需報酬</h2>${ratesHtml(rates)}</section></div></div></details>`;
}
function ratesHtml(r){const texts={noCapital:"請先新增資產或設定每月投入，才能計算所需報酬。",expired:"目標日期已到期，請到設定調整。",done:"你已達成目標，可以設定下一個里程碑。",invalid:"請先確認目標金額、日期與投入金額。",unsolved:"目前條件無法得到有效結果，請調整目標或日期。",contributions:"依此試算，每月投入已足以達標，不需額外投資報酬。"};if(r.state!=="calculated")return `<p class="rate-note">${texts[r.state]||"請先設定目標。"}</p>`;return `<div class="rates-grid"><div class="rate-box"><div class="label">年報酬</div><div class="value gold mono">${num(r.ry*100,1)}%</div></div><div class="rate-box"><div class="label">月報酬</div><div class="value mono">${num(r.rm*100,2)}%</div></div><div class="rate-box"><div class="label">日報酬</div><div class="value mono">${num(r.rd*100,3)}%</div></div></div><p class="rate-note">以固定複利、每月投入近似試算。這是達標條件，不代表可實現的投資報酬。${r.ry>1?"<br><span class=\"gold\">所需年報酬偏高，可調整期限、目標或投入。</span>":""}</p>`;}

function mobileAverageCost(a){
  if(!["stock","tw","crypto"].includes(a.mode))return "";
  const value=a.aggregate?a.averageCost:costAmount(a.costPer),valid=finite(value),currency=a.mode==="tw"?"TWD":"USD",unit=a.mode==="crypto"?"顆":"股";
  const partial=a.aggregate&&a.lots.some(lot=>!finite(costAmount(lot.costPer)));
  return `<div class="asset-cost-mobile"><span>${partial?"已填成本均價":"平均買入"}</span><span class="mono">${valid?num(value,4)+" "+currency+" / "+unit:"未設定"}</span></div>`;
}
function realizedRow(a,editable=true){
  return `<tr class="realized-row"><td><div class="asset-name">${assetIcon(a)}<div><div class="asset-title">${esc(a.name)}</div><div class="asset-sub">歷史已實現損益</div><div class="asset-quote">不計入目前總資產</div></div></div></td><td class="qty-col muted">—</td><td class="price-col muted">—</td><td class="value-cell"><div class="money mono">${pnl(a.realizedPnl)}</div><div class="asset-sub">台幣 · 過往${a.realizedPnl<0?"虧損":"損益"}</div></td>${editable?`<td class="action-cell"><div class="table-actions"><button class="icon-button" data-action="edit-asset" data-id="${esc(a.id)}" aria-label="編輯 ${esc(a.name)}">${icon("edit")}</button><button class="icon-button" data-action="delete-asset" data-id="${esc(a.id)}" aria-label="刪除 ${esc(a.name)}">×</button></div></td>`:""}</tr>`;
}
function assetSingleRow(a,editable=true){if(isRealized(a))return realizedRow(a,editable);const v=valuation(a),native=a.mode==="manual"?"—":a.mode==="usd"?"美元資產":`${num(v.price,a.mode==="crypto"?6:2)} ${v.currency}`,meta=a.mode==="manual"?"手動輸入":`${num(+a.qty||0,6)} ${a.mode==="stock"||a.mode==="tw"?"股":a.mode==="usd"?"USD":"顆"}`;return `<tr><td><div class="asset-name">${assetIcon(a)}<div><div class="asset-title">${esc(a.name)}</div><div class="asset-sub">${a.symbol?esc(a.symbol)+" · ":""}${esc(a.mode==="manual"?a.type:TYPES[a.mode])} · ${esc(meta)}${a.isSummary?" · 參考值":""}</div>${mobileAverageCost(a)}<div class="asset-quote ${v.stale?"gold":""}">${esc(quoteText(a))}</div></div></div></td><td class="qty-col mono">${num(+a.qty||0,6)}<div class="asset-sub">${finite(costAmount(a.costPer))?num(+a.costPer,4)+" "+v.currency:"成本未填"}</div></td><td class="price-col mono">${native}<div class="asset-sub">${a.quote?.source?esc(a.quote.source):""}</div></td><td class="value-cell"><div class="money mono">${money(v.value)}</div><div class="pnl-percent mono">${pnl(v.pnl,v.percent)}</div>${finite(v.nativeValue)&&v.currency==="USD"?`<div class="asset-sub mono">${v.stale?"上次成功市值":"美元市值估算"} · 約 US$ ${num(v.nativeValue,0)}</div>`:""}</td>${editable?`<td class="action-cell"><div class="table-actions"><button class="icon-button" data-action="edit-asset" data-id="${esc(a.id)}" aria-label="編輯 ${esc(a.name)}">${icon("edit")}</button><button class="icon-button" data-action="delete-asset" data-id="${esc(a.id)}" aria-label="刪除 ${esc(a.name)}">×</button></div></td>`:""}</tr>`;}
function aggregateRow(group,editable=true){const expanded=s.expandedAssetGroups.has(group.aggregateKey),average=finite(group.averageCost)?`${num(group.averageCost,4)} ${group.currency}`:"尚有部位未填成本",quote=finite(group.price)?`${num(group.price,group.mode==="crypto"?6:2)} ${group.currency}`:"報價待更新",coverage=group.coverage<group.lots.length?` · ${group.coverage}/${group.lots.length} 筆有成本`:"";return `<tr class="aggregate-row"><td><div class="asset-name">${assetIcon(group)}<div><div class="asset-title">${esc(group.symbol)} · 整合 ${group.lots.length} 筆</div><div class="asset-sub">${esc(TYPES[group.mode])} · ${num(group.qty,6)} ${group.unit}<span class="aggregate-cost-inline"> · 平均成本 ${esc(average)}</span></div>${mobileAverageCost(group)}<div class="asset-quote ${group.stale?"gold":""}">${group.stale?"含待更新報價":"目前均價"} ${esc(quote)}</div></div></div></td><td class="qty-col mono">${num(group.qty,6)} ${group.unit}<div class="asset-sub">平均成本 ${finite(group.averageCost)?num(group.averageCost,4):"未完整設定"} ${group.currency}</div></td><td class="price-col mono">${quote}<div class="asset-sub">加權目前報價</div></td><td class="value-cell"><div class="money mono">${money(group.value)}</div><div class="pnl-percent mono">${pnl(group.pnl,group.percent)}${coverage?`<div class="asset-sub">部分成本未設定${esc(coverage)}</div>`:""}</div>${finite(group.nativeValue)&&group.currency==="USD"?`<div class="asset-sub mono">合計約 US$ ${num(group.nativeValue,2)}</div>`:""}</td>${editable?`<td class="action-cell"><button class="icon-button aggregate-toggle" data-action="toggle-asset-group" data-key="${esc(group.aggregateKey)}" aria-expanded="${expanded}" aria-label="${expanded?"收合":"查看"} ${esc(group.symbol)} 明細">${expanded?"−":"＋"}</button></td>`:""}</tr>${expanded?`<tr class="aggregate-detail-row"><td colspan="${editable?5:4}"><div class="aggregate-details"><div class="aggregate-details-heading">原始持倉 · ${group.lots.length} 筆</div>${group.lots.map(a=>{const v=valuation(a);return `<div class="aggregate-lot"><div><strong>${esc(a.name||a.symbol)}</strong><span>${num(+a.qty||0,6)} ${group.unit} · 成本 ${finite(costAmount(a.costPer))?num(+a.costPer,4)+" "+(group.mode==="tw"?"TWD":"USD"):"未填"}</span></div><div><strong>${money(v.value)}</strong><span>${pnl(v.pnl,v.percent)}</span></div>${editable?`<div class="table-actions"><button class="icon-button" data-action="edit-asset" data-id="${esc(a.id)}" aria-label="編輯 ${esc(a.name)}">${icon("edit")}</button><button class="icon-button" data-action="delete-asset" data-id="${esc(a.id)}" aria-label="刪除 ${esc(a.name)}">×</button></div>`:""}</div>`;}).join("")}<p class="small muted">整合只改變顯示與計算，不會修改或刪除原始持倉。</p></div></td></tr>`:""}`;}
function assetRows(assets,editable=true,sort=s.sort){
  if(!assets.length)return empty("目前沒有持倉","新增資產，或調整搜尋條件。",editable?'<button class="button secondary" data-action="add-asset">新增持倉</button>':"");
  // Sort using one valuation per holding; discard the cache after this render.
  const metrics=new Map();
  const metric=(a,key)=>{if(a.aggregate)return a[key];if(isRealized(a))return key==="pnl"?a.realizedPnl:0;if(!metrics.has(a))metrics.set(a,valuation(a));return metrics.get(a)[key];};
  const shown=(s.assetDisplayMode==="aggregate"?aggregateHoldings(assets):[...assets]).sort((a,b)=>sort==="name"?String(a.aggregate?a.symbol:a.name).localeCompare(String(b.aggregate?b.symbol:b.name)):sort==="pnl"?(metric(b,"pnl")??-Infinity)-(metric(a,"pnl")??-Infinity):(metric(b,"value")??0)-(metric(a,"value")??0));
  return `<div class="table-wrap"><table class="asset-table ${editable?'':'readonly'}"><thead><tr><th>持倉 / 類別</th><th class="qty-col">數量 / 均價</th><th class="price-col">原幣報價</th><th>市值 / 損益</th>${editable?"<th></th>":""}</tr></thead><tbody>${shown.map(a=>a.aggregate?aggregateRow(a,editable):assetSingleRow(a,editable)).join("")}</tbody></table></div>`;
}
function filteredAssets(){const q=s.search.toLowerCase(),values=new Map();const value=a=>{if(!values.has(a))values.set(a,valuation(a));return values.get(a);};return s.assets.filter(a=>(s.filter==="all"||a.mode===s.filter)&&(!q||(a.name+" "+a.symbol).toLowerCase().includes(q))).sort((a,b)=>s.sort==="name"?a.name.localeCompare(b.name):s.sort==="pnl"?(value(b).pnl??-Infinity)-(value(a).pnl??-Infinity):(value(b).value||0)-(value(a).value||0));}
function assetDisplayToggle(){return `<div class="asset-display-toggle" role="group" aria-label="持倉顯示方式"><span>顯示方式</span><div><button data-action="asset-display" data-mode="aggregate" class="${s.assetDisplayMode==="aggregate"?"active":""}">自動整合</button><button data-action="asset-display" data-mode="individual" class="${s.assetDisplayMode==="individual"?"active":""}">逐筆查看</button></div></div>`;}
function assetsPage(){const p=portfolio(s.assets);return `${heading(`${p.count} 個持倉${p.realizedCount?` · ${p.realizedCount} 筆歷史損益`:""} · 總資產 ${money(p.total)}`)}<section class="card"><div class="holdings-actions"><h2>持倉列表</h2><div class="card-actions">${refreshButton()}<button class="button secondary card-action" data-action="add-asset">${icon("plus")}新增持倉</button></div></div>${assetDisplayToggle()}<div class="toolbar"><div class="search-field">${icon("search")}<input id="assetSearch" placeholder="搜尋名稱或代號" value="${esc(s.search)}" aria-label="搜尋持倉"></div><select id="assetFilter" aria-label="資產類別"><option value="all">所有類別</option>${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${s.filter===k?"selected":""}>${v}</option>`).join("")}</select><select id="assetSort" aria-label="排序"><option value="value" ${s.sort==="value"?"selected":""}>市值高 → 低</option><option value="pnl" ${s.sort==="pnl"?"selected":""}>損益高 → 低</option><option value="name" ${s.sort==="name"?"selected":""}>名稱排序</option></select></div><div id="assetRows">${assetRows(filteredAssets())}</div><p class="table-note">美元部位未填買入匯率時，只顯示按目前匯率換算的價差損益；行情與匯率可能有延遲。帳戶總值設為參考值時，不會重複計入總資產。</p></section>`;}

function sharing(){const own=s.friend==="self",friend=s.friends.find(x=>x.id===s.friend),selected=s.sharingTab;const choices=`<select id="friendSelect" class="friend-select" aria-label="查看對象"><option value="self">我的分享與草稿</option>${s.friends.map(f=>`<option value="${esc(f.id)}" ${s.friend===f.id?"selected":""}>${esc(f.ownerName||"朋友")}</option>`).join("")}</select>`;const action=own&&selected!=="portfolios"?`<button class="button primary" data-action="add-strategy">${icon("plus")}新增策略</button>`:!own&&selected==="portfolios"&&friend?.portfolioAccess?refreshButton("refresh-friend"):!own&&selected!=="portfolios"?`<button class="button secondary" data-action="reload-sharing">${icon("refresh")}重新整理</button>`:"";return `${heading("把選擇分享的部位，與背後的交易想法放在一起。",action)}<div class="sharing-top"><div class="segment" role="group" aria-label="共享分類">${[["portfolios","持倉共享"],["long","長線策略"],["short","短線策略"]].map(([key,text])=>`<button data-tab="${key}" class="${selected===key?"active":""}">${text}</button>`).join("")}</div>${choices}</div>${selected==="portfolios"?(own?publishPage():friend?.portfolioAccess?friendPortfolio(friend):empty("尚未取得持倉授權","對方目前只分享策略，或尚未開啟持倉共享。","","lock")):strategyPage(own,friend,selected)}${own&&selected==="portfolios"?invitesHtml():""}`;}
function contactRow(i){return `<div class="contact"><div class="contact-top"><span class="contact-name">${esc(i.recipientEmail)}</span></div><div class="contact-choices"><label class="checkbox-row"><input type="checkbox" data-portfolio-viewer="${esc(i.viewerUid)}" ${s.portfolioViewers.includes(i.viewerUid)?"checked":""}><span>持倉</span></label><label class="checkbox-row"><input type="checkbox" data-strategy-viewer="${esc(i.viewerUid)}" ${s.strategyViewers.includes(i.viewerUid)?"checked":""}><span>策略</span></label></div></div>`;}
function publishPage(){const accepted=s.invites.sent.filter(i=>i.status==="accepted"&&i.viewerUid);const active=accepted.filter(i=>(s.published.viewerUids||[]).includes(i.viewerUid)||(s.strategyAccess.viewerUids||[]).includes(i.viewerUid));const available=accepted.filter(i=>(s.published.viewerUids||[]).includes(i.viewerUid)===false&&(s.strategyAccess.viewerUids||[]).includes(i.viewerUid)===false);const last=s.published.updatedAt;return `<div class="share-note">${icon("lock")}<span>預設私人。你選取的持倉，才會分享給勾選的朋友；朋友只能查看。持倉與策略的授權分開設定。取消勾選兩項並儲存，即可撤銷分享。</span></div><div class="share-grid"><section class="card"><div class="card-header"><div><div class="eyebrow">CHOOSE WHAT TO SHARE</div><h2>分享哪些持倉</h2></div>${badge(s.selected.length+" 筆","gold")}</div>${s.assets.length?s.assets.map(a=>`<label class="checkbox-row share-asset-choice"><input type="checkbox" data-share-asset="${esc(a.id)}" ${s.selected.includes(a.id)?"checked":""}><span>${esc(a.name)}<small class="muted"> · ${esc(isRealized(a)?"歷史已實現損益":TYPES[a.mode])}</small></span><span class="amount mono">${isRealized(a)?pnl(a.realizedPnl):money(valuation(a).value)}</span></label>`).join(""):empty("先新增持倉","你可以只分享部分資產。",'<button class="button secondary" data-action="add-asset">新增持倉</button>')}</section><section class="card"><div class="card-header"><div><div class="eyebrow">YOUR TRUSTED CIRCLE</div><h2>分享給誰</h2></div>${icon("users")}</div><details class="share-details"><summary><span>已分享對象</span><span class="muted small">${active.length} 位</span></summary><div class="share-details-body">${active.length?active.map(contactRow).join(""):empty("目前沒有分享對象","在下方選擇已接受邀請的朋友。","","users")}</div></details><details class="share-details"><summary><span>其他已接受邀請</span><span class="muted small">${available.length} 位</span></summary><div class="share-details-body"><p class="small muted">勾選持倉或策略後，按下方「儲存分享設定」才會套用。</p>${available.length?available.map(contactRow).join(""):empty("沒有其他可分享對象","朋友接受邀請後會出現在這裡。","","users")}</div></details></section></div><div class="publish-row"><span class="small muted">${s.shareDirty?"有尚未儲存的分享設定":last?"最後分享更新 "+stamp(last):"尚未發布任何持倉"}</span><button class="button primary" data-action="publish">${icon("check")}儲存分享設定</button></div>`;}
function filteredSharedAssets(f){return (f?.assets||[]).filter(a=>s.sharedFilter==="all"||a.mode===s.sharedFilter);}
function sharedPortfolioToolbar(){return `<div class="toolbar"><select id="sharedAssetFilter" aria-label="共享持倉類別"><option value="all">所有類別</option>${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${s.sharedFilter===k?"selected":""}>${v}</option>`).join("")}</select><select id="sharedAssetSort" aria-label="共享持倉排序"><option value="value" ${s.sharedSort==="value"?"selected":""}>市值高 → 低</option><option value="pnl" ${s.sharedSort==="pnl"?"selected":""}>損益高 → 低</option><option value="name" ${s.sharedSort==="name"?"selected":""}>名稱排序</option></select></div>`;}
function refreshSharedRows(){const f=s.friends.find(x=>x.id===s.friend),rows=$("sharedAssetRows");if(rows)rows.innerHTML=assetRows(filteredSharedAssets(f),false,s.sharedSort);}
function friendPortfolio(f){const p=portfolio(f.assets||[]);return `<section class="hero"><div class="hero-top"><span class="eyebrow">${esc(f.ownerName)} · 已分享的持倉</span>${badge("唯讀","green")}</div><div class="hero-amount mono${String(Math.round(p.total)).length>9?' long-amount':''}"><span class="currency">NT$</span><span class="amount-value">${num(p.total,0)}</span></div><div class="hero-bottom"><div><div class="hero-pnl mono">${pnl(p.pnl,p.percent)}</div><div class="hero-pnl-caption">${p.covered} 筆已設定成本 · 僅包含對方分享的持倉</div></div><div class="quote-state">持倉同步 ${stamp(f.updatedAt)}<br>${f.localRefreshed?"估值更新 "+stamp(f.localRefreshed):"行情依各部位時間"}${f.quoteRefreshError?`<span class="quote-refresh-error" role="status">${esc(f.quoteRefreshError)}</span>`:""}</div></div>${historicalSummary(p)}</section><section class="card" style="margin-top:18px">${assetDisplayToggle()}${sharedPortfolioToolbar()}<div id="sharedAssetRows">${assetRows(filteredSharedAssets(f),false,s.sharedSort)}</div><p class="table-note">${f.localRefreshed?"目前使用你查詢的行情估值，未修改對方持倉。":"估值會自動更新；對方的持倉數量仍以最後分享內容為準。"}</p></section>`;}
let strategyNotificationRoute=0;
function parseStrategyNotification(hash){
  const [page,query=""]=String(hash||"").replace(/^#/,"").split("?");
  if(page!=="sharing")return null;
  const params=new URLSearchParams(query),ownerUid=params.get("owner"),postId=params.get("post");
  if(!ownerUid||!postId||!/^[-A-Za-z0-9_]{1,150}$/.test(ownerUid)||!/^[-A-Za-z0-9_]{1,150}$/.test(postId))return null;
  return {ownerUid,postId,term:params.get("term")==="short"?"short":"long"};
}
async function openStrategyNotification(link){
  if(!link||!s.user||s.demo)return;
  const session=s.session,route=++strategyNotificationRoute,user=s.user;
  s.notificationTarget=null;s.page="sharing";render(true);
  try{
    const own=link.ownerUid===user.uid,posts=await cloud.strategies(link.ownerUid,own);
    if(session!==s.session||route!==strategyNotificationRoute)return;
    const post=posts.find(p=>p.id===link.postId&&(own||p.published===true));
    if(!post)throw new Error("此策略已刪除、停止分享，或你已沒有查看權限。");
    if(own){s.friend="self";s.ownPosts=posts;}else{
      const friend=s.friends.find(f=>f.id===link.ownerUid);
      if(!friend)s.friends.push({id:link.ownerUid,ownerName:post.ownerName||"策略發起人",strategyAccess:true,portfolioAccess:false,assets:[]});
      else friend.strategyAccess=true;
      s.friend=link.ownerUid;s.friendPosts=posts;
    }
    s.sharingTab=post.term;s.notificationTarget={ownerUid:link.ownerUid,postId:post.id};render(true);
    requestAnimationFrame(()=>{
      if(session!==s.session||route!==strategyNotificationRoute)return;
      const card=[...document.querySelectorAll("details[data-strategy-post]")].find(el=>el.dataset.strategyOwner===link.ownerUid&&el.dataset.strategyPost===post.id);
      if(card){card.open=true;const summary=card.querySelector("summary");summary?.setAttribute("tabindex","-1");summary?.focus({preventScroll:true});card.scrollIntoView({block:"start",behavior:"instant"});subscribeParticipation(link.ownerUid,post.id);subscribeStrategyReads(link.ownerUid,post.id);}
    });
  }catch(error){
    if(session!==s.session||route!==strategyNotificationRoute)return;
    s.notificationTarget=null;s.friend="self";s.friendPosts=[];render(true);toast(error?.code==="permission-denied"?"此策略已停止分享，或你已沒有查看權限。":message(error),true);
  }
}
function participationKey(ownerUid,postId){return ownerUid+"/"+postId;}
function participationPanel(post,ownerUid){
  if(!post.published)return '<p class="small muted">發布策略後，授權成員即可選擇是否參與。</p>';
  const audience=Array.isArray(post.audienceUids)?strategyAudience(post,ownerUid):null;
  const rows=(s.participation[participationKey(ownerUid,post.id)]||[]).filter(row=>!audience||row.uid===ownerUid||audience.includes(row.uid)),joined=rows.filter(x=>x.choice==="participating"),notJoined=rows.filter(x=>x.choice==="not-participating"),mine=rows.find(x=>x.uid===s.user?.uid);
  const people=members=>members.map(x=>{const photo=googlePhotoUrl(x.photoURL);return '<span class="participation-person">'+(photo?'<img src="'+esc(photo)+'" alt="" referrerpolicy="no-referrer">':'<span class="participation-initial">'+esc((x.displayName||"友").slice(0,1))+'</span>')+esc(x.displayName||"成員")+'</span>';}).join("");
  const memberGroup=(members,label)=>members.length?'<div role="group" aria-label="'+label+'"><p class="small muted">'+label+'</p><div class="participation-people">'+people(members)+'</div></div>':"";
  const unavailable=s.participationErrors[participationKey(ownerUid,post.id)]&&!Object.hasOwn(s.participation,participationKey(ownerUid,post.id));
  return '<div class="participation-summary"><span>參與 '+(unavailable?"—":joined.length)+'</span><span>暫不參與 '+(unavailable?"—":notJoined.length)+'</span></div>'+(joined.length||notJoined.length?memberGroup(joined,"參與成員")+memberGroup(notJoined,"暫不參與成員"):'<p class="small muted">'+(unavailable?"參與名單未能讀取，請稍後重新開啟策略。":"目前還沒有人選擇參與狀態。")+'</p>')+'<div class="participation-actions"><button class="button '+(mine?.choice==="participating"?"primary":"secondary")+'" data-action="participation" data-owner="'+esc(ownerUid)+'" data-id="'+esc(post.id)+'" data-choice="participating">'+(mine?.choice==="participating"?"已參與":"參與")+'</button><button class="button '+(mine?.choice==="not-participating"?"primary":"secondary")+'" data-action="participation" data-owner="'+esc(ownerUid)+'" data-id="'+esc(post.id)+'" data-choice="not-participating">'+(mine?.choice==="not-participating"?"已選暫不參與":"暫不參與")+'</button></div>';
}
function subscribeParticipation(ownerUid,postId){
  const key=participationKey(ownerUid,postId),posts=ownerUid===s.user?.uid?s.ownPosts:s.friendPosts;
  if(s.demo||s.participationUnsubs.has(key)||!posts.find(p=>p.id===postId)?.published)return;
  const session=s.session;let active=true,off=null;
  const stop=()=>{active=false;off?.();};
  const updatePanel=()=>{const panel=[...document.querySelectorAll("[data-participation-panel]")].find(el=>el.dataset.owner===ownerUid&&el.dataset.post===postId),posts=ownerUid===s.user?.uid?s.ownPosts:s.friendPosts,post=posts.find(x=>x.id===postId);if(panel&&post)panel.innerHTML=participationPanel(post,ownerUid);};
  const failed=error=>{
    if(!active||session!==s.session)return;
    stop();if(s.participationUnsubs.get(key)===stop)s.participationUnsubs.delete(key);
    s.participationErrors[key]=true;updatePanel();
    toast(error?.code==="permission-denied"?"策略參與名單未能讀取。請重新整理，確認登入及此策略的分享授權仍有效。":message(error),true);
  };
  s.participationUnsubs.set(key,stop);
  delete s.participationErrors[key];
  try{off=cloud.listenStrategyParticipation(ownerUid,postId,rows=>{if(!active||session!==s.session)return;s.participation[key]=rows;delete s.participationErrors[key];updatePanel();},failed);if(!active)off?.();}catch(error){failed(error);}
}
function stopParticipation(ownerUid,postId){const key=participationKey(ownerUid,postId),off=s.participationUnsubs.get(key);if(off){off();s.participationUnsubs.delete(key);}}
function strategyAudience(post,ownerUid){
  const authorized=ownerUid===s.user?.uid?s.strategyAccess.viewerUids||[]:s.friends.find(friend=>friend.id===ownerUid)?.strategyViewerUids;
  const ids=Array.isArray(post.audienceUids)?post.audienceUids:authorized||[];
  return [...new Set(ids)].filter(uid=>uid!==ownerUid&&(!authorized||authorized.includes(uid)));
}
function strategyRecipient(uid,ownerUid){
  const invite=ownerUid===s.user?.uid?s.invites.sent.find(item=>item.status==="accepted"&&item.viewerUid===uid):null;
  return {uid,displayName:invite?.viewerName||invite?.recipientEmail||"分享成員",photoURL:invite?.viewerPhotoURL||""};
}
function strategyReadPanel(post,ownerUid){
  if(!post.published)return "";
  const key=participationKey(ownerUid,post.id),rows=s.strategyReads[key]||(s.demo?[]:undefined),failed=s.strategyReadErrors[key];
  if(ownerUid!==s.user?.uid){
    const read=rows?.some(row=>row.uid===s.user?.uid&&row.strategyUpdatedAt===post.updatedAt);
    return `<div class="strategy-read-status"><span class="small muted">${failed?"已讀狀態暫時無法讀取":rows?read?"你已閱讀這次更新":"這次更新尚未標記已讀":"正在讀取已讀狀態…"}</span><button class="button secondary" data-action="strategy-read" data-owner="${esc(ownerUid)}" data-id="${esc(post.id)}" ${read||!rows||failed?"disabled":""}>${read?"已讀":"標記已讀"}</button></div>`;
  }
  const people=strategyAudience(post,ownerUid),readBy=new Map((rows||[]).filter(row=>row.strategyUpdatedAt===post.updatedAt).map(row=>[row.uid,row]));
  const readCount=people.filter(uid=>readBy.has(uid)).length;
  return `<details class="strategy-read-list" data-read-details data-owner="${esc(ownerUid)}" data-post="${esc(post.id)}"><summary><span>閱讀狀態</span><span class="small muted">${failed?"暫時無法讀取":rows?`已讀 ${readCount} · 未讀 ${people.length-readCount}`:"讀取中…"}</span></summary><div class="strategy-read-members">${failed?'<p class="small muted">請收合後重新開啟策略再試。</p>':!people.length?'<p class="small muted">目前沒有策略分享對象。</p>':people.map(uid=>{const receipt=readBy.get(uid),profile=receipt||rows?.find(row=>row.uid===uid)||strategyRecipient(uid,ownerUid),photo=googlePhotoUrl(profile.photoURL),label=profile.displayName||"分享成員";return `<div class="strategy-read-member"><span class="participation-person">${photo?`<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`:`<span class="participation-initial">${esc(label.slice(0,1))}</span>`}<span>${esc(label)}</span></span><span class="small ${receipt?"gold":"muted"}">${rows?receipt?"已讀 · "+stamp(receipt.readAt):"未讀":"讀取中…"}</span></div>`;}).join("")}</div></details>`;
}
function updateStrategyReadPanel(ownerUid,postId){
  const panel=[...document.querySelectorAll("[data-strategy-read-panel]")].find(el=>el.dataset.owner===ownerUid&&el.dataset.post===postId),post=(ownerUid===s.user?.uid?s.ownPosts:s.friendPosts).find(p=>p.id===postId);
  if(!panel||!post)return;const open=panel.querySelector("details")?.open;panel.innerHTML=strategyReadPanel(post,ownerUid);if(open&&panel.querySelector("details"))panel.querySelector("details").open=true;
}
function subscribeStrategyReads(ownerUid,postId){
  const key=participationKey(ownerUid,postId),post=(ownerUid===s.user?.uid?s.ownPosts:s.friendPosts).find(p=>p.id===postId);
  if(s.demo||s.strategyReadUnsubs.has(key)||!post?.published)return;
  const session=s.session;let active=true,off=null;const stop=()=>{active=false;off?.();};
  const fail=()=>{if(!active||session!==s.session)return;stop();if(s.strategyReadUnsubs.get(key)===stop)s.strategyReadUnsubs.delete(key);s.strategyReadErrors[key]=true;updateStrategyReadPanel(ownerUid,postId);};
  s.strategyReadUnsubs.set(key,stop);delete s.strategyReadErrors[key];
  try{off=cloud.listenStrategyReads(ownerUid,postId,s.user.uid,rows=>{if(!active||session!==s.session)return;s.strategyReads[key]=rows;delete s.strategyReadErrors[key];updateStrategyReadPanel(ownerUid,postId);},fail);if(!active)off?.();}catch{fail();}
}
function stopStrategyReads(ownerUid,postId){const key=participationKey(ownerUid,postId);s.strategyReadUnsubs.get(key)?.();s.strategyReadUnsubs.delete(key);}
async function markStrategyRead(button){
  const session=s.session,user=s.user,ownerUid=button.dataset.owner,postId=button.dataset.id,posts=ownerUid===user?.uid?s.ownPosts:s.friendPosts,post=posts.find(p=>p.id===postId);
  if(!user||!post?.published)throw new Error("請重新開啟策略後再標記已讀。");
  let entry={uid:user.uid,strategyUpdatedAt:post.updatedAt,displayName:user.displayName||"使用者",photoURL:user.photoURL||"",readAt:new Date().toISOString()};
  if(!s.demo)try{entry=await cloud.markStrategyRead(user,ownerUid,postId,post.updatedAt);}catch(error){
    if(session!==s.session||user.uid!==s.user?.uid)return;
    if(error.latestPost){const index=posts.findIndex(p=>p.id===postId);if(index>=0&&posts[index].updatedAt===post.updatedAt)posts[index]=error.latestPost;render();}
    throw error;
  }
  if(session!==s.session||user.uid!==s.user?.uid)return;
  const key=participationKey(ownerUid,postId);s.strategyReads[key]=[...(s.strategyReads[key]||[]).filter(row=>row.uid!==user.uid),entry];
  updateStrategyReadPanel(ownerUid,postId);toast("已標記閱讀這次更新。");
}
function syncStrategyList(){
  const ownerUid=s.friend==="self"?s.user?.uid:s.friend,friend=s.friends.find(item=>item.id===ownerUid);
  const key=!s.demo&&s.user&&s.page==="sharing"&&s.sharingTab!=="portfolios"&&(ownerUid===s.user.uid||friend?.strategyAccess)?ownerUid:"";
  if(key===s.strategyListKey)return;
  s.strategyListOff?.();s.strategyListOff=null;s.strategyListKey=key;const generation=++s.strategyListGeneration,session=s.session;
  if(!key)return;
  let active=true,off=null;const stop=()=>{active=false;off?.();};s.strategyListOff=stop;
  const fail=error=>{if(!active||generation!==s.strategyListGeneration||session!==s.session)return;stop();s.strategyListOff=null;if(ownerUid!==s.user.uid){s.friendPosts=[];render();}toast(error?.code==="permission-denied"?"這份策略分享已撤回，或目前無法讀取。":message(error),true);};
  try{off=cloud.listenStrategies(ownerUid,ownerUid===s.user.uid,posts=>{if(!active||generation!==s.strategyListGeneration||session!==s.session)return;s.strategyListRevision++;if(ownerUid===s.user.uid)s.ownPosts=posts;else s.friendPosts=posts;render();},fail);if(!active)off?.();}catch(error){fail(error);}
}
function strategyPage(own,friend,term){
  if(!own&&!friend?.strategyAccess)return empty("尚未取得策略授權","請對方在分享設定勾選策略授權。","","lock");
  const posts=(own?s.ownPosts:s.friendPosts).filter(p=>p.term===term&&(own||p.published===true)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),ownerUid=own?s.user.uid:friend.id;
  const cards=posts.map(p=>'<details class="strategy-card strategy-collapse" data-strategy-owner="'+esc(ownerUid)+'" data-strategy-post="'+esc(p.id)+'"'+(s.notificationTarget?.ownerUid===ownerUid&&s.notificationTarget?.postId===p.id?' open':'')+'><summary><div class="strategy-summary"><div class="strategy-top"><span class="strategy-symbol">'+esc(p.symbol)+'</span>'+badge({watching:"觀察中",active:"執行中",closed:"已結束"}[p.status]||"觀察中",p.status==="active"?"green":"")+'</div><h2>'+esc(p.title)+'</h2><p class="strategy-preview">'+esc(p.thesis)+'</p><span class="strategy-expand-hint">展開策略與參與狀態</span></div></summary><div class="strategy-body"><p class="thesis">'+esc(p.thesis)+'</p><dl class="strategy-info">'+[["進場條件",p.entry],["失效／退出條件",p.invalidation],["目標／持有時間",p.target]].filter(x=>x[1]).map(([title,text])=>'<div><dt>'+title+'</dt><dd>'+esc(text)+'</dd></div>').join("")+'</dl><div class="strategy-bottom"><span>'+(own?(p.published?"已分享":"私人草稿")+" · ":"")+'建立 '+stamp(p.createdAt)+'<br>修改 '+stamp(p.updatedAt)+'</span>'+(own?'<div><button class="text-button" data-action="edit-strategy" data-id="'+esc(p.id)+'">編輯</button><button class="text-button down" data-action="delete-strategy" data-id="'+esc(p.id)+'" style="margin-left:10px">刪除</button></div>':badge("唯讀"))+'</div><section class="participation-panel" data-participation-panel data-owner="'+esc(ownerUid)+'" data-post="'+esc(p.id)+'" aria-label="策略參與狀態">'+participationPanel(p,ownerUid)+'</section><div data-strategy-read-panel data-owner="'+esc(ownerUid)+'" data-post="'+esc(p.id)+'">'+strategyReadPanel(p,ownerUid)+'</div></div></details>').join("");
  return posts.length?'<div class="strategy-grid">'+cards+'</div>':empty(own?"記下你的第一個策略":"目前沒有已分享的策略",own?"把交易理由與失效條件一起記錄，之後更容易回顧。":"對方尚未分享這個週期的交易策略。",own?'<button class="button secondary" data-action="add-strategy">新增策略</button>':"","document");
}
function invitesHtml(){const received=s.invites.received.filter(i=>i.status==="pending");return `<section class="card" style="margin-top:22px"><div class="card-header"><div><div class="eyebrow">INVITE & CONNECT</div><h2>邀請與連結</h2></div><button class="text-button" data-action="reload-sharing">重新整理</button></div><p class="small muted">對方需先登入並取得 App 使用授權。接受邀請後，你再選擇分享給對方的內容。</p><form id="inviteForm" class="invite-form"><input type="email" name="email" placeholder="朋友的 Google 帳號" value="${esc(s.inviteEmail)}" aria-label="朋友 Google 帳號" required><button class="button secondary" type="submit">送出邀請</button></form><div class="invite-list">${received.map(i=>`<div class="invite-item"><div>${esc(i.ownerName)} 邀請你查看分享</div><button class="text-button" data-action="accept-invite" data-id="${esc(i.id)}">接受邀請</button></div>`).join("")}${s.invites.sent.filter(i=>i.status==="pending").map(i=>`<div class="invite-item"><div>${esc(i.recipientEmail)}<div class="muted small">等待對方接受</div></div><button class="text-button" data-action="cancel-invite" data-id="${esc(i.id)}">取消</button></div>`).join("")}</div></section>`;}

function historyTable(entries,ordered){return `<div class="table-wrap"><table class="history-table"><thead><tr><th>日期</th><th>總資產</th><th>較前筆</th></tr></thead><tbody>${entries.map(h=>{const index=ordered.findIndex(x=>x.date===h.date),previous=ordered[index-1];return `<tr><td class="mono">${esc(h.date)}</td><td class="mono">${money(h.total)}</td><td class="mono">${previous?pnl(h.total-previous.total):"—"}</td></tr>`;}).join("")}</tbody></table></div>`;}
function historyPage(){
  const p=portfolio(s.assets),ordered=[...s.history].sort((a,b)=>a.date.localeCompare(b.date));
  const recent=ordered.slice(-10).reverse(),older=ordered.slice(0,-10).reverse();
  const pageCount=Math.ceil(older.length/10),page=Math.min(Math.max(0,s.historyArchivePage),Math.max(0,pageCount-1));
  s.historyArchivePage=page;
  const olderPage=older.slice(page*10,page*10+10);
  const archive=older.length?`<details id="olderHistory" class="history-archive" ${s.historyArchiveOpen?"open":""}><summary><span>較早紀錄 <small>${older.length} 筆</small></span><span class="archive-expand">展開</span><span class="archive-collapse">收起</span></summary><div class="archive-content">${historyTable(olderPage,ordered)}${pageCount>1?`<div class="archive-pagination"><button class="button secondary" data-action="history-previous" ${page===0?"disabled":""}>上一頁</button><span class="small muted">${page+1} / ${pageCount}</span><button class="button secondary" data-action="history-next" ${page===pageCount-1?"disabled":""}>下一頁</button></div>`:""}</div></details>`:"";
  return `${heading("每日資產變化，方便回顧。")}<section class="card"><div class="card-header record-actions"><h2>資產曲線</h2><button class="button secondary card-action" data-action="snapshot">${icon("plus")}記錄今天</button></div><p class="chart-current muted small">目前總資產 <span class="mono">${money(p.total)}</span></p>${graph(s.history,175)}<p class="table-note" style="margin-top:20px">開啟 App 時記錄台灣當天的資產；未開啟的日期不會補記。曲線反映資產變化，包含投入與提領，不等同投資報酬率。</p></section><section class="card" style="margin-top:18px"><div class="card-header"><h2>每日紀錄</h2><span class="small muted history-count">最近 ${recent.length} 筆</span></div>${recent.length?historyTable(recent,ordered)+archive:empty("還沒有資產紀錄","新增持倉後，按記錄今天保存目前總額。","","history")}</section>`;
}
function changeHistoryPage(direction){const pages=Math.ceil(Math.max(0,s.history.length-10)/10);s.historyArchivePage=Math.min(Math.max(0,s.historyArchivePage+direction),Math.max(0,pages-1));s.historyArchiveOpen=true;render();}

function installedMode(){return navigator.standalone===true||typeof window.matchMedia==="function"&&window.matchMedia("(display-mode: standalone)").matches;}
function installCard(){const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent);const steps=ios?'<li>用 iPhone／iPad 的 Safari 開啟正式網站。</li><li>按「分享」→「加入主畫面」。</li><li>若出現「打開為網頁 App」，將它開啟後按「加入」。</li><li>從主畫面點 Wealth Tracker 圖示；Safari 或 Chrome 分頁都不會自動變成 App 視窗。</li>':'<li>用 Android 的 Chrome 開啟正式網站。</li><li>點右上角「⋮」→「安裝應用程式」或「加入主畫面」。</li><li>確認安裝，再從主畫面點 Wealth Tracker 圖示開啟。</li><li>安裝後會以獨立 App 視窗運作；一般瀏覽器分頁仍保留瀏覽器工具列。</li>';return `<section class="card full"><div class="card-header"><h2>加入手機主畫面</h2>${badge(s.demo?"示範預覽":installedMode()?"App 模式":"網頁模式",!s.demo&&installedMode()?"green":"")}</div><p class="small muted">同一個網站、同一份帳號資料。加入主畫面後以獨立 App 視窗操作。</p><ol class="install-steps">${steps}</ol>${s.demo?'<p class="callout">目前是示範資料。下載的 HTML 預覽檔只用來看畫面；正式安裝請使用部署後的 HTTPS 網址。</p>':''}</section>`;}
function notificationSettings(){const n=notifications.notificationStatus();return `<section class="card"><div class="card-header"><div><div class="eyebrow">MOBILE NOTIFICATIONS</div><h2>手機通知</h2></div>${badge(n.subscribed?"已啟用":n.configured?"尚未啟用":"待完成設定",n.subscribed?"green":"")}</div><p class="small muted">策略發布或更新時通知你；每日台灣時間晚上 8 點提醒尚未開啟 App 的裝置。手機系統仍可控制通知是否顯示。</p>${n.configured?`<div class="notification-options"><label class="checkbox-row"><input type="checkbox" data-notification-pref="strategy" ${n.prefs.strategy?"checked":""} ${n.subscribed?"":"disabled"}><span>新策略發布與更新</span></label><label class="checkbox-row"><input type="checkbox" data-notification-pref="daily" ${n.prefs.daily?"checked":""} ${n.subscribed?"":"disabled"}><span>每日晚上 8 點提醒（可關閉）</span></label></div><div class="settings-buttons"><button class="button ${n.subscribed?"secondary":"primary"}" data-action="${n.subscribed?"notify-disable":"notify-enable"}">${n.subscribed?"關閉此裝置通知":"啟用手機通知"}</button></div><p class="small muted">目前瀏覽器權限：${esc(n.permission)}。iPhone／iPad 需先將網站加入主畫面，並從主畫面開啟後允許通知。</p>`:`<p class="callout">通知服務正在準備 Cloudflare Worker 與 Firebase 推播設定；完成部署後，這裡會出現啟用按鈕。每日提醒預設開啟，之後可在此關閉。</p>`}</section>`;}
function settingsPage(){return `${heading("目標、資料與分享，都由你決定。")}
  <div class="settings-grid"><section class="card"><div class="card-header"><div><div class="eyebrow">NEXT MILESTONE</div><h2>財務目標</h2></div></div><form id="goalForm" novalidate><label>目標金額（台幣）<input type="number" name="goal" min="1" step="any" value="${esc(s.settings.goal)}" required></label><label>目標日期<input type="date" name="targetDate" value="${esc(s.settings.targetDate)}" required></label><label>每月額外投入（台幣）<input type="number" name="monthly" min="0" step="any" value="${esc(s.settings.monthly)}" required></label><button class="button primary" type="submit">儲存目標</button></form></section>
  <section class="card"><div class="card-header"><div><div class="eyebrow">MARKET DATA</div><h2>美股報價設定</h2></div>${icon("lock")}</div><form id="keyForm"><label>你的 Finnhub API 金鑰<input type="password" name="key" value="${esc(s.settings.finnhubKey)}" autocomplete="off" placeholder="填入你自己的金鑰"></label><p class="callout">美股與朋友的美股估值使用這組金鑰。加密貨幣、台股與匯率使用各自的公開來源；報價時間與延遲依來源而定。金鑰保存在私人設定，不會分享。</p><button class="button secondary" type="submit">儲存金鑰</button></form></section>
  <section class="card"><div class="card-header"><div><div class="eyebrow">YOUR ACCOUNT</div><h2>帳號</h2></div>${badge(s.demo?"示範":"Google 登入")}</div><div class="account-row"><span class="avatar ${googlePhotoUrl(s.user?.photoURL)?"has-photo":""}">${avatarContent()}</span><div><h3>${esc(s.user?.displayName||"使用者")}</h3><p>${esc(s.user?.email||"")}</p></div></div><div class="settings-buttons"><button class="button secondary" data-action="logout">${icon("logout")}登出</button>${!s.demo&&cloud.isAdmin(s.user)?'<button id="adminToggle" class="button secondary" data-action="admin" aria-expanded="false" aria-controls="adminCard">管理使用者</button>':""}</div><section id="adminCard" class="admin-panel hidden" aria-live="polite"></section></section>
  <section class="card"><div class="card-header"><div><div class="eyebrow">KEEP A COPY</div><h2>資料備份</h2></div>${icon("download")}</div><p class="small muted">匯出持倉、策略、目標與歷史紀錄。JSON 可重新匯入；匯出不包含 API 金鑰與分享授權。</p><div class="settings-buttons" style="margin-top:20px"><button class="button secondary" data-action="export-json">JSON 備份</button><button class="button secondary" data-action="export-csv">CSV 持倉</button><button class="button secondary" data-action="import">匯入備份</button></div><input type="file" id="importFile" accept=".json,application/json" class="hidden"><p class="small muted" style="margin-top:18px">新版 ${VERSION} · 每日紀錄以 Asia/Taipei 為準</p></section>${installCard()}</div>`;}


function render(force=false){if(!s.user)return;$("breadcrumb").textContent="我的資產 / "+PAGES[s.page][0];$("localDate").textContent=taipeiDay();updateHeaderHtml($("userAvatar"),avatarContent());$("userAvatar").classList.toggle("has-photo",!!googlePhotoUrl(s.user.photoURL));updateHeaderHtml($("navigation"),Object.entries(PAGES).map(([key,[title]])=>`<button data-page="${key}" aria-label="${esc(title)}" class="${s.page===key?"active":""}" ${s.page===key?'aria-current="page"':""}>${icon(key)}<span>${key==="assets"?"持倉":key==="sharing"?"共享":key==="history"?"紀錄":title}</span></button>`).join(""));$("sidebarStatus").textContent=s.demo?"示範資料":"雲端同步";if(s.page==="settings"&&s.settingsDirty&&!force)return;const renders={home,assets:assetsPage,sharing,history:historyPage,settings:settingsPage};const openStrategies=new Set([...document.querySelectorAll("details[data-strategy-post][open]")].map(el=>participationKey(el.dataset.strategyOwner,el.dataset.strategyPost)));const openReads=new Set([...document.querySelectorAll("[data-read-details][open]")].map(el=>participationKey(el.dataset.owner,el.dataset.post)));const rendered=renders[s.page]();$("content").innerHTML=s.page==="settings"?rendered.replace(/<\/div>$/,notificationSettings()+"</div>"):rendered;for(const card of document.querySelectorAll("details[data-strategy-post]"))if(openStrategies.has(participationKey(card.dataset.strategyOwner,card.dataset.strategyPost)))card.open=true;for(const detail of document.querySelectorAll("[data-read-details]"))if(openReads.has(participationKey(detail.dataset.owner,detail.dataset.post)))detail.open=true;for(const [key,off] of [...s.participationUnsubs]){const open=[...document.querySelectorAll("details[data-strategy-post][open]")].some(el=>participationKey(el.dataset.strategyOwner,el.dataset.strategyPost)===key);if(!open){off();s.participationUnsubs.delete(key);}}for(const [key,off] of [...s.strategyReadUnsubs]){const open=[...document.querySelectorAll("details[data-strategy-post][open]")].some(el=>participationKey(el.dataset.strategyOwner,el.dataset.strategyPost)===key);if(!open){off();s.strategyReadUnsubs.delete(key);}}for(const card of document.querySelectorAll("details[data-strategy-post][open]")){subscribeParticipation(card.dataset.strategyOwner,card.dataset.strategyPost);subscribeStrategyReads(card.dataset.strategyOwner,card.dataset.strategyPost);}syncStrategyList();}
function syncSelection(){if(s.shareDirty)return;s.selected=(s.published.assets||[]).map(a=>a.id);s.portfolioViewers=[...(s.published.viewerUids||[])];s.strategyViewers=[...(s.strategyAccess.viewerUids||[])];}
async function setPage(page){if(!PAGES[page])return;if(s.settingsDirty&&page!=="settings"&&!await confirm("離開設定？","未儲存的表單內容會捨棄。","離開"))return;s.settingsDirty=false;s.dirtyForms.clear();strategyNotificationRoute++;s.notificationTarget=null;s.page=page;location.hash=page;render(true);window.scrollTo({top:0,behavior:"instant"});if(page==="sharing")await loadSharing();else void autoRefreshQuotes();}
function confirm(title,text,label="確認"){return new Promise(resolve=>{$("confirmTitle").textContent=title;$("confirmText").textContent=text;$("confirmAction").textContent=label;pendingConfirmation=resolve;$("confirmDialog").showModal();});}
$("confirmAction").onclick=()=>{const fn=pendingConfirmation;pendingConfirmation=null;$("confirmDialog").close();fn?.(true);};
$("confirmDialog").addEventListener("close",()=>{if(pendingConfirmation){pendingConfirmation(false);pendingConfirmation=null;}});

function stopSession(){strategyNotificationRoute++;s.notificationTarget=null;quoteRefreshJob=null;s.lastQuoteAttempt=0;s.lastQuoteSignature="";s.quoteRefreshError="";for(const off of s.participationUnsubs.values())off();s.participationUnsubs.clear();s.participation={};s.participationErrors={};s.strategyReadUnsubs.forEach(off=>off());s.strategyReadUnsubs.clear();s.strategyReads={};s.strategyReadErrors={};s.strategyListOff?.();s.strategyListOff=null;s.strategyListKey="";s.strategyListGeneration++;s.strategyListRevision=0;s.reviews={};s.reviewHistory={};s.reviewActor="author";s.session++;s.assets=[];s.history=[];s.settings={...DEFAULT_SETTINGS};s.published={assets:[],viewerUids:[]};s.strategyAccess={viewerUids:[]};s.friends=[];s.ownPosts=[];s.friendPosts=[];s.invites={sent:[],received:[]};s.friend="self";s.selected=[];s.portfolioViewers=[];s.strategyViewers=[];s.inviteEmail="";s.subscriptions.forEach(fn=>fn());s.subscriptions=[];s.user=null;s.historyArchivePage=0;s.historyArchiveOpen=false;s.refreshing=false;s.settingsDirty=false;s.dirtyForms.clear();s.adminUsers=[];s.shareDirty=false;for(const name of ["assetDialog","strategyDialog","confirmDialog"]){if($(name).open)$(name).close();}}
function showLogin(){stopSession();setLoginState("idle");$("appView").classList.add("hidden");$("pendingView").classList.add("hidden");$("loginView").classList.remove("hidden");}
function showApp(){setLoginState("idle");const initial=location.hash.slice(1).split("?")[0];s.page=PAGES[initial]?initial:"home";$("loginView").classList.add("hidden");$("pendingView").classList.add("hidden");$("appView").classList.remove("hidden");$("demoBanner").classList.toggle("hidden",!s.demo);render(true);}
async function startUser(user){if(s.demo)return;stopSession();if(!user){showLogin();return;}s.user=user;const session=s.session;setLoginState("loading");try{const status=await cloud.checkAccess(user);if(session!==s.session)return;if(status!=="approved"){setLoginState("idle");$("loginView").classList.add("hidden");$("appView").classList.add("hidden");$("pendingView").classList.remove("hidden");$("pendingMessage").textContent=status==="denied"?"你的使用申請已被拒絕，請聯絡擁有者。":"已送出使用申請。擁有者核准後，按重新檢查即可使用。";return;}const loaded=await cloud.loadUser(user);if(session!==s.session)return;Object.assign(s,loaded);const guard=fn=>(...args)=>{if(session===s.session)fn(...args);};s.lastRefresh=0;syncSelection();showApp();void notifications.appOpened();s.subscriptions=cloud.listenUser(user.uid,{assets:guard(assets=>{s.assets=assets;render();}),history:guard(history=>{s.history=history;render();}),settings:guard(settings=>{s.settings=settings;render();}),published:guard(value=>{s.published=value;syncSelection();render();}),strategyAccess:guard(value=>{s.strategyAccess=value;syncSelection();render();}),error:guard(e=>toast(message(e),true))});s.subscriptions.push(...cloud.listenFriends(user.uid,guard(friends=>{s.friends=mergeFriendQuotes(friends);if(s.friend!=="self"&&!friends.some(f=>f.id===s.friend)){s.friend="self";s.friendPosts=[];}else if(s.friend!=="self"&&!friends.find(f=>f.id===s.friend)?.strategyAccess){s.friendPosts=[];}render();void autoRefreshQuotes();}),guard(e=>toast(message(e),true))));s.subscriptions.push(...cloud.listenInvitations(user,guard(invites=>{s.invites=invites;if(s.page==="sharing")render();}),guard(e=>toast(message(e),true))));const notificationLink=parseStrategyNotification(location.hash);if(notificationLink)await openStrategyNotification(notificationLink);if(session!==s.session)return;await refreshOwn(false,true);if(session===s.session)await saveSnapshot(false);if(s.page==="sharing")await loadSharing();}catch(e){if(session!==s.session)return;setLoginState("error",message(e));$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");}}
async function initFirebase(){setLoginState("connecting");let connectionTimer;try{await Promise.race([cloud.connect(),new Promise((_,reject)=>{connectionTimer=setTimeout(()=>reject(new Error("連線逾時，請重新嘗試或先看示範版。")),15000);})]);firebaseReady=true;authUnsubscribe?.();authUnsubscribe=cloud.watchAuth(startUser);}catch(e){setLoginState("error",message(e));}finally{clearTimeout(connectionTimer);}}
$("loginButton").onclick=beginLogin;
$("demoButton").onclick=()=>startDemo();

function demoData(){const now=new Date().toISOString(),fx=32.1;const asset=(name,mode,symbol,qty,costPer,price,costFx=32.4)=>({id:id(),name,mode,symbol,qty,costPer,costFx,type:TYPES[mode],quote:{nativePrice:price,fx:mode==="tw"?1:fx,currency:mode==="tw"?"TWD":"USD",source:"示範行情",priceAt:now,fetchedAt:now,fxAt:now,lastAttemptAt:now,error:""},updatedAt:now});const assets=[asset("Apple","stock","AAPL",28,175,194.6),asset("Bitcoin","crypto","BTC",.18,65000,72000),asset("元大台灣50","tw","0050",1200,48,52.4,null),asset("Ethereum","crypto","ETH",3.5,2600,2950),asset("美元現金","usd",null,4500,4500,1),{id:id(),name:"生活備用金",mode:"manual",type:"現金",value:180000,cost:180000,updatedAt:now},{id:id(),name:"過往已實現損益（示範）",mode:"manual",type:"歷史已實現損益",value:0,cost:null,recordKind:"realized",realizedPnl:-500000,updatedAt:now}];const total=portfolio(assets).total;const history=Array.from({length:14},(_,i)=>({date:taipeiDay(new Date(Date.now()-(13-i)*86400000)),total:Math.round(total*(.84+i*.012+Math.sin(i*1.5)*.018))}));history.at(-1).total=total;const friends=[{id:"demo-friend",ownerName:"柏宇",assets:[asset("Vanguard 全市場 ETF","stock","VTI",32,230,285),asset("Solana","crypto","SOL",12,165,148)],updatedAt:now,portfolioAccess:true,strategyAccess:true}];const post={id:id(),title:"分批累積指數 ETF",symbol:"0050",term:"long",thesis:"以分散持有與固定投入，建立長期部位。\n每次投入維持相近金額，定期檢視資產配置。",entry:"每月固定投入，保留生活備用金。",invalidation:"現金需求改變，或原本的資產配置不再適合。",target:"持有三年以上，每季檢視一次。",status:"active",published:true,createdAt:now,updatedAt:now};friends[0].demoPosts=[{...post,id:id(),symbol:"VTI",title:"維持核心部位，定期再平衡"}];return {assets,history,friends,ownPosts:[post,{...post,id:id(),title:"等待區間突破後的回測",symbol:"BTC",term:"short",thesis:"先觀察成交量與價格反應，確認條件再執行。",entry:"突破區間後回測不破，且出現向上的量價延續。",invalidation:"重新跌回原區間，或回測時賣壓擴大。",target:"依執行時的風險報酬設定，不預先追價。",status:"watching",published:false}],friendPosts:[{...post,id:id(),symbol:"VTI",title:"維持核心部位，定期再平衡"}],settings:{...DEFAULT_SETTINGS,goal:3000000,monthly:15000,finnhubKey:""},published:{ownerName:"小陽",assets:assets.slice(0,3).map(sharedAsset),viewerUids:["demo-friend"],updatedAt:now},strategyAccess:{viewerUids:["demo-friend"]},invites:{sent:[{id:"demo-invite",ownerUid:"demo-self",recipientEmail:"boyu@example.com",viewerUid:"demo-friend",status:"accepted"}],received:[]}};}
function startDemo(){stopSession();s.search="";s.filter="all";s.sort="value";s.demo=true;s.user={uid:"demo-self",displayName:"小陽",email:"demo@example.com",emailVerified:true};Object.assign(s,demoData());s.shareDirty=false;s.settingsDirty=false;s.friend="self";s.sharingTab="portfolios";s.lastRefresh=0;syncSelection();showApp();}

let quoteRefreshJob=null;
function quoteAssetSignature(assets){return assets.filter(a=>a.mode!=="manual").map(a=>JSON.stringify([a.id,a.mode,a.symbol])).sort().join("|");}
function quotePageVisible(){return s.page==="home"||s.page==="assets"||s.page==="sharing"&&s.sharingTab==="portfolios";}
function quoteFormActive(){return !!document.querySelector?.("dialog[open]")||!!document.activeElement?.matches("input,textarea,select");}
function renderQuoteState(){if(quotePageVisible()&&!quoteFormActive()&&!s.shareDirty)render();}
function quoteTarget(target){
  if(target==="self")return {target,state:s,assets:s.assets};
  const friend=s.friends.find(f=>f.id===target&&f.portfolioAccess);
  return friend?{target,state:friend,assets:friend.assets||[]}:null;
}
function mergeFriendQuotes(friends){
  return friends.map(friend=>{
    const previous=s.friends.find(f=>f.id===friend.id);
    if(!previous||!friend.portfolioAccess)return friend;
    const old=new Map((previous.assets||[]).map(a=>[a.id,a]));
    const assets=(friend.assets||[]).map(asset=>{
      const cached=old.get(asset.id);
      if(!cached||cached.mode!==asset.mode||cached.symbol!==asset.symbol)return asset;
      const local=Date.parse(cached.quote?.fetchedAt)||0,remote=Date.parse(asset.quote?.fetchedAt)||0;
      return local>remote?{...asset,quote:cached.quote}:asset;
    });
    return {...friend,assets,lastQuoteAttempt:previous.lastQuoteAttempt,lastQuoteSignature:previous.lastQuoteSignature,lastRefresh:previous.lastRefresh,localRefreshed:previous.localRefreshed,quoteRefreshError:previous.quoteRefreshError};
  });
}
function requestQuoteRefresh(target,notify=true,quiet=false){
  if(!s.user||!quoteTarget(target))return Promise.resolve();
  let job=quoteRefreshJob;
  if(!job||job.session!==s.session){job={session:s.session,queue:new Map(),active:new Map(),promise:null};quoteRefreshJob=job;}
  const active=job.active.get(target),signature=quoteAssetSignature(quoteTarget(target).assets);
  const entry=job.queue.get(target)||(active?.signature===signature?active:null);
  if(entry){entry.notify=entry.notify||notify;entry.quiet=entry.quiet&&quiet;}
  else job.queue.set(target,{target,notify,quiet});
  if(!job.promise){s.refreshing=true;renderQuoteState();job.promise=Promise.resolve().then(()=>drainQuoteRefresh(job));}
  return job.promise;
}
async function drainQuoteRefresh(job){
  const failures=[];
  try{
    while(job.queue.size&&job.session===s.session){
      const entries=[...job.queue.values()];job.queue.clear();job.active=new Map(entries.map(entry=>[entry.target,entry]));
      const targets=entries.map(entry=>{const target=quoteTarget(entry.target);return target?{...target,entry}:null;}).filter(Boolean);
      const now=new Date(),attemptAt=now.toISOString(),lookups=new Map(),assets=[];
      for(const [index,target] of targets.entries()){
        target.entry.signature=quoteAssetSignature(target.assets);target.state.lastQuoteSignature=target.entry.signature;target.state.lastQuoteAttempt=Date.now();
        for(const asset of target.assets){const key=index+":"+asset.id;lookups.set(key,{target:target.target,id:asset.id});assets.push({...asset,id:key});}
      }
      if(!targets.length)continue;
      if(s.demo){
        for(const target of targets){const current=quoteTarget(target.target);if(!current)continue;current.state.assets=current.assets.map(a=>a.mode==="manual"?a:{...a,quote:{...a.quote,fetchedAt:attemptAt,priceAt:attemptAt,error:""}});current.state.lastRefresh=now.getTime();current.state.quoteRefreshError="";if(target.target!=="self")current.state.localRefreshed=attemptAt;}
        if(entries.some(entry=>entry.notify))toast("示範行情已更新；金額不是即時報價。");
        continue;
      }
      let result;
      try{result=await refreshMarket(assets,s.settings.finnhubKey,{now});}
      catch(error){if(job.session!==s.session)return;for(const target of targets){const current=quoteTarget(target.target);if(current)current.state.quoteRefreshError=message(error);}failures.push(error);continue;}
      if(job.session!==s.session)return;
      for(const target of targets){
        let current=quoteTarget(target.target);if(!current)continue;
        let updates=result.updates.filter(update=>lookups.get(update.id)?.target===target.target).map(update=>({...update,id:lookups.get(update.id).id}));
        try{
          if(target.target==="self")updates=await cloud.saveQuotes(s.user.uid,updates,result.fx);
          if(job.session!==s.session)return;
          current=quoteTarget(target.target);if(!current)continue;
          const map=new Map(updates.map(update=>[update.id,update]));
          current.state.assets=current.assets.map(asset=>{const update=map.get(asset.id);return update&&asset.mode===update.mode&&asset.symbol===update.symbol?{...asset,quote:update.quote}:asset;});
          const errors=[...new Set(updates.map(update=>update.quote?.error).filter(Boolean))];
          current.state.quoteRefreshError=errors.length?"部分行情未更新："+errors.join("；"):"";
          if(updates.some(update=>update.quote?.fetchedAt===attemptAt&&!update.quote?.error)){current.state.lastRefresh=now.getTime();if(target.target!=="self")current.state.localRefreshed=attemptAt;}
        }catch(error){if(job.session!==s.session)return;const latest=quoteTarget(target.target);if(latest)latest.state.quoteRefreshError=message(error);failures.push(error);}
      }
      if(entries.some(entry=>entry.notify||!entry.quiet)&&result.issues.length)toast(result.issues.join("\n"),true);
      else if(entries.some(entry=>entry.notify))toast("已更新可取得的行情。");
    }
    if(failures.length)throw failures[0];
  }finally{if(quoteRefreshJob===job&&job.session===s.session){quoteRefreshJob=null;s.refreshing=false;renderQuoteState();}}
}
function refreshOwn(notify=true,quiet=false){return requestQuoteRefresh("self",notify,quiet);}
function refreshFriend(notify=true,quiet=false){return requestQuoteRefresh(s.friend,notify,quiet);}
async function autoRefreshQuotes(){
  if(!s.user||s.demo||document.visibilityState!=="visible"||!quotePageVisible()||quoteFormActive()||s.shareDirty)return;
  const targets=["self"];
  if(s.page==="sharing"&&s.sharingTab==="portfolios"&&s.friend!=="self")targets.unshift(s.friend);
  const jobs=[];
  for(const name of targets){const target=quoteTarget(name);if(!target||!target.assets.some(a=>a.mode!=="manual"))continue;const fresh=target.state.lastQuoteSignature===quoteAssetSignature(target.assets)&&Date.now()-(target.state.lastQuoteAttempt||0)<AUTO_QUOTE_INTERVAL;if(!fresh)jobs.push(requestQuoteRefresh(name,false,true));}
  try{await Promise.all(jobs);}catch{/* Each target keeps the failure reason and last successful quote. */}
}

async function saveSnapshot(overwrite=true){if(!s.assets.length)return;const date=taipeiDay(),total=portfolio(s.assets).total;if(s.demo){const previous=s.history.find(h=>h.date===date);if(previous){if(overwrite)previous.total=total;}else s.history.push({date,total});s.history.sort((a,b)=>a.date.localeCompare(b.date));}else await cloud.snapshot(s.user.uid,date,total,overwrite);if(overwrite)toast("已記錄台灣今天的資產。");render();}

function openAsset(assetId=null){editingAsset=assetId?s.assets.find(a=>a.id===assetId):null;const f=$("assetForm");f.reset();f.elements.mode.value=editingAsset?.mode||"stock";f.elements.manualKind.value=editingAsset&&isRealized(editingAsset)?"realized":"asset";for(const name of ["name","symbol","qty","value","cost","costPer","costFx","type","realizedPnl"]){if(editingAsset?.[name]!=null)f.elements[name].value=editingAsset[name];}f.elements.summary.value=editingAsset?.isSummary?"yes":"no";$("assetDialogTitle").textContent=editingAsset?"編輯持倉":"新增持倉";$("assetError").textContent="";setAssetMode();$("assetDialog").showModal();}
function setAssetMode(){
  const form=$("assetForm"),mode=form.elements.mode.value,manual=mode==="manual",usd=mode==="usd",tw=mode==="tw",realized=manual&&form.elements.manualKind.value==="realized";
  form.classList.toggle("history-record",realized);
  for(const [name,hide] of [["manualKindField",!manual],["realizedPnlField",!realized],["symbolField",manual||usd],["quantityField",manual],["valueField",!manual||realized],["nativeCostField",manual],["manualCostField",!manual||realized],["costFxField",manual||tw],["typeField",!manual||realized],["summaryField",!usd]])$(name).classList.toggle("hidden",hide);
  $("quantityLabel").textContent=usd?"目前美元金額":mode==="crypto"?"持有數量":"持有股數";
  $("nativeCostLabel").textContent=usd?"本金（美元總額）":tw?"平均買入價（台幣／股）":mode==="crypto"?"平均買入價（USD／顆）":"平均買入價（USD／股）";
  const hints={stock:"美股需在設定填入 Finnhub 金鑰。買入匯率留空時，損益只反映美元價差。",crypto:"常見幣種可填 BTC、ETH 等代號。代號有重複時，改填 CoinGecko ID。",tw:"台股與 ETF 使用收盤價，並非盤中即時行情。",usd:"已列出個股時，請只把美元現金計入總資產；帳戶總值可設為參考。",manual:"輸入台幣現值；本金選填，未填不會把損益當成零。"};
  $("assetModeHint").textContent=realized?"紀錄 App 建立前或已結束交易的損益。虧損填負數（50 萬填 -500000），獲利填正數；只影響累計損益，不會再次扣除總資產。已記在其他紀錄的損益請勿重複填入。":hints[mode]+" 成本填 0 代表零成本；留空表示尚未設定。";
  $("assetDialogTitle").textContent=(editingAsset?"編輯":"新增")+(realized?"歷史損益":"持倉");
  form.querySelector('[type="submit"]').textContent=realized?"儲存損益":"儲存持倉";
}
$("assetForm").elements.mode.onchange=setAssetMode;
$("assetForm").elements.manualKind.onchange=setAssetMode;
$("assetForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;task(f.querySelector('[type="submit"]'),async()=>{const session=s.session;const fields=Object.fromEntries(new FormData(f));fields.isSummary=fields.summary==="yes";let a=parseAsset(fields,editingAsset);if(!s.demo)a=await cloud.saveAsset(s.user.uid,a,editingAsset?(editingAsset.updatedAt??null):undefined);if(session!==s.session)return;const index=s.assets.findIndex(x=>x.id===a.id);if(index>=0)s.assets[index]=a;else s.assets.push(a);if(s.demo&&s.published.assets.some(x=>x.id===a.id))s.published.assets=s.published.assets.map(x=>x.id===a.id?sharedAsset(a):x);$("assetDialog").close();render(true);toast(isRealized(a)?"歷史損益已儲存；總資產不受影響。":"持倉已儲存。");if(a.mode!=="manual"){s.lastRefresh=0;await refreshOwn(false);}},$("assetError"));};
function strategyAudienceEditor(post){
  const candidates=s.strategyAccess.viewerUids||[],selected=Array.isArray(post?.audienceUids)?post.audienceUids:candidates;
  return `<details class="strategy-audience"><summary><span>這份策略分享給誰</span><span class="small muted" id="strategyAudienceCount">已選 ${candidates.filter(uid=>selected.includes(uid)).length} 位</span></summary><p class="small muted">只有勾選的朋友能查看並收到策略通知；未勾選者不會收到。</p><div class="strategy-audience-options">${candidates.length?candidates.map(uid=>{const profile=strategyRecipient(uid,s.user.uid);return `<label class="checkbox-row"><input type="checkbox" data-strategy-recipient value="${esc(uid)}" ${selected.includes(uid)?"checked":""}><span>${esc(profile.displayName)}</span></label>`;}).join(""):'<p class="small muted">目前沒有策略授權成員。可先存私人草稿，再到「持倉共享」設定分享對象。</p>'}</div></details>`;
}
function openStrategy(postId=null){editingPost=postId?s.ownPosts.find(p=>p.id===postId):null;const f=$("strategyForm");f.reset();f.elements.term.value=s.sharingTab==="short"?"short":"long";for(const name of ["title","symbol","term","thesis","entry","invalidation","target","status"]){if(editingPost?.[name]!=null)f.elements[name].value=editingPost[name];}f.elements.published.checked=editingPost?.published||false;$("strategyAudienceEditor").innerHTML=strategyAudienceEditor(editingPost);$("strategyDialogTitle").textContent=editingPost?"編輯交易策略":"新增交易策略";$("strategyError").textContent="";$("strategyDialog").showModal();}
$("strategyForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;task(f.querySelector('[type="submit"]'),async()=>{
  const session=s.session;const data=Object.fromEntries(new FormData(f));for(const key of ["title","symbol","thesis"]){if(!data[key]?.trim())throw new Error("請填策略名稱、標的與交易理由。");}
  const audienceUids=[...f.querySelectorAll("[data-strategy-recipient]:checked")].map(input=>input.value);
  if(f.elements.published.checked&&!audienceUids.length)throw new Error("請至少選擇一位策略分享對象，或取消分享勾選以儲存私人草稿。");
  const now=new Date().toISOString();let post={id:editingPost?.id||id(),ownerUid:s.user.uid,ownerName:s.user.displayName,title:data.title.trim(),symbol:data.symbol.trim().toUpperCase(),term:data.term,thesis:data.thesis.trim(),entry:data.entry.trim(),invalidation:data.invalidation.trim(),target:data.target.trim(),status:data.status,published:f.elements.published.checked,audienceUids,viewerUids:f.elements.published.checked?audienceUids:[],createdAt:editingPost?.createdAt||now,updatedAt:now};
  if(!s.demo)post=await cloud.saveStrategy(s.user.uid,post,editingPost?.updatedAt);
  if(session!==s.session)return;
  const index=s.ownPosts.findIndex(p=>p.id===post.id);if(index>=0)s.ownPosts[index]=post;else s.ownPosts.push(post);
  s.sharingTab=post.term;$("strategyDialog").close();render(true);toast(post.published?"策略已儲存並分享給勾選的朋友。":"已儲存私人草稿。");
  if(!s.demo&&post.published){try{const delivery=await notifications.strategyPublished(post);if(session!==s.session)return;if(delivery?.reason==="no-enabled-devices")toast("策略已分享；勾選的朋友尚未啟用策略通知。");}catch(error){if(session===s.session)toast("策略已儲存，但通知傳送失敗："+message(error),true);}}
},$("strategyError"));};

async function loadSharingOriginal(){
  if(s.demo){const friend=s.friends.find(f=>f.id===s.friend);s.friendPosts=friend?.demoPosts||[];render();return;}
  if(!s.strategyListOff)s.strategyListKey="";
  const session=s.session,revision=s.strategyListRevision;
  const [invites,posts]=await Promise.all([cloud.invitations(s.user),cloud.strategies(s.user.uid,true)]);
  if(session!==s.session)return;s.invites=invites;if(revision===s.strategyListRevision)s.ownPosts=posts;
  const friend=s.friends.find(f=>f.id===s.friend),friendId=s.friend,friendRevision=s.strategyListRevision;
  const friendPosts=friend?.strategyAccess?await cloud.strategies(friend.id):[];
  if(session===s.session&&s.friend===friendId){if(friendRevision===s.strategyListRevision)s.friendPosts=friendPosts;render();}
}
async function setParticipation(button){
  const session=s.session,user=s.user,ownerUid=button.dataset.owner,postId=button.dataset.id,choice=button.dataset.choice,key=participationKey(ownerUid,postId);
  if(!user)return;
  if(!["participating","not-participating"].includes(choice))throw new Error("參與狀態無效。");
  const posts=ownerUid===user.uid?s.ownPosts:s.friendPosts,post=posts.find(p=>p.id===postId);
  if(!post)throw new Error("策略已更新，請重新整理。");
  let entry={uid:user.uid,choice,displayName:user.displayName||"使用者",photoURL:user.photoURL||"",updatedAt:new Date().toISOString(),strategyUpdatedAt:post.updatedAt};
  if(!s.demo){
    let saved;try{saved=await cloud.saveStrategyParticipation(user,ownerUid,postId,choice,post.updatedAt);}catch(error){if(session!==s.session||s.user?.uid!==user.uid)return;throw error;}
    if(session!==s.session||s.user?.uid!==user.uid)return;
    entry=saved.entry;
    const current=ownerUid===user.uid?s.ownPosts:s.friend===ownerUid?s.friendPosts:[],index=current.findIndex(p=>p.id===postId);
    if(index>=0&&current[index].updatedAt===post.updatedAt)current[index]=saved.post;
  }
  s.participation[key]=[...(s.participation[key]||[]).filter(x=>x.uid!==user.uid),entry];
  delete s.participationErrors[key];
  if(s.page!=="sharing"||(s.friend==="self"?user.uid:s.friend)!==ownerUid)return;
  render();
  const card=[...document.querySelectorAll("details[data-strategy-post]")].find(el=>el.dataset.strategyOwner===ownerUid&&el.dataset.strategyPost===postId);if(card)card.open=true;
}
async function publish(){if(s.selected.length>100)throw new Error("每次最多分享 100 筆持倉。");const updatedAt=new Date().toISOString();if(s.demo){s.published={ownerName:s.user.displayName,assets:s.assets.filter(a=>s.selected.includes(a.id)).map(sharedAsset),viewerUids:[...s.portfolioViewers],updatedAt};s.strategyAccess={...s.strategyAccess,viewerUids:[...s.strategyViewers],updatedAt};}else{await cloud.publish(s.user.uid,s.user.displayName||"使用者",s.selected,s.portfolioViewers,s.strategyViewers);s.published={...s.published,ownerName:s.user.displayName||"使用者",assets:s.assets.filter(a=>s.selected.includes(a.id)).map(sharedAsset),viewerUids:[...s.portfolioViewers],updatedAt};s.strategyAccess={...s.strategyAccess,viewerUids:[...s.strategyViewers],updatedAt};}s.shareDirty=false;toast("分享設定已儲存。");render(true);}
function renderAdminUsers(card,users,searchValue=null){
  const filter=card.dataset.statusFilter||"pending",query=searchValue??card.querySelector?.("#adminSearch")?.value??"",normalized=query.trim().toLocaleLowerCase();
  const counts={pending:0,approved:0,denied:0};for(const user of users)if(counts[user.status]!==undefined)counts[user.status]++;
  const labels={pending:"待核准",approved:"已核准",denied:"已拒絕"},visible=users.filter(user=>user.status===filter&&(!normalized||String(user.name||"").toLocaleLowerCase().includes(normalized)||String(user.email||"").toLocaleLowerCase().includes(normalized)));
  const rows=visible.map(user=>{
    const actions=user.status==="pending"?'<button class="button primary" data-action="approve" data-id="'+esc(user.id)+'">核准</button><button class="button danger" data-action="deny" data-id="'+esc(user.id)+'">拒絕</button>':user.status==="approved"?'<button class="button danger" data-action="deny" data-id="'+esc(user.id)+'">撤銷授權</button>':'<button class="button secondary" data-action="approve" data-id="'+esc(user.id)+'">重新核准</button>';
    return '<div class="admin-row"><div class="admin-user"><strong>'+esc(user.name||"使用者")+'</strong>'+badge(labels[user.status]||user.status)+'<div class="small muted">'+esc(user.email)+'</div></div><div class="admin-actions">'+actions+'</div></div>';
  }).join("");
  const search=normalized?'沒有符合的使用者。':filter==="pending"?"目前沒有待核准申請。":filter==="approved"?"目前沒有已核准使用者。":"目前沒有已拒絕申請。";
  card.innerHTML='<div class="admin-heading"><h3>使用者授權</h3><span class="small muted">App 使用資格，與分享權限分開</span></div><div class="admin-filters" role="tablist" aria-label="使用者狀態">'+Object.entries(labels).map(([key,label])=>'<button type="button" class="admin-filter '+(filter===key?"active":"")+'" role="tab" aria-selected="'+(filter===key)+'" data-action="admin-filter" data-status="'+key+'">'+label+'<span>'+counts[key]+'</span></button>').join("")+'</div><label class="admin-search"><span class="sr-only">搜尋使用者</span><input id="adminSearch" type="search" value="'+esc(query)+'" placeholder="搜尋姓名或 Google 帳號" autocomplete="off"></label><div class="admin-list" role="tabpanel">'+(rows||'<p class="small muted admin-empty">'+search+'</p>')+'</div>';
}
async function admin(button=null,reload=false){
  const card=$("adminCard");if(!card)return;
  const trigger=button?.dataset.action==="admin"?button:null,opened=trigger?trigger.getAttribute("aria-expanded")==="true":!card.classList.contains("hidden");
  if(!reload&&opened){card.classList.add("hidden");trigger?.setAttribute("aria-expanded","false");if(trigger)trigger.textContent="管理使用者";return;}
  card.classList.remove("hidden");trigger?.setAttribute("aria-expanded","true");if(trigger)trigger.textContent="收合名單";
  if(!reload&&card.dataset.loaded==="true"){renderAdminUsers(card,s.adminUsers||[]);return;}
  if(adminRequest)return adminRequest;
  const request=(async()=>{
    card.innerHTML='<p class="small muted admin-loading" role="status">正在載入使用者名單…</p>';
    try{const users=s.demo?[]:await cloud.adminUsers();const current=$("adminCard");if(!current)return;s.adminUsers=users;if(!current.dataset.statusFilter)current.dataset.statusFilter="pending";renderAdminUsers(current,users);current.dataset.loaded="true";}
    catch(error){const current=$("adminCard");if(current)current.innerHTML='<p class="small muted" role="alert">載入失敗：'+esc(error?.message||"請稍後重試")+'</p><button class="button secondary" data-action="admin-reload">重新載入</button>';toast(message(error),true);}
    finally{adminRequest=null;}
  })();adminRequest=request;return request;
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportJson(){const session=s.session;if(!s.demo){const posts=await cloud.strategies(s.user.uid,true);if(session!==s.session)return;s.ownPosts=posts;}download("wealth-backup-"+taipeiDay()+".json",JSON.stringify(buildBackup(s),null,2),"application/json");toast("已匯出備份，不含金鑰與分享授權。");}
function exportCsv(){const cell=value=>'"'+String(value??"").replace(/"/g,'""')+'"';const rows=[["名稱","類別","代號","數量","台幣市值","台幣損益","損益百分比","計算口徑","行情時間","參考值","紀錄類型","歷史已實現損益（台幣）"]];for(const a of s.assets){const v=valuation(a);rows.push([a.name,TYPES[a.mode],a.symbol,a.qty,v.value,v.pnl,v.percent,v.kind,a.quote?.priceAt||a.quote?.fetchedAt,a.isSummary?"是":"否",isRealized(a)?"歷史已實現損益":"持倉",isRealized(a)?a.realizedPnl:""]);}download("wealth-holdings-"+taipeiDay()+".csv","\ufeff"+rows.map(row=>row.map(cell).join(",")).join("\r\n"),"text/csv;charset=utf-8");}
async function importFile(file){const session=s.session,user=s.user,demo=s.demo;if(file.size>2*1024*1024)throw new Error("備份檔案超過 2 MB，請先確認內容。");const data=parseBackup(JSON.parse(await file.text()));if(session!==s.session)return;const {assets,history,settings,strategies}=data;if(!await confirm("匯入備份？",`將新增 ${assets.length} 筆持倉、${strategies.length} 份私人策略草稿，並補上尚未存在的日期。${settings?"財務目標會改用備份設定。":""}請避免匯入重複持倉。`,"匯入"))return;if(session!==s.session)return;for(const a of assets){if(!demo)await cloud.saveAsset(user.uid,a);if(session!==s.session)return;s.assets.push(a);}for(const h of history){if(s.history.some(x=>x.date===h.date))continue;if(!demo)await cloud.snapshot(user.uid,h.date,h.total,false);if(session!==s.session)return;s.history.push(h);}for(const draft of strategies){const post={...draft,ownerUid:user.uid,ownerName:user.displayName||"使用者"};if(!demo)await cloud.saveStrategy(user.uid,post);if(session!==s.session)return;s.ownPosts.push(post);}if(settings){if(!demo)await cloud.saveSettings(user.uid,settings);if(session!==s.session)return;s.settings={...s.settings,...settings};}s.history.sort((a,b)=>a.date.localeCompare(b.date));render(true);toast("備份已匯入；還原策略為私人草稿，分享設定由你選擇。");}

document.addEventListener("click",async e=>{const button=e.target.closest("button");if(!button)return;if(button.dataset.close){$(button.dataset.close).close();return;}if(button.dataset.page){await task(null,()=>setPage(button.dataset.page));return;}if(button.dataset.tab){strategyNotificationRoute++;s.notificationTarget=null;s.sharingTab=button.dataset.tab;render(true);void autoRefreshQuotes();return;}const action=button.dataset.action;if(!action)return;await task(button,async()=>{
  if(action==="participation")return setParticipation(button);
  if(action==="strategy-read")return markStrategyRead(button);
  if(action?.startsWith("review-"))return handleReviewAction(action,button);
  if(action==="account")return setPage("settings");
  if(action==="history-previous"||action==="history-next")return changeHistoryPage(action==="history-next"?1:-1);
  if(action==="asset-display"){s.assetDisplayMode=button.dataset.mode;s.expandedAssetGroups.clear();render();return;}if(action==="toggle-asset-group"){const key=button.dataset.key;s.expandedAssetGroups.has(key)?s.expandedAssetGroups.delete(key):s.expandedAssetGroups.add(key);render();return;}if(action==="add-asset")return openAsset();if(action==="edit-asset")return openAsset(button.dataset.id);
  if(action==="delete-asset"){const a=s.assets.find(a=>a.id===button.dataset.id);if(!await confirm("刪除這個持倉？",`「${a.name}」也會從已分享的持倉移除。`,"刪除"))return;if(!s.demo)await cloud.deleteAsset(s.user.uid,a.id);s.assets=s.assets.filter(x=>x.id!==a.id);s.published.assets=s.published.assets.filter(x=>x.id!==a.id);s.selected=s.selected.filter(x=>x!==a.id);render(true);return toast("已刪除持倉。");}
  if(action==="notify-enable"){await notifications.enableNotifications();render(true);return toast("此裝置已啟用通知。每日提醒與策略通知可在設定調整。");}if(action==="notify-disable"){await notifications.disableNotifications();render(true);return toast("此裝置的通知已關閉。");}if(action==="refresh")return refreshOwn();if(action==="refresh-friend")return refreshFriend();if(action==="snapshot")return saveSnapshot();
  if(action==="add-strategy")return openStrategy();if(action==="edit-strategy")return openStrategy(button.dataset.id);
  if(action==="delete-strategy"){if(!await confirm("刪除策略？","策略將從草稿與朋友的共享頁移除。","刪除"))return;if(!s.demo)await cloud.deleteStrategy(s.user.uid,button.dataset.id);s.ownPosts=s.ownPosts.filter(p=>p.id!==button.dataset.id);render(true);return toast("策略已刪除。");}
  if(action==="publish")return publish();if(action==="reload-sharing")return loadSharing();
  if(action==="accept-invite"){const inviteId=button.dataset.id;if(!s.demo)await cloud.acceptInvite(s.user,inviteId);s.invites.received=s.invites.received.filter(i=>i.id!==inviteId);render(true);toast("邀請已接受。");return;}
  if(action==="cancel-invite"){if(!s.demo)await cloud.removeInvite(button.dataset.id);else s.invites.sent=s.invites.sent.filter(x=>x.id!==button.dataset.id);return loadSharing();}
  if(action==="admin"){admin(button);return;}if(action==="admin-filter"){const card=$("adminCard");card.dataset.statusFilter=button.dataset.status;renderAdminUsers(card,s.adminUsers||[]);return;}if(action==="admin-reload"){admin(null,true);return;}if(action==="approve"||action==="deny"){await cloud.setAccess(button.dataset.id,action==="approve"?"approved":"denied");return admin(button,true);}
  if(action==="export-json")return exportJson();if(action==="export-csv")return exportCsv();if(action==="import")return $("importFile").click();
  if(action==="recheck")return startUser(s.user);
  if(action==="logout"||action==="exit-demo"){const demo=s.demo;s.demo=false;showLogin();if(!demo)await cloud.logout();else if(!firebaseReady)await initFirebase();return;}
});});
document.addEventListener("toggle",e=>{if(e.target.id==="olderHistory"&&e.target.isConnected)s.historyArchiveOpen=e.target.open;const card=e.target.closest?.("details[data-strategy-post]");if(card&&card.isConnected){if(card.open){subscribeParticipation(card.dataset.strategyOwner,card.dataset.strategyPost);subscribeStrategyReads(card.dataset.strategyOwner,card.dataset.strategyPost);}else{if(s.notificationTarget?.ownerUid===card.dataset.strategyOwner&&s.notificationTarget?.postId===card.dataset.strategyPost)s.notificationTarget=null;stopParticipation(card.dataset.strategyOwner,card.dataset.strategyPost);stopStrategyReads(card.dataset.strategyOwner,card.dataset.strategyPost);}}},true);
document.addEventListener("input",e=>{if(e.target.id==="adminSearch"){const card=$("adminCard"),caret=e.target.selectionStart;renderAdminUsers(card,s.adminUsers||[],e.target.value);const input=card.querySelector?.("#adminSearch");input?.focus();if(input&&caret!=null)input.setSelectionRange(caret,caret);}if(e.target.id==="assetSearch"){s.search=e.target.value;$("assetRows").innerHTML=assetRows(filteredAssets());}const dirtyForm=e.target.closest("#goalForm,#keyForm");if(dirtyForm){s.dirtyForms.add(dirtyForm.id);s.settingsDirty=true;}if(e.target.closest("#inviteForm"))s.inviteEmail=e.target.value;});
document.addEventListener("change",e=>{const el=e.target;if(el.matches?.("[data-strategy-recipient]")){const count=$("strategyForm").querySelectorAll("[data-strategy-recipient]:checked").length;$("strategyAudienceCount").textContent="已選 "+count+" 位";}for(const [key,target] of [["shareAsset","selected"],["portfolioViewer","portfolioViewers"],["strategyViewer","strategyViewers"]])if(el.dataset[key]){const value=el.dataset[key];s[target]=el.checked?[...new Set([...s[target],value])]:s[target].filter(x=>x!==value);s.shareDirty=true;}if(el.id==="sharedAssetFilter"){s.sharedFilter=el.value;refreshSharedRows();}if(el.id==="sharedAssetSort"){s.sharedSort=el.value;refreshSharedRows();}if(el.id==="assetFilter"){s.filter=el.value;$("assetRows").innerHTML=assetRows(filteredAssets());}if(el.id==="assetSort"){s.sort=el.value;$("assetRows").innerHTML=assetRows(filteredAssets());}if(el.dataset.notificationPref){const inputs=[...document.querySelectorAll("[data-notification-pref]")];const strategy=inputs.find(x=>x.dataset.notificationPref==="strategy")?.checked,daily=inputs.find(x=>x.dataset.notificationPref==="daily")?.checked;task(null,async()=>{await notifications.updateNotificationPreferences(strategy,daily);toast("通知偏好已儲存。");},null).catch(e=>toast(message(e),true));}if(el.id==="friendSelect"){strategyNotificationRoute++;s.notificationTarget=null;s.sharedFilter="all";s.sharedSort="value";s.friend=el.value;s.friendPosts=[];render(true);task(null,()=>loadSharing());}if(el.id==="importFile"&&el.files[0])task(null,()=>importFile(el.files[0]));});
document.addEventListener("submit",e=>{const form=e.target;if(["assetForm","strategyForm"].includes(form.id))return;if(!["goalForm","keyForm","inviteForm"].includes(form.id))return;e.preventDefault();task(form.querySelector('[type="submit"]'),async()=>{const fields=Object.fromEntries(new FormData(form));if(form.id==="goalForm"){const goal=Number(fields.goal),monthly=Number(fields.monthly);if(!fields.goal||!finite(goal)||goal<=0||!fields.monthly||!finite(monthly)||monthly<0||!/^\d{4}-\d{2}-\d{2}$/.test(fields.targetDate)||!finite(new Date(fields.targetDate).getTime()))throw new Error("請填有效的目標金額、日期與非負投入金額。");const settings={...s.settings,goal,monthly,targetDate:fields.targetDate};if(!s.demo)await cloud.saveSettings(s.user.uid,{goal,monthly,targetDate:fields.targetDate});s.settings=settings;s.dirtyForms.delete(form.id);s.settingsDirty=s.dirtyForms.size>0;toast("財務目標已更新。");render();}if(form.id==="keyForm"){const settings={...s.settings,finnhubKey:fields.key.trim()};if(!s.demo)await cloud.saveSettings(s.user.uid,{finnhubKey:settings.finnhubKey});s.settings=settings;s.dirtyForms.delete(form.id);s.settingsDirty=s.dirtyForms.size>0;toast("私人金鑰已儲存。");render();}if(form.id==="inviteForm"){const email=fields.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email===s.user.email.toLowerCase())throw new Error("請填朋友的有效 Google 帳號，不能邀請自己。");if(s.invites.sent.some(i=>i.recipientEmail===email))throw new Error("這個帳號已在邀請名單中。");if(s.demo)s.invites.sent.push({id:id(),recipientEmail:email,status:"pending",ownerUid:s.user.uid});else await cloud.invite(s.user.uid,email,s.user.displayName);s.inviteEmail="";toast("邀請已建立；對方登入後可接受。");await loadSharing();}});});
window.addEventListener("hashchange",()=>{if(!s.user||$("appView").classList.contains("hidden"))return;const link=parseStrategyNotification(location.hash);if(link){void openStrategyNotification(link);return;}const page=location.hash.slice(1);if(PAGES[page]&&page!==s.page)setPage(page).catch(e=>toast(message(e),true));});
// Additive poll and teacher review controls; original strategy copy remains untouched.
const REVIEW_TEXT={none:'尚未發起',voting:'投票中',approved:'同意票較多',rejected:'不同意票較多',tie:'票數相同',expired:'投票已截止',changed:'策略已修改，需重新投票',private:'策略已轉為私人',revoked:'授權名單已變更，需重新投票',adopted:'投票已結算'};
function reviewOwner(post){return post.ownerUid||(s.friend==='self'?s.user.uid:s.friend);}
function reviewKey(post){return reviewOwner(post)+'/'+post.id;}
function reviewViewerIds(post,round){return s.friend==='self'?(s.demo?['demo-friend','demo-peer']:s.strategyAccess.viewerUids||[]):round?.currentViewers||[s.user.uid];}
function reviewIdentity(post){return s.demo&&s.friend==='self'?(s.reviewActor==='author'?s.user.uid:s.reviewActor):s.user.uid;}
function reviewCandidates(){return s.demo?[{uid:'demo-friend',label:'柏宇（示範）'},{uid:'demo-peer',label:'怡安（示範）'}]:s.invites.sent.filter(x=>x.status==='accepted'&&s.strategyAccess.viewerUids.includes(x.viewerUid)).map(x=>({uid:x.viewerUid,label:x.recipientEmail}));}
function reviewLabel(uid,round){if(uid===s.user.uid)return s.user.displayName||'我';return round?.voterProfiles?.[uid]?.displayName||reviewCandidates().find(x=>x.uid===uid)?.label||'投票成員';}
function reviewAvatar(uid,round){const profile=round?.voterProfiles?.[uid]||{},photo=googlePhotoUrl(profile.photoURL);return `<span class="sr-avatar" aria-hidden="true">${photo?`<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`:esc((profile.displayName||reviewLabel(uid,round)).slice(0,1))}</span>`;}
function voteResult(status){if(status.state==='approved')return '同意票較多';if(status.state==='rejected')return '不同意票較多';if(status.state==='tie')return '票數相同';if(status.state==='adopted')return '投票已結算';return REVIEW_TEXT[status.state]||'投票中';}
function teacherStatus(post,record){return teacherDecisionState(record?.teacherDecision,post);}
function strategyReviewHtml(post,own){
  const round=s.reviews[reviewKey(post)],viewers=reviewViewerIds(post,round),status=reviewState(round,post,viewers),actor=reviewIdentity(post),owner=reviewOwner(post),author=actor===owner,record=round||{},decision=teacherStatus(post,record),teacher=!!(!s.demo&&cloud.isAdmin(s.user)),canTeacher=!own&&teacher&&post.published&&decision==='pending',canSubmitTeacher=own&&!s.demo&&!teacher&&post.published&&['none','returned','outdated'].includes(decision),canVote=round?.voterUids?.includes(actor)&&status.state==='voting';
  const history=s.reviewHistory[reviewKey(post)]||[];
  const date=round?new Date(round.deadlineMs).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const voters=round?.voterUids?.map(uid=>`<li class="sr-voter"><span class="sr-voter-person">${reviewAvatar(uid,round)}<span>${esc(reviewLabel(uid,round))}</span></span><span class="${round.choices?.[uid]==='agree'?'up':round.choices?.[uid]==='reject'?'down':'muted'}">${{agree:'同意',reject:'不同意'}[round.choices?.[uid]]||'未投票'}</span>${round.reasons?.[uid]?`<small>${esc(round.reasons[uid])}</small>`:''}</li>`).join('')||'';
  const pollBadge=voteResult(status);
  const resultClass=['approved','rejected'].includes(status.state)?'green':'';
  const teacherBadge={none:'尚未提交審查',pending:'等待審查',approved:'審查已通過',returned:'審查已退回，可重新提交',outdated:'策略已更新，需重新提交'}[decision]||'尚未提交審查';
  return `<section class="sr-panel" aria-label="策略投票"><div class="sr-heading"><h3>策略投票</h3>${badge(pollBadge,resultClass)}</div>${round?`<div class="sr-counts"><span class="up">同意 ${status.agree}</span><span class="down">不同意 ${status.reject}</span><span>未投票 ${status.pending}</span></div><p class="sr-note">截止後以票數較多的一方為結果${status.state==='voting'?` · 截止 ${esc(date)}（台北）`:''}</p><ul class="sr-voters">${voters}</ul>`:`<p class="sr-note">你選取的策略授權成員都能投票；畫面會顯示目前票數。</p>`}<div class="sr-actions">${author&&post.published?`<button class="button secondary" data-action="review-start" data-id="${esc(post.id)}">${round?'重新發起投票':'發起投票'}</button>`:''}${canVote?`<button class="button secondary" data-action="review-agree" data-id="${esc(post.id)}">同意</button><button class="button secondary down" data-action="review-reject" data-id="${esc(post.id)}">不同意</button>`:''}${round?`<button class="text-button" data-action="review-reload" data-id="${esc(post.id)}">更新票數</button><button class="text-button" data-action="review-history" data-id="${esc(post.id)}">歷次投票</button>`:''}</div>${own&&!teacher?`<div class="sr-teacher"><strong>策略審查</strong><span class="muted">${esc(teacherBadge)}</span>${canSubmitTeacher?`<button class="button secondary" data-action="teacher-submit" data-id="${esc(post.id)}">${decision==='none'?'提交審查':'重新提交'}</button>`:''}${record.teacherDecision?.reason?`<small>${esc(record.teacherDecision.reason)}</small>`:''}${canSubmitTeacher?'<small>請先把策略分享授權給 App 管理員，讓審查者看得到內容。</small>':''}</div>`:''}${canTeacher?`<div class="sr-teacher"><strong>策略審查</strong><span class="muted">${esc(teacherBadge)}</span><div class="sr-actions"><button class="button primary" data-action="teacher-approve" data-id="${esc(post.id)}">核准</button><button class="button secondary down" data-action="teacher-return" data-id="${esc(post.id)}">退回</button></div>${record.teacherDecision?.reason?`<small>${esc(record.teacherDecision.reason)}</small>`:''}</div>`:''}${round?'<p class="sr-note">投票截止前可以更改；投票結果不會自動下單。</p>':''}${history.length?`<details class="sr-history"><summary>歷次投票 · ${history.length} 輪</summary>${history.map((r,i)=>`<div class="sr-round"><strong>${i===0?'最近一輪':'先前一輪'} · ${esc(stamp(new Date(r.createdMs).toISOString()))}</strong><p>同意 ${r.voterUids.filter(uid=>r.choices[uid]==='agree').length} · 不同意 ${r.voterUids.filter(uid=>r.choices[uid]==='reject').length}</p>${r.voterUids.map(uid=>r.choices[uid]?`<p>${esc(reviewLabel(uid,r))}：${r.choices[uid]==='agree'?'同意':'不同意'}${r.reasons[uid]?' · '+esc(r.reasons[uid]):''}</p>`:'').join('')}</div>`).join('')}</details>`:''}${!post.published?'<p class="sr-note">私人草稿無法發起投票。</p>':''}${s.demo&&own?`<label class="sr-demo">投票身份示範<select data-review-actor aria-label="投票身份示範"><option value="author" ${s.reviewActor==='author'?'selected':''}>作者</option><option value="demo-friend" ${s.reviewActor==='demo-friend'?'selected':''}>柏宇</option><option value="demo-peer" ${s.reviewActor==='demo-peer'?'selected':''}>怡安</option></select></label>`:''}</section>`;
}
async function loadVisibleReviews(){}
function findReviewPost(postId){const post=(s.friend==='self'?s.ownPosts:s.friendPosts).find(p=>p.id===postId);if(!post)throw new Error('策略已變更，請重新整理。');return {...post,ownerUid:reviewOwner(post)};}
function reviewDialog(title,body){const modal=$('reviewDialog');$('reviewDialogTitle').textContent=title;$('reviewDialogBody').innerHTML=body;$('reviewError').textContent='';modal.showModal();}
function defaultDeadline(){const date=new Date(Date.now()+86400000);const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);return parts.replace(' ','T');}
async function handleReviewAction(action,button){const session=s.session;const post=findReviewPost(button.dataset.id),key=reviewKey(post),round=s.reviews[key],actor=reviewIdentity(post);
  if(action==='review-start'){if(actor!==post.ownerUid)throw new Error('只有策略作者可以發起投票。');const voters=reviewViewerIds(post,round).filter(uid=>uid!==post.ownerUid);if(!voters.length)throw new Error('請先在分享設定授權至少一位策略投票成員。');reviewDialog('發起策略投票',`<form id="reviewStartForm" data-post="${esc(post.id)}" data-round="${esc(round?.roundId||'')}"><p class="sr-note">已授權的 ${voters.length} 位成員都會收到投票；名單會跟隨策略授權設定。</p><label>投票截止時間（台北）<input type="datetime-local" name="deadline" value="${defaultDeadline()}" required></label><p class="sr-note">截止後統計同意與不同意票；平手時顯示票數相同。重新發起會另開新的一輪。</p><div class="sr-actions"><button type="button" class="button secondary" data-close="reviewDialog">取消</button><button type="submit" class="button primary">開始投票</button></div></form>`);return;}
  if(action==='review-agree'||action==='review-reject'){if(!round)throw new Error('尚未發起投票。');const choice=action==='review-agree'?'agree':'reject';reviewDialog(choice==='agree'?'投下同意票':'投下不同意票',`<form id="reviewVoteForm" data-post="${esc(post.id)}" data-round="${esc(round.roundId)}" data-choice="${choice}"><label>投票理由（選填）<textarea name="reason" maxlength="500" placeholder="可補充你的看法">${esc(round.reasons?.[actor]||'')}</textarea></label><p class="sr-note">投票截止前可以更改。</p><div class="sr-actions"><button type="button" class="button secondary" data-close="reviewDialog">取消</button><button class="button primary" type="submit">確認投${choice==='agree'?'同意':'不同意'}</button></div></form>`);return;}
  if(action==='teacher-submit'){if(s.demo||actor!==post.ownerUid||cloud.isAdmin(s.user)||!post.published)throw new Error('只有一般使用者可提交自己的已發布策略進行審查。');reviewDialog('提交審查',`<form id="teacherSubmitForm" data-post="${esc(post.id)}"><label>審查說明（選填）<textarea name="reason" maxlength="500" placeholder="補充希望審查者留意的地方"></textarea></label><p class="sr-note">審查者需在你的策略授權名單中，才能查看內容並核准或退回。</p><div class="sr-actions"><button type="button" class="button secondary" data-close="reviewDialog">取消</button><button type="submit" class="button primary">確認送審</button></div></form>`);return;}
  if(action==='teacher-approve'||action==='teacher-return'){if(s.demo||!cloud.isAdmin(s.user)||s.friend==='self'||teacherStatus(post,round||{})!=='pending')throw new Error('只有 App 管理者能處理等待核准的送審策略。');const decision=action==='teacher-approve'?'approved':'returned';reviewDialog(decision==='approved'?'核准這份策略':'退回這份策略',`<form id="teacherDecisionForm" data-post="${esc(post.id)}" data-decision="${decision}"><label>審核備註（選填）<textarea name="reason" maxlength="500" placeholder="補充核准或退回原因"></textarea></label><p class="sr-note">審核結果會顯示給策略作者；不會替對方執行交易。</p><div class="sr-actions"><button type="button" class="button secondary" data-close="reviewDialog">取消</button><button type="submit" class="button primary">確認${decision==='approved'?'核准':'退回'}</button></div></form>`);return;}
  if(action==='review-reload')return loadVisibleReviews();
  if(action==='review-history'){const history=s.demo?(s.reviewHistory[key]||[]).filter(r=>r.roundId!==round.roundId).concat([round]).sort((a,b)=>b.createdMs-a.createdMs):await cloud.reviewHistory(post.ownerUid,post.id);if(session!==s.session)return;s.reviewHistory[key]=history;render();}
}
document.addEventListener('change',e=>{if(e.target.matches('[data-review-actor]')){s.reviewActor=e.target.value;render();}});
document.addEventListener('submit',e=>{const form=e.target;if(!['reviewStartForm','reviewVoteForm','teacherDecisionForm','teacherSubmitForm'].includes(form.id))return;e.preventDefault();task(form.querySelector('[type="submit"]'),async()=>{const session=s.session,post=findReviewPost(form.dataset.post),key=reviewKey(post),round=s.reviews[key],actor=reviewIdentity(post),data=new FormData(form);if(form.id==='reviewStartForm'){if(actor!==post.ownerUid)throw new Error('只有策略作者可以發起投票。');if((round?.roundId||'')!==form.dataset.round)throw new Error('投票輪次已變更，請重新開啟。');const voters=reviewViewerIds(post,round).filter(uid=>uid!==post.ownerUid),deadline=Date.parse(data.get('deadline')+':00+08:00');const next=s.demo?createReview(post,voters,reviewViewerIds(post,round),deadline,id()):await cloud.startReview(post.ownerUid,post.id,voters,deadline,id());if(session!==s.session)return;if(round&&s.demo)s.reviewHistory[key]=(s.reviewHistory[key]||[]).filter(r=>r.roundId!==round.roundId).concat([round]);s.reviews[key]={...next,teacherDecision:round?.teacherDecision||null};}else if(form.id==='reviewVoteForm'){if(round?.roundId!==form.dataset.round)throw new Error('本輪投票已變更，請重新開啟。');const profile={displayName:s.demo?(actor==='demo-peer'?'怡安':actor==='demo-friend'?'柏宇':s.user.displayName):s.user.displayName,photoURL:s.demo?'':s.user.photoURL};const next=s.demo?castReviewVote(round,post,reviewViewerIds(post,round),actor,form.dataset.choice,data.get('reason'),profile):await cloud.voteReview(post.ownerUid,post.id,form.dataset.round,actor,form.dataset.choice,data.get('reason'),profile);if(session!==s.session)return;s.reviews[key]={...next,teacherDecision:round?.teacherDecision||null};}else if(form.id==='teacherSubmitForm'){if(s.demo||actor!==post.ownerUid||cloud.isAdmin(s.user))throw new Error('只有一般使用者可以提交策略審查。');const value=await cloud.submitTeacherStrategy(post.ownerUid,post.id,{uid:s.user.uid,displayName:s.user.displayName},data.get('reason'));if(session!==s.session)return;s.reviews[key]={...(round||{}),currentViewers:reviewViewerIds(post,round),teacherDecision:value};}else{if(s.demo||!cloud.isAdmin(s.user)||s.friend==='self'||teacherStatus(post,round||{})!=='pending')throw new Error('只有 App 管理者能處理等待核准的送審策略。');const decision=form.dataset.decision==='approved'?'approved':'returned';const value=await cloud.teacherStrategyDecision(post.ownerUid,post.id,decision,{uid:s.user.uid,displayName:s.user.displayName,photoURL:s.user.photoURL},data.get('reason'));if(session!==s.session)return;s.reviews[key]={...(round||{}),currentViewers:reviewViewerIds(post,round),teacherDecision:value};}$('reviewDialog').close();render();toast(form.id==='reviewStartForm'?'投票已發起。':form.id==='reviewVoteForm'?'投票已記錄。':form.id==='teacherSubmitForm'?'策略已提交審查。':'審查結果已送出。');},$('reviewError'));});

async function loadSharing(){await loadSharingOriginal();void autoRefreshQuotes();}
function preventPageZoom(){for(const name of ["gesturestart","gesturechange","gestureend"])document.addEventListener(name,event=>event.preventDefault(),{passive:false});document.addEventListener("touchmove",event=>{if(event.touches.length>1)event.preventDefault();},{passive:false});}
preventPageZoom();
const AUTO_QUOTE_INTERVAL=60*1000;
setInterval(()=>{void autoRefreshQuotes();},15*1000);
setInterval(()=>{if(s.user&&!s.demo&&document.visibilityState==="visible")void notifications.appOpened();},5*60*1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&s.user&&!s.demo){void notifications.appOpened();void autoRefreshQuotes();}});
function registerAppUpdates(){
  const wasControlled=Boolean(navigator.serviceWorker.controller);
  let updateReady=false,reloading=false;
  const applyUpdate=()=>{if(!updateReady||reloading||document.visibilityState!=="visible"||s.dirtyForms.size||s.shareDirty||document.querySelector("dialog[open]")||document.activeElement?.matches("input,textarea,select"))return;reloading=true;location.reload();};
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(wasControlled){updateReady=true;applyUpdate();}});
  navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(registration=>{registration.update().catch(()=>{});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){applyUpdate();registration.update().catch(()=>{});}});}).catch(()=>{});
}
if("serviceWorker"in navigator)registerAppUpdates();
if(new URLSearchParams(location.search).has("demo"))startDemo();else initFirebase();


