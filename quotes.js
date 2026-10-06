const COINS={btc:"bitcoin",eth:"ethereum",ada:"cardano",sol:"solana",xrp:"ripple",doge:"dogecoin",bnb:"binancecoin",ltc:"litecoin",dot:"polkadot",link:"chainlink",avax:"avalanche-2",shib:"shiba-inu",trx:"tron",uni:"uniswap",atom:"cosmos",xlm:"stellar",etc:"ethereum-classic",bch:"bitcoin-cash",near:"near",apt:"aptos",arb:"arbitrum",op:"optimism",sui:"sui",ton:"the-open-network",pepe:"pepe",usdt:"tether",usdc:"usd-coin",hbar:"hedera-hashgraph",fil:"filecoin",icp:"internet-computer"};
const coinCache=new Map();
const number=value=>Number(String(value??"").replace(/,/g,""));
const valid=value=>Number.isFinite(value)&&value>0;
const iso=seconds=>valid(seconds)?new Date(seconds*1000).toISOString():null;

async function json(url, fetchImpl=fetch, timeout=10000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetchImpl(url,{signal:controller.signal});
    if(response.ok===false) throw new Error(response.status===429?"查詢過於頻繁，請稍後再試":"報價來源暫時無法使用");
    return await response.json();
  } finally {clearTimeout(timer);}
}
async function coinId(symbol,fetchImpl) {
  const s=symbol.toLowerCase();
  if(COINS[s])return COINS[s];
  if(coinCache.has(s))return coinCache.get(s);
  const result=await json("https://api.coingecko.com/api/v3/search?query="+encodeURIComponent(s),fetchImpl);
  const exactId=result.coins?.find(c=>c.id===s);
  const matches=result.coins?.filter(c=>c.symbol?.toLowerCase()===s)||[];
  const hit=exactId || (matches.length===1?matches[0]:null);
  if(!hit)throw new Error(matches.length>1?"幣種代號重複，請改填 CoinGecko ID":"查無幣種");
  coinCache.set(s,hit.id);return hit.id;
}
function closeTime(raw) {
  const s=String(raw||"").replace(/[^0-9]/g,"");
  const full=s.length===7?String(+s.slice(0,3)+1911)+s.slice(3):s;
  return full.length===8?`${full.slice(0,4)}-${full.slice(4,6)}-${full.slice(6,8)}T13:30:00+08:00`:null;
}
async function taiwan(codes,fetchImpl) {
  const prices={};
  for(const [url,pick] of [
    ["https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",r=>[r.Code,r.ClosingPrice,r.Date]],
    ["https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",r=>[r.SecuritiesCompanyCode||r.Code,r.Close??r.ClosingPrice,r.Date]]
  ]) {
    if(codes.every(c=>prices[c]))break;
    try {const rows=await json(url,fetchImpl); for(const row of rows){const [code,raw,date]=pick(row);const p=number(raw);if(codes.includes(code)&&!prices[code]&&valid(p))prices[code]={price:p,priceAt:closeTime(date),source:"TWSE / TPEx 收盤價"};}}catch{}
  }
  // Includes ETFs when an OpenAPI source doesn't have a requested code.
  if(codes.some(c=>!prices[c])) {
    try {
      const result=await json("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?type=ALLBUT0999&response=json",fetchImpl);
      for(const table of result.tables||(result.fields?[result]:[])) {
        const codeIndex=table.fields?.indexOf("證券代號"),priceIndex=table.fields?.indexOf("收盤價");
        if(codeIndex<0||priceIndex<0)continue;
        for(const row of table.data||[]) {const code=row[codeIndex],p=number(row[priceIndex]);if(codes.includes(code)&&!prices[code]&&valid(p))prices[code]={price:p,priceAt:closeTime(result.date),source:"TWSE 收盤價"};}
      }
    }catch{}
  }
  await Promise.all(codes.filter(c=>!prices[c]).map(async c=>{
    try {const start=new Date(Date.now()-14*86400000).toISOString().slice(0,10);const j=await json(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(c)}&start_date=${start}`,fetchImpl);const last=j.data?.at(-1);const p=number(last?.close);if(valid(p))prices[c]={price:p,priceAt:last.date+"T13:30:00+08:00",source:"FinMind 收盤價"};}catch{}
  }));
  return prices;
}
async function pool(items,limit,fn) {
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await fn(item);}}));
}

export async function refreshMarket(assets, key="", {fetchImpl=fetch,now=new Date()}={}) {
  const auto=assets.filter(a=>a.mode!=="manual"),attemptAt=now.toISOString();
  const issues=[],cryptoPrices={},stockPrices={};let fx=null,twPrices={};
  const cryptoSymbols=[...new Set(auto.filter(a=>a.mode==="crypto").map(a=>a.symbol.toLowerCase()))];
  const stockSymbols=[...new Set(auto.filter(a=>a.mode==="stock").map(a=>a.symbol.toUpperCase()))];
  const twCodes=[...new Set(auto.filter(a=>a.mode==="tw").map(a=>a.symbol))];
  await Promise.allSettled([
    (async()=>{if(!auto.some(a=>a.mode!=="tw"))return;try{const j=await json("https://open.er-api.com/v6/latest/USD",fetchImpl);if(!valid(j.rates?.TWD))throw new Error();fx={rate:j.rates.TWD,asOf:iso(j.time_last_update_unix),fetchedAt:attemptAt};}catch{issues.push("匯率查詢失敗，保留前次匯率");}})(),
    (async()=>{if(!cryptoSymbols.length)return;const ids={};await pool(cryptoSymbols,3,async s=>{try{ids[s]=await coinId(s,fetchImpl);}catch(e){issues.push(s.toUpperCase()+"："+e.message);}});if(!Object.keys(ids).length)return;try{const j=await json(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(ids).map(encodeURIComponent).join(",")}&vs_currencies=usd&include_last_updated_at=true`,fetchImpl);for(const s of Object.keys(ids)){const item=j[ids[s]];if(valid(item?.usd))cryptoPrices[s]={price:item.usd,priceAt:iso(item.last_updated_at),source:"CoinGecko"};}}catch{issues.push("加密貨幣報價暫時無法取得");}})(),
    (async()=>{if(twCodes.length)twPrices=await taiwan(twCodes,fetchImpl);})(),
    (async()=>{if(!stockSymbols.length)return;if(!key){issues.push("美股需要在設定填入自己的 Finnhub 金鑰");return;}await pool(stockSymbols,3,async s=>{try{const j=await json(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`,fetchImpl);if(valid(j.c))stockPrices[s]={price:j.c,priceAt:iso(j.t),source:"Finnhub"};}catch{}});})()
  ]);
  const updates=auto.map(a=>{
    const previous={...(a.quote||{})};
    const item=a.mode==="stock"?stockPrices[a.symbol.toUpperCase()]:a.mode==="crypto"?cryptoPrices[a.symbol.toLowerCase()]:a.mode==="tw"?twPrices[a.symbol]:{price:1,priceAt:fx?.asOf,source:"USD / TWD 匯率"};
    const next={...previous,lastAttemptAt:attemptAt,currency:a.mode==="tw"?"TWD":"USD"};
    const errors=[];
    if(item && (a.mode!=="usd"||fx)){next.nativePrice=item.price;next.priceAt=item.priceAt;next.fetchedAt=attemptAt;next.source=item.source;}else{errors.push("報價更新失敗");issues.push(a.name+"：保留前次報價");}
    if(a.mode==="tw")next.fx=1;
    else if(fx){next.fx=fx.rate;next.fxAt=fx.asOf;next.fxFetchedAt=attemptAt;}else errors.push("匯率更新失敗");
    next.error=errors.join("；");
    return {id:a.id,mode:a.mode,symbol:a.symbol,quote:next};
  });
  return {updates,fx,issues:[...new Set(issues)]};
}
