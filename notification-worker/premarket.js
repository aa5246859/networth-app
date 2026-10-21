const SOURCE="Yahoo Finance 盤前（可能延遲）";
const positive=value=>typeof value==="number"&&Number.isFinite(value)&&value>0;
const symbolPattern=/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;

export async function limitedJson(message,limit){
  if(Number(message.headers.get("Content-Length"))>limit)throw new Error("盤前資料超過預期大小。");
  const reader=message.body?.getReader();if(!reader)throw new Error("盤前資料格式錯誤。");
  const decoder=new TextDecoder();let length=0,text="";
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>limit){await reader.cancel();throw new Error("盤前資料超過預期大小。");}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  }finally{reader.releaseLock();}
}

// Use actual USD equity/ETF bars inside the source's current premarket session.
// Source session timestamps account for holidays and US daylight-saving time.
export function parsePremarketQuote(payload,symbol,now=Date.now()){
  if(payload?.chart?.error)return null;
  const item=payload?.chart?.result?.[0],meta=item?.meta,pre=meta?.currentTradingPeriod?.pre;
  const expected=symbol.replace(/\./g,"-");
  if(meta?.symbol?.toUpperCase()!==expected||meta.currency!=="USD"||!["EQUITY","ETF"].includes(meta.instrumentType)||meta.hasPrePostMarketData!==true)return null;
  const seconds=now/1000;
  if(!positive(pre?.start)||!positive(pre?.end)||pre.end<=pre.start||pre.end-pre.start>6*3600||seconds<pre.start||seconds>=pre.end)return null;
  const timestamps=item.timestamp,closes=item.indicators?.quote?.[0]?.close;
  if(!Array.isArray(timestamps)||!Array.isArray(closes)||timestamps.length!==closes.length)return null;
  /** @type {{timestamp:number,price:number}|null} */
  let selected=null;
  for(let index=0;index<timestamps.length;index++){
    const timestamp=timestamps[index],price=closes[index];
    if(!positive(timestamp)||!positive(price)||timestamp<pre.start||timestamp>=pre.end||timestamp>seconds||selected&&timestamp<=selected.timestamp)continue;
    selected={timestamp,price};
  }
  return selected?{symbol,price:selected.price,priceAt:new Date(selected.timestamp*1000).toISOString(),source:SOURCE,session:"pre",sessionStart:pre.start,sessionEnd:pre.end}:null;
}

function currentQuote(quote,symbol,now){
  const timestamp=Date.parse(quote?.priceAt)/1000,seconds=now/1000;
  return quote?.symbol===symbol&&quote.session==="pre"&&quote.source===SOURCE&&positive(quote.price)&&positive(timestamp)&&positive(quote.sessionStart)&&positive(quote.sessionEnd)&&seconds>=quote.sessionStart&&seconds<quote.sessionEnd&&timestamp>=quote.sessionStart&&timestamp<quote.sessionEnd&&timestamp<=seconds;
}

export async function premarketQuotes(symbols,requestUrl,{fetchImpl=fetch,cache=typeof caches==="undefined"?undefined:caches.default,now=NaN}={}){
  if(!Array.isArray(symbols)||!symbols.length||symbols.length>20||symbols.some(symbol=>typeof symbol!=="string"||symbol.length>20||!symbolPattern.test(symbol)))throw new Error("每次最多查詢 20 個有效美股代號。");
  const quotes={},errors={},unique=[...new Set(symbols)],quoteNow=()=>Number.isFinite(now)?now:Date.now();let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{
    while(cursor<unique.length){
      const symbol=unique[cursor++],cacheKey=new Request(new URL("/__premarket_cache/v1/"+encodeURIComponent(symbol),requestUrl));
      try{
        /** @type {Response|undefined} */
        let cached;
        try{cached=await cache?.match(cacheKey);}catch{/* Cache failures must not prevent fresh quotes. */}
        if(cached){const value=await cached.json().catch(()=>null);if(currentQuote(value,symbol,quoteNow())){quotes[symbol]=value;continue;}}
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
        let quote;
        try{
          const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol.replace(/\./g,"-"))+"?interval=1m&range=1d&includePrePost=true";
          const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"WealthTracker/2.4.31"}});
          if(!response.ok)throw new Error("盤前來源暫時無法使用。");
          quote=parsePremarketQuote(await limitedJson(response,1024*1024),symbol,quoteNow());
        }finally{clearTimeout(timer);}
        if(!quote)continue;
        quotes[symbol]=quote;
        try{await cache?.put(cacheKey,Response.json(quote,{headers:{"Cache-Control":"public, max-age=30"}}));}catch{/* Quotes remain usable without caching. */}
      }catch{errors[symbol]="盤前報價暫時無法取得。";}
    }
  }));
  return {ok:true,quotes,errors};
}
