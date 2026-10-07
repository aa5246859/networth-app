export const TYPES = { manual: "手動資產", crypto: "加密貨幣", tw: "台股", stock: "美股", usd: "美元資產" };
export const finite = value => typeof value === "number" && Number.isFinite(value);
export const positive = value => finite(value) && value > 0;
export const id = () => crypto.randomUUID();
export const taipeiDay = (date = new Date()) => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
export const stamp = value => {
  const date = new Date(value);
  return value && finite(date.getTime()) ? new Intl.DateTimeFormat("zh-TW", {timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date) : "時間未確認";
};
export const num = (value, digits = 2) => finite(value) ? value.toLocaleString("zh-TW", {maximumFractionDigits:digits}) : "—";
export const money = value => finite(value) ? "NT$ " + num(value, 0) : "—";
export const compact = value => Math.abs(value) >= 1e8 ? num(value / 1e8, 2) + " 億" : num(value / 1e4, 1) + " 萬";
export const signed = value => finite(value) ? (value > 0 ? "+" : value < 0 ? "−" : "") + num(Math.abs(value), 0) : "—";
export const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function normalizeAsset(old, legacyQuotes = {}) {
  const a = {...old, mode: old.mode || "manual", id: old.id || id(), isSummary: old.isSummary === true};
  if (a.mode === "manual" || a.quote) return a;
  const qty = +a.qty || 0, fx = +legacyQuotes?.fx || 0;
  const tw = a.mode === "tw";
  const nativePrice = a.mode === "usd" ? 1 : qty > 0 && (tw || fx > 0) && positive(+a.value) ? +a.value / qty / (tw ? 1 : fx) : null;
  a.legacyValue = finite(+a.value) ? +a.value : 0;
  a.quote = {nativePrice, fx:tw ? 1 : fx || null, currency:tw ? "TWD" : "USD", source:"舊資料快照", priceAt:null, fetchedAt:null, fxAt:null, error:"舊報價時間未確認，請更新"};
  return a;
}

export function valuation(a) {
  const manual = a.mode === "manual", tw = a.mode === "tw";
  const currency = manual || tw ? "TWD" : "USD";
  const qty = +a.qty || 0;
  const price = manual ? null : a.mode === "usd" ? 1 : a.quote?.nativePrice;
  const fx = currency === "TWD" ? 1 : a.quote?.fx;
  const nativeValue = manual ? (+a.value || 0) : positive(price) ? price * qty : null;
  const calculated = finite(nativeValue) && positive(fx);
  const value = calculated ? nativeValue * fx : finite(a.legacyValue) ? a.legacyValue : null;
  const costNative = manual ? (positive(+a.cost) ? +a.cost : null) : positive(+a.costPer) ? +a.costPer * (a.mode === "usd" ? 1 : qty) : null;
  const fixedCost = positive(+a.costFx) && positive(costNative) ? costNative * +a.costFx : null;
  let cost = currency === "TWD" ? costNative : fixedCost ?? (positive(fx) && positive(costNative) ? costNative * fx : null);
  // Older manual-total cost records are preserved when no native cost exists.
  if (!positive(costNative) && positive(+a.cost)) cost = +a.cost;
  const pnl = calculated && finite(value) && positive(cost) ? value - cost : null;
  const pnlNative = finite(nativeValue) && positive(costNative) ? nativeValue - costNative : null;
  const kind = currency === "USD" && positive(costNative) && !positive(+a.costFx) ? "價差損益・未計匯差" : "浮動損益";
  return {value, nativeValue, currency, price, fx, cost, pnl, pnlNative, percent:positive(cost) && finite(pnl) ? pnl / cost * 100 : null, kind, missing:!calculated, stale:!manual && (!!a.quote?.error || !a.quote?.fetchedAt), excluded:a.isSummary === true};
}

export function portfolio(assets) {
  const included = assets.filter(a => !a.isSummary).map(a => ({asset:a,...valuation(a)}));
  const covered = included.filter(a => finite(a.pnl));
  const total = included.reduce((sum,a) => sum + (a.value ?? 0), 0);
  const cost = covered.reduce((sum,a) => sum + a.cost, 0);
  const pnl = covered.length ? covered.reduce((sum,a) => sum + a.pnl, 0) : null;
  return {total,cost,pnl,percent:cost > 0 && finite(pnl) ? pnl / cost * 100 : null,count:included.length,covered:covered.length,stale:included.filter(a=>a.stale || a.missing).length};
}

export function aggregateHoldings(assets) {
  const groups=new Map(), result=[];
  for(const asset of assets){
    if(!['crypto','tw','stock'].includes(asset.mode)||!asset.symbol||asset.isSummary){result.push(asset);continue;}
    const symbol=String(asset.symbol).trim().toUpperCase();
    if(!symbol){result.push(asset);continue;}
    const key=asset.mode+':'+symbol;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(asset);
  }
  for(const [key,lots] of groups){
    if(lots.length===1){result.push(lots[0]);continue;}
    const values=lots.map(asset=>({asset,value:valuation(asset)}));
    const quantity=lots.reduce((sum,asset)=>sum+(+asset.qty||0),0);
    const valued=values.filter(item=>finite(item.value.value));
    const costed=values.filter(item=>finite(item.value.pnl)&&finite(item.value.cost));
    const nativeCosted=lots.filter(asset=>positive(+asset.costPer)&&positive(+asset.qty));
    const nativeCostQty=nativeCosted.reduce((sum,asset)=>sum+(+asset.qty||0),0);
    const cost=costed.reduce((sum,item)=>sum+item.value.cost,0);
    const pnl=costed.length?costed.reduce((sum,item)=>sum+item.value.pnl,0):null;
    const first=lots[0],quotes=values.filter(item=>positive(item.value.price));
    const quoteQty=quotes.reduce((sum,item)=>sum+(+item.asset.qty||0),0);
    result.push({id:'aggregate:'+key,aggregate:true,aggregateKey:key,lots,mode:first.mode,symbol:String(first.symbol).trim().toUpperCase(),name:first.name||first.symbol,type:first.type,qty:quantity,averageCost:nativeCostQty?nativeCosted.reduce((sum,asset)=>sum+(+asset.costPer)*(+asset.qty),0)/nativeCostQty:null,value:valued.length?valued.reduce((sum,item)=>sum+item.value.value,0):null,pnl:costed.length?pnl:null,cost:costed.length?cost:null,percent:cost>0&&finite(pnl)?pnl/cost*100:null,coverage:costed.length,valuationCount:valued.length,nativeValue:values.every(item=>finite(item.value.nativeValue))?values.reduce((sum,item)=>sum+item.value.nativeValue,0):null,price:quoteQty?quotes.reduce((sum,item)=>sum+item.value.price*(+item.asset.qty||0),0)/quoteQty:null,currency:values.find(item=>item.value.currency)?.value.currency||'USD',stale:values.some(item=>item.value.stale||item.value.missing),source:first.quote?.source||'',unit:first.mode==='stock'||first.mode==='tw'?'股':'顆'});
  }
  return result;
}

export function requiredRates(assets, settings, now = new Date()) {
  const value = portfolio(assets).total, goal = +settings.goal, monthly = +settings.monthly || 0;
  const end = new Date(settings.targetDate + "T23:59:59+08:00");
  if (!positive(goal) || !finite(end.getTime()) || monthly < 0) return {state:"invalid"};
  const days = Math.max(0, (end - now) / 86400000), months = days / (365.2425/12);
  const gap = goal - value;
  if (gap <= 0) return {state:"done",days,months,gap:0};
  if (months <= 0) return {state:"expired",days,months,gap};
  if (value === 0 && monthly === 0) return {state:"noCapital",days,months,gap};
  const future = r => { const l = Math.log1p(r); return value * Math.exp(months*l) + (r === 0 ? monthly * months : monthly * Math.expm1(months*l)/r); };
  if (future(0) >= goal) return {state:"contributions",days,months,gap,rm:0,ry:0};
  let lo = 0, hi = 0.01;
  while (future(hi) < goal && hi < 1024) hi *= 2;
  if (future(hi) < goal) return {state:"unsolved",days,months,gap};
  for (let i=0;i<90;i++) { const m = (lo+hi)/2; if (future(m) < goal) lo=m; else hi=m; }
  const rm=(lo+hi)/2, ry=Math.expm1(12*Math.log1p(rm));
  if (!finite(ry) || Math.abs(future(rm)-goal)/goal > 1e-7) return {state:"unsolved",days,months,gap};
  return {state:"calculated",days,months,gap,rm,ry,rd:Math.expm1(Math.log1p(ry)/365.2425),final:future(rm)};
}

// Explicit allowlist: credentials, settings, history and unselected assets never enter a shared document.
export function sharedAsset(a) {
  const keys=["id","name","mode","type","symbol","qty","value","legacyValue","cost","costPer","costFx","isSummary","quote","updatedAt"];
  const result=Object.fromEntries(keys.filter(k=>a[k]!==undefined).map(k=>[k,structuredClone(a[k])]));
  if(result.quote){const allowed=["nativePrice","fx","currency","source","priceAt","fetchedAt","fxAt","fxFetchedAt","error","lastAttemptAt"];result.quote=Object.fromEntries(allowed.filter(k=>result.quote[k]!==undefined).map(k=>[k,result.quote[k]]));}
  return result;
}
export function makeSharedPortfolio(assets, settings, name, grants, selectedIds) {
  const selected=new Set(selectedIds);
  return {ownerName:name,viewerUids:[...new Set(grants)],assets:assets.filter(a=>selected.has(a.id)).map(sharedAsset),updatedAt:new Date().toISOString()};
}

export function parseAsset(fields, previous = null) {
  const mode=fields.mode;
  if (!(mode in TYPES)) throw new Error("請選擇資產類型");
  const toNumber = (raw, title, required=false) => {
    if (raw === "" || raw == null) {if(required) throw new Error("請填"+title); return null;}
    const value=Number(raw); if(!finite(value) || value<0) throw new Error(title+"需為有效的非負數字"); return value;
  };
  const name=fields.name.trim() || fields.symbol?.trim().toUpperCase() || (mode==="usd" ? "美元資產" : "");
  if(!name || name.length>80) throw new Error("名稱需為 1～80 個字");
  const a={id:previous?.id || id(),name,mode,type:mode==="manual"?fields.type:TYPES[mode],symbol:null,qty:null,cost:null,costPer:null,costFx:null,isSummary:mode==="usd"&&fields.isSummary===true,createdAt:previous?.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(mode==="manual") {a.value=toNumber(fields.value,"目前價值",true);a.cost=toNumber(fields.cost,"台幣本金");return a;}
  a.qty=toNumber(fields.qty,mode==="usd"?"美元金額":"持有數量",true);
  if(!positive(a.qty)) throw new Error("數量或金額需大於 0");
  if(mode!=="usd") {a.symbol=fields.symbol.trim();if(!a.symbol || !/^[A-Za-z0-9.^_-]{1,80}$/.test(a.symbol)) throw new Error("請填有效的代號"); if(mode!=="tw") a.symbol=a.symbol.toUpperCase();}
  a.costPer=toNumber(fields.costPer,"買入成本");
  a.costFx=mode==="tw"?null:toNumber(fields.costFx,"買入匯率");
  if(a.costFx===0) throw new Error("買入匯率需大於 0，或留空");
  if(previous?.mode===mode && previous?.symbol===a.symbol) {a.quote=previous.quote;a.legacyValue=previous.legacyValue;}
  return a;
}
