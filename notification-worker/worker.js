const cors=(env)=>({"Access-Control-Allow-Origin":env.APP_ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Vary":"Origin"});
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers}});
const taipeiDay=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const b64url=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
function pemBytes(pem){return Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0));}
async function firebaseUser(request,env){
  const auth=request.headers.get("Authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token)throw new Error("請先登入 App。");
  const response=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(env.FIREBASE_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:token})});
  const data=await response.json().catch(()=>({})),user=data.users?.[0];
  if(!response.ok||!user?.localId||user.emailVerified!==true)throw new Error("登入已逾時，或 Google 帳號尚未驗證。");
  if(user.email?.toLowerCase()!=="aaz52468599@gmail.com"){
    const access=await fetch("https://firestore.googleapis.com/v1/projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/access/"+user.localId,{headers:{Authorization:"Bearer "+token}});
    const doc=await access.json().catch(()=>({}));
    if(!access.ok||doc.fields?.status?.stringValue!=="approved")throw new Error("此帳號尚未獲得 App 使用授權。");
  }
  return {uid:user.localId,email:String(user.email||"").trim().toLowerCase(),token};
}
async function readDoc(path,token,env){const response=await fetch("https://firestore.googleapis.com/v1/projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/"+path,{headers:{Authorization:"Bearer "+token}});if(!response.ok)throw new Error("無法確認目前策略分享權限。");return response.json();}
function fieldString(doc,key){return doc.fields?.[key]?.stringValue||"";}
function fieldList(doc,key){return doc.fields?.[key]?.arrayValue?.values?.map(x=>x.stringValue).filter(Boolean)||[];}
function serviceAccount(env){try{return JSON.parse(env.FCM_SERVICE_ACCOUNT)}catch{throw new Error("Cloudflare 尚未設定 FCM_SERVICE_ACCOUNT secret。")}}
const tokenCache=new Map();
async function accessToken(env,scope="https://www.googleapis.com/auth/firebase.messaging"){
  const cached=tokenCache.get(scope);if(cached&&cached.expires>Date.now()+60000)return cached.value;
  const account=serviceAccount(env),now=Math.floor(Date.now()/1000),header=b64url(new TextEncoder().encode(JSON.stringify({alg:"RS256",typ:"JWT"}))),claim=b64url(new TextEncoder().encode(JSON.stringify({iss:account.client_email,scope, aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}))),input=header+"."+claim;
  const key=await crypto.subtle.importKey("pkcs8",pemBytes(account.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]),signature=b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:input+"."+signature})}),body=await response.json();
  if(!response.ok||!body.access_token)throw new Error("Google 服務驗證失敗，請檢查 Cloudflare 服務帳戶設定。");tokenCache.set(scope,{value:body.access_token,expires:Date.now()+3300000});return body.access_token;
}
async function send(env,device,title,body,eventKey,url){
  const cachedAccess=await accessToken(env);
  const response=await fetch("https://fcm.googleapis.com/v1/projects/"+env.FIREBASE_PROJECT_ID+"/messages:send",{method:"POST",headers:{Authorization:"Bearer "+cachedAccess,"Content-Type":"application/json"},body:JSON.stringify({message:{token:device.token,data:{title,body,eventKey,url},webpush:{headers:{TTL:"86400",Urgency:"high"}}}})}),result=await response.json().catch(()=>({}));
  if(!response.ok){if(result.error?.details?.some(d=>d.errorCode==="UNREGISTERED")||result.error?.status==="NOT_FOUND")await env.DB.prepare("DELETE FROM devices WHERE token=?").bind(device.token).run();throw new Error("FCM push failed: "+(result.error?.status||response.status));}
}
async function authorizedRecipient(device,env,requester=null){
  if(String(device.email||"").toLowerCase()==="aaz52468599@gmail.com")return true;
  const token=requester?.email==="aaz52468599@gmail.com"?requester.token:await accessToken(env,"https://www.googleapis.com/auth/datastore");
  const response=await fetch("https://firestore.googleapis.com/v1/projects/"+env.FIREBASE_PROJECT_ID+"/databases/(default)/documents/access/"+encodeURIComponent(device.uid),{headers:{Authorization:"Bearer "+token}});
  if(response.status===404)return false;
  if(!response.ok)throw new Error("無法驗證通知接收者授權；請確認服務帳戶具有 Cloud Datastore Viewer 讀取角色。");
  const doc=await response.json();return doc.fields?.status?.stringValue==="approved";
}
async function bodyOf(request){try{return await request.json()}catch{throw new Error("請求資料格式錯誤。")}}
async function handle(request,env){
  const headers=cors(env);
  if(request.method==="OPTIONS")return new Response(null,{headers});
  if(request.headers.get("Origin")!==env.APP_ORIGIN)return json({error:"來源網址不符。"},403,headers);
  if(request.method!=="POST")return json({error:"Method not allowed"},405,headers);
  try{
    const url=new URL(request.url),user=await firebaseUser(request,env),body=await bodyOf(request),now=new Date().toISOString();
    if(url.pathname==="/register"){
      if(typeof body.deviceId!=="string"||body.deviceId.length>100||typeof body.token!=="string"||body.token.length<20||body.token.length>4096)throw new Error("通知裝置資料不完整。");
      await env.DB.prepare("INSERT INTO devices(uid,device_id,email,token,strategy_enabled,daily_enabled,last_opened_day,daily_sent_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(uid,device_id) DO UPDATE SET email=excluded.email,token=excluded.token,strategy_enabled=excluded.strategy_enabled,daily_enabled=excluded.daily_enabled,updated_at=excluded.updated_at").bind(user.uid,body.deviceId,user.email,body.token,body.strategy===false?0:1,body.daily===false?0:1,taipeiDay(),null,now,now).run();
      return json({ok:true},200,headers);
    }
    if(url.pathname==="/heartbeat"){
      if(typeof body.deviceId!=="string")throw new Error("通知裝置資料不完整。");
      await env.DB.prepare("UPDATE devices SET last_opened_day=?,updated_at=? WHERE uid=?").bind(taipeiDay(),now,user.uid).run();
      return json({ok:true},200,headers);
    }
    if(url.pathname==="/delete"){
      if(typeof body.deviceId!=="string")throw new Error("通知裝置資料不完整。");
      await env.DB.prepare("DELETE FROM devices WHERE uid=? AND device_id=?").bind(user.uid,body.deviceId).run();
      return json({ok:true},200,headers);
    }
    if(url.pathname==="/strategy-event"){
      if(typeof body.postId!=="string"||body.postId.length>150)throw new Error("策略資料不完整。");
      const [post,access]=await Promise.all([readDoc("strategies/"+user.uid+"/posts/"+encodeURIComponent(body.postId),user.token,env),readDoc("strategyAccess/"+user.uid,user.token,env)]);
      if(fieldString(post,"ownerUid")!==user.uid||fieldString(post,"id")!==body.postId||post.fields?.published?.booleanValue!==true)throw new Error("只有已發布的策略會發送通知。");
      const viewers=fieldList(access,"viewerUids").filter(uid=>uid!==user.uid);
      if(!viewers.length)return json({ok:true,sent:0,reason:"no-viewers"},200,headers);
      const recipients=await env.DB.prepare("SELECT uid,device_id,email,token FROM devices WHERE strategy_enabled=1 AND uid IN ("+viewers.map(()=>"?").join(",")+")").bind(...viewers).all();
      const eventKey=user.uid+":"+body.postId+":"+fieldString(post,"updatedAt");
      let sent=0,failed=0,skipped=0,duplicate=0;const errors=[];
      for(const device of recipients.results||[]){
        const deliveryKey=eventKey+":"+device.uid+":"+device.device_id;
        try{
          if(!await authorizedRecipient(device,env,user)){skipped++;continue;}
          const previous=await env.DB.prepare("SELECT event_key FROM sent_events WHERE event_key=?").bind(deliveryKey).first();
          if(previous){duplicate++;continue;}
          await send(env,device,"交易策略更新",fieldString(post,"title")+" · "+fieldString(post,"symbol"),eventKey,"./#sharing");
          await env.DB.prepare("INSERT OR IGNORE INTO sent_events(event_key,sent_at) VALUES(?,?)").bind(deliveryKey,now).run();sent++;
        }catch(error){failed++;errors.push(error?.message||"通知傳送失敗。");console.error(error?.message||error)}
      }
      return json({ok:failed===0,sent,failed,skipped,duplicate,errors:errors.slice(0,1),reason:!(recipients.results||[]).length?"no-enabled-devices":undefined},200,headers);
    }
    return json({error:"找不到通知路徑。"},404,headers);
  }catch(error){return json({error:error?.message||"通知處理失敗。"},400,headers)}
}
export default {fetch:handle,async scheduled(event,env,ctx){
  ctx.waitUntil((async()=>{
    const today=taipeiDay(),rows=await env.DB.prepare("SELECT uid,device_id,email,token FROM devices WHERE daily_enabled=1 AND (last_opened_day IS NULL OR last_opened_day<>?) AND (daily_sent_day IS NULL OR daily_sent_day<>?)").bind(today,today).all();
    for(const device of rows.results||[]){try{if(!await authorizedRecipient(device,env))continue;await send(env,device,"每日資產提醒","今天還沒開啟 Wealth Tracker，花一點時間檢視你的資產與策略。","daily:"+today+":"+device.uid,"./#home");await env.DB.prepare("UPDATE devices SET daily_sent_day=? WHERE uid=? AND device_id=?").bind(today,device.uid,device.device_id).run()}catch(error){console.error(error?.message||error)}}
    await env.DB.prepare("DELETE FROM sent_events WHERE sent_at < datetime('now','-30 days')").run();
  })())
}};

