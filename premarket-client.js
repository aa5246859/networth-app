import {NOTIFICATION_WORKER_URL} from "./config.js";

// This endpoint returns public market data only; it never needs a notification
// subscription, Firebase login token or another paid API key.
export async function stockPremarket(symbols){
  if(!NOTIFICATION_WORKER_URL)return {quotes:{}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(new URL("/premarket-quotes",NOTIFICATION_WORKER_URL),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols}),signal:controller.signal});
    if(!response.ok)throw new Error("盤前報價暫時無法取得。");
    return await response.json();
  }finally{clearTimeout(timer);}
}
