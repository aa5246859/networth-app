import {id,finite,parseAsset,normalizeAsset,sharedAsset} from './core.js';
const postKeys=['id','ownerUid','ownerName','title','symbol','term','thesis','entry','invalidation','target','status','published','createdAt','updatedAt'];
const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value).getTime())&&new Date(value).toISOString().slice(0,10)===value;
export function buildBackup(state){
  const {goal,targetDate,monthly}=state.settings;
  return {version:2,exportedAt:new Date().toISOString(),settings:{goal,targetDate,monthly},assets:state.assets.map(sharedAsset),history:state.history.map(({date,total})=>({date,total})),strategies:state.ownPosts.map(p=>Object.fromEntries(postKeys.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])))};
}
export function parseBackup(data){
  if(!data||!Array.isArray(data.assets)||!Array.isArray(data.history)||data.assets.length>1000||data.history.length>5000||(data.version!=null&&![1,2].includes(data.version)))throw new Error('不是有效或支援的資產備份。');
  const assets=data.assets.map(raw=>{
    if(!raw||typeof raw.name!=='string'||!['manual','stock','tw','crypto','usd'].includes(raw.mode))throw new Error('備份中有無效資產，尚未匯入。');
    const old=normalizeAsset(raw,data.quotes);
    const asset=parseAsset({...old,name:old.name,symbol:old.symbol||'',type:typeof old.type==='string'?old.type.slice(0,80):'其他'});
    const sanitized=sharedAsset(old);
    if(sanitized.quote){
      for(const field of ['nativePrice','fx'])if(sanitized.quote[field]!=null&&(!finite(sanitized.quote[field])||sanitized.quote[field]<=0))throw new Error('備份中有無效報價。');
      for(const field of ['priceAt','fetchedAt','fxAt','fxFetchedAt','lastAttemptAt'])if(sanitized.quote[field]!=null&&!finite(new Date(sanitized.quote[field]).getTime()))throw new Error('備份中有無效報價時間。');
      for(const field of ['currency','source','error'])if(sanitized.quote[field]!=null&&typeof sanitized.quote[field]!=='string')throw new Error('備份中有無效報價說明。');
      asset.quote=sanitized.quote;
    }
    if(sanitized.legacyValue!=null){if(!finite(sanitized.legacyValue)||sanitized.legacyValue<0)throw new Error('備份中有無效舊市值。');asset.legacyValue=sanitized.legacyValue;}
    return asset;
  });
  const history=data.history.map(h=>{if(!h||!dateOK(h.date)||!finite(h.total)||h.total<0)throw new Error('備份中有無效日期或資產紀錄。');return {date:h.date,total:h.total};});
  if(new Set(history.map(h=>h.date)).size!==history.length)throw new Error('備份中有重複的紀錄日期。');
  let settings=null;
  if(data.settings){const {goal,targetDate,monthly=0}=data.settings;if(!finite(goal)||goal<=0||!dateOK(targetDate)||!finite(monthly)||monthly<0)throw new Error('備份中的財務目標無效。');settings={goal,targetDate,monthly};}
  if(data.strategies!=null&&(!Array.isArray(data.strategies)||data.strategies.length>200))throw new Error('備份中的策略格式或筆數無效。');
  const strategies=(data.strategies||[]).map(raw=>{
    const post={id:id(),published:false};
    for(const [key,max,required] of [['title',100,true],['symbol',80,true],['thesis',4000,true],['entry',4000,false],['invalidation',4000,false],['target',4000,false]]){const value=raw?.[key]??'';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('備份中的策略文字無效。');post[key]=value.trim();}
    if(!['long','short'].includes(raw.term)||!['watching','active','closed'].includes(raw.status))throw new Error('備份中的策略週期或狀態無效。');
    post.term=raw.term;post.status=raw.status;post.createdAt=raw.createdAt&&finite(new Date(raw.createdAt).getTime())?raw.createdAt:new Date().toISOString();post.updatedAt=new Date().toISOString();return post;
  });
  return {assets,history,settings,strategies};
}
