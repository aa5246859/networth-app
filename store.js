import {reviewRepository} from './review-store.js';
import {FIREBASE_CONFIG,ADMIN_EMAIL,DEFAULT_SETTINGS} from "./config.js";
import {normalizeAsset,sharedAsset} from "./core.js";
let sdk,db,auth,firebaseApp;
export async function connect() {
  const [appModule,authModule,firestoreModule]=await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);
  sdk={...appModule,...authModule,...firestoreModule};
  const app=sdk.getApps()[0]||sdk.initializeApp(FIREBASE_CONFIG);firebaseApp=app;auth=sdk.getAuth(app);db=sdk.getFirestore(app);
  sdk.getRedirectResult(auth).catch(()=>{});
  return sdk.onAuthStateChanged;
}
export const watchAuth=handler=>sdk.onAuthStateChanged(auth,handler);
export const logout=()=>sdk.signOut(auth);
export const currentIdToken=()=>auth?.currentUser?.getIdToken();
export const currentUserId=()=>auth?.currentUser?.uid||"";
export async function pushToken(registration,vapidKey){const messaging=await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");if(!await messaging.isSupported())throw new Error("這個瀏覽器不支援網頁推播。");return messaging.getToken(messaging.getMessaging(firebaseApp),{vapidKey,serviceWorkerRegistration:registration});}
export async function removePushToken(){if(!auth?.currentUser||!firebaseApp)return;const messaging=await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");if(await messaging.isSupported())await messaging.deleteToken(messaging.getMessaging(firebaseApp));}
export async function login() {
  const ua=navigator.userAgent||"";
  if(/GSA\//i.test(ua)){
    const browser=/iPhone|iPad|iPod/i.test(ua)?"Safari":"Chrome";
    throw new Error(`Google App 內建瀏覽器可能讓登入停在 Firebase 白色視窗。請點右下角「⋯」並選「在外部瀏覽器開啟」（iPhone 選 ${browser}），再登入。`);
  }
  const provider=new sdk.GoogleAuthProvider();
  try{return await sdk.signInWithPopup(auth,provider);}catch(e){if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment"].includes(e.code))return sdk.signInWithRedirect(auth,provider);throw e;}
}
const d=(...path)=>sdk.doc(db,...path);
const c=(...path)=>sdk.collection(db,...path);
const clean=obj=>JSON.parse(JSON.stringify(obj));
export const isAdmin=user=>user?.emailVerified===true&&user.email?.toLowerCase()===ADMIN_EMAIL;
export async function checkAccess(user) {
  if(isAdmin(user))return "approved";
  const ref=d("access",user.uid),snap=await sdk.getDoc(ref);
  if(!snap.exists()){await sdk.setDoc(ref,{email:user.email||"",name:user.displayName||"",status:"pending",requestedAt:new Date().toISOString()});return "pending";}
  return snap.data().status;
}

async function migrate(uid) {
  const root=d("users",uid);
  const snap=await sdk.getDoc(root),raw=snap.exists()?snap.data():null;
  if(raw?.schemaVersion===2)return;
  // One transaction prevents two devices from migrating the same legacy data over a newer edit.
  // Large histories are copied in resumable chunks while the client keeps its editing UI locked.
  const token=crypto.randomUUID(),now=Date.now();
  const source=await sdk.runTransaction(db,async tx=>{
    const current=await tx.get(root);const profile=current.exists()?current.data():{};
    if(profile.schemaVersion===2)return null;
    if(profile.migration?.expires>now&&profile.migration.token!==token)throw new Error("另一台裝置正在轉換資料，請稍後重新登入");
    const backup=d("users",uid,"backups","v1");const old=await tx.get(backup);
    const origin=old.exists()?old.data():profile;
    if(!old.exists())tx.set(backup,clean({...origin,backedUpAt:new Date().toISOString()}));
    tx.set(root,{settings:{...DEFAULT_SETTINGS,...profile.settings},migration:{token,expires:now+180000}}, {merge:true});
    return origin;
  });
  if(!source)return;
  const items=[...(source.assets||[]).map(a=>{const asset=normalizeAsset(a,source.quotes);return [d("users",uid,"assets",asset.id),asset];}),...(source.history||[]).map(h=>[d("users",uid,"history",h.date),h])];
  for(let offset=0;offset<items.length;offset+=350) {
    await sdk.runTransaction(db,async tx=>{
      const profile=(await tx.get(root)).data();
      if(profile.migration?.token!==token)throw new Error("資料轉換狀態已變更，請重新登入");
      for(const [ref,payload] of items.slice(offset,offset+350))tx.set(ref,clean(payload));
      tx.update(root,{"migration.expires":Date.now()+180000});
    });
  }
  await sdk.runTransaction(db,async tx=>{
    const current=(await tx.get(root)).data();
    if(current.migration?.token!==token)throw new Error("資料轉換狀態已變更，請重新登入");
    tx.update(root,{schemaVersion:2,settings:{...DEFAULT_SETTINGS,...source.settings},quotes:source.quotes||null,migratedAt:new Date().toISOString(),migration:sdk.deleteField(),assets:sdk.deleteField(),history:sdk.deleteField()});
  });
}
export async function loadUser(user) {
  await migrate(user.uid);
  const [root,assets,history,published,strategyAccess]=await Promise.all([sdk.getDoc(d("users",user.uid)),sdk.getDocs(c("users",user.uid,"assets")),sdk.getDocs(c("users",user.uid,"history")),sdk.getDoc(d("sharedPortfolios",user.uid)),sdk.getDoc(d("strategyAccess",user.uid))]);
  return {settings:{...DEFAULT_SETTINGS,...root.data()?.settings},assets:assets.docs.filter(s=>!s.data().deleted).map(s=>({...s.data(),id:s.id})),history:history.docs.map(s=>s.data()).sort((a,b)=>a.date.localeCompare(b.date)),quotes:root.data()?.quotes||null,published:published.exists()?published.data():{ownerName:user.displayName||"",assets:[],viewerUids:[]},strategyAccess:strategyAccess.exists()?strategyAccess.data():{viewerUids:[]}};
}
export function listenUser(uid,handlers) {
  return [
    sdk.onSnapshot(c("users",uid,"assets"),s=>handlers.assets(s.docs.filter(x=>!x.data().deleted).map(x=>({...x.data(),id:x.id}))),handlers.error),
    sdk.onSnapshot(c("users",uid,"history"),s=>handlers.history(s.docs.map(x=>x.data()).sort((a,b)=>a.date.localeCompare(b.date))),handlers.error),
    sdk.onSnapshot(d("users",uid),s=>handlers.settings({...DEFAULT_SETTINGS,...s.data()?.settings}),handlers.error),
    sdk.onSnapshot(d("sharedPortfolios",uid),s=>handlers.published(s.exists()?s.data():{assets:[],viewerUids:[]}),handlers.error),
    sdk.onSnapshot(d("strategyAccess",uid),s=>handlers.strategyAccess(s.exists()?s.data():{viewerUids:[]}),handlers.error)
  ];
}

export async function saveAsset(uid,asset,expectedUpdatedAt=undefined) {
  const ref=d("users",uid,"assets",asset.id),sharedRef=d("sharedPortfolios",uid);
  return sdk.runTransaction(db,async tx=>{
    const [current,shared]=await Promise.all([tx.get(ref),tx.get(sharedRef)]);
    // Form edits touch holdings/cost only; the latest quote is read again inside the transaction.
    const before=current.data();
    if(expectedUpdatedAt!==undefined&&!current.exists())throw new Error("這筆持倉已在其他裝置刪除，請關閉表單後重新整理。");
    if(expectedUpdatedAt!==undefined&&expectedUpdatedAt!==(before?.updatedAt??null))throw new Error("這筆持倉已在其他裝置更新，請關閉表單後重新編輯。");
    const payload={...asset};
    if(before?.mode===asset.mode&&before?.symbol===asset.symbol&&before?.quote)payload.quote=before.quote;
    tx.set(ref,clean(payload));
    if(shared.exists()&&shared.data().assets.some(a=>a.id===asset.id))tx.update(sharedRef,{assets:shared.data().assets.map(a=>a.id===asset.id?sharedAsset(payload):a),updatedAt:new Date().toISOString()});
    return payload;
  });
}
export async function deleteAsset(uid,assetId) {
  await sdk.runTransaction(db,async tx=>{
    const sharedRef=d("sharedPortfolios",uid),shared=await tx.get(sharedRef);
    tx.delete(d("users",uid,"assets",assetId));
    if(shared.exists())tx.update(sharedRef,{assets:shared.data().assets.filter(a=>a.id!==assetId),updatedAt:new Date().toISOString()});
  });
}
export async function saveQuotes(uid,updates,fx=null) {
  const applied=[];
  // Read current holdings. Never write quantities or costs from a quote request's stale snapshot.
  for(let offset=0;offset<updates.length;offset+=100){
    const group=updates.slice(offset,offset+100);
    const groupApplied=await sdk.runTransaction(db,async tx=>{
      const sharedRef=d("sharedPortfolios",uid);
      const [shared,...snaps]=await Promise.all([tx.get(sharedRef),...group.map(u=>tx.get(d("users",uid,"assets",u.id)))]);
      const published=shared.exists()?structuredClone(shared.data().assets):null;
      const accepted=[];
      group.forEach((update,i)=>{
        const current=snaps[i].data();
        if(!current||current.mode==="manual"||String(current.quote?.lastAttemptAt||"")>update.quote.lastAttemptAt)return;
        // A symbol may have changed while the request was in flight.
        if(update.mode!==current.mode||update.symbol!==current.symbol)return;
        const payload={...current,quote:update.quote};
        tx.update(d("users",uid,"assets",update.id),{quote:clean(update.quote)});
        accepted.push(payload);
        const index=published?.findIndex(a=>a.id===update.id);if(index>=0)published[index]=sharedAsset(payload);
      });
      if(published)tx.update(sharedRef,{assets:clean(published),updatedAt:new Date().toISOString()});
      if(fx)tx.set(d("users",uid),{quotes:{fx:fx.rate,updated:fx.fetchedAt,fxAt:fx.asOf}}, {merge:true});
      return accepted;
    });
    applied.push(...groupApplied);
  }
  return applied;
}
export const saveSettings=(uid,settings)=>sdk.setDoc(d("users",uid),{settings:clean(settings)},{merge:true});
export async function snapshot(uid,date,total,overwrite=false) {
  await sdk.runTransaction(db,async tx=>{const ref=d("users",uid,"history",date),current=await tx.get(ref);if(overwrite||!current.exists())tx.set(ref,{date,total,recordedAt:new Date().toISOString()});});
}

export async function invite(uid,email,ownerName) {
  const normalized=email.trim().toLowerCase();
  const ref=d("shareInvites",crypto.randomUUID());
  await sdk.setDoc(ref,{ownerUid:uid,ownerName,recipientEmail:normalized,status:"pending",createdAt:new Date().toISOString()});
}
export async function invitations(user) {
  const [sent,received]=await Promise.all([
    sdk.getDocs(sdk.query(c("shareInvites"),sdk.where("ownerUid","==",user.uid))),
    sdk.getDocs(sdk.query(c("shareInvites"),sdk.where("recipientEmail","==",user.email.toLowerCase())))
  ]);
  return {sent:sent.docs.map(s=>({...s.data(),id:s.id})),received:received.docs.map(s=>({...s.data(),id:s.id}))};
}
export function listenInvitations(user,next,error) {
  let sent=[],received=[],sentLoaded=false,receivedLoaded=false;
  const emit=()=>{if(sentLoaded&&receivedLoaded)next({sent,received});};
  const map=snapshot=>snapshot.docs.map(item=>({...item.data(),id:item.id}));
  return [
    sdk.onSnapshot(sdk.query(c("shareInvites"),sdk.where("ownerUid","==",user.uid)),snapshot=>{sent=map(snapshot);sentLoaded=true;emit();},error),
    sdk.onSnapshot(sdk.query(c("shareInvites"),sdk.where("recipientEmail","==",user.email.toLowerCase())),snapshot=>{received=map(snapshot);receivedLoaded=true;emit();},error)
  ];
}
export async function acceptInvite(user,inviteId) {
  const ref=d("shareInvites",inviteId);
  await sdk.runTransaction(db,async tx=>{const snap=await tx.get(ref),i=snap.data();if(!i||i.status!=="pending"||i.recipientEmail!==user.email.toLowerCase())throw new Error("邀請已失效");tx.update(ref,{status:"accepted",viewerUid:user.uid,acceptedAt:new Date().toISOString()});});
}
export const removeInvite=inviteId=>sdk.deleteDoc(d("shareInvites",inviteId));
export async function publish(uid,ownerName,selectedIds,viewerUids,strategyViewerUids) {
  await sdk.runTransaction(db,async tx=>{
    const snaps=await Promise.all([...new Set(selectedIds)].map(assetId=>tx.get(d("users",uid,"assets",assetId))));
    const assets=snaps.filter(s=>s.exists()&&!s.data().deleted).map(s=>sharedAsset({...s.data(),id:s.id}));
    const updatedAt=new Date().toISOString();
    tx.set(d("sharedPortfolios",uid),{ownerName,viewerUids:[...new Set(viewerUids)],assets,updatedAt});
    tx.set(d("strategyAccess",uid),{ownerName,viewerUids:[...new Set(strategyViewerUids)],updatedAt});
  });
}
export async function friendPortfolios(uid) {
  const snap=await sdk.getDocs(sdk.query(c("sharedPortfolios"),sdk.where("viewerUids","array-contains",uid)));
  return snap.docs.map(s=>({...s.data(),id:s.id}));
}
export function listenFriends(uid,next,error) {
  let portfolios=[],access=[],portfoliosLoaded=false,accessLoaded=false;
  const emit=()=>{if(!portfoliosLoaded||!accessLoaded)return;const combined=new Map(access.map(a=>[a.id,{id:a.id,ownerName:a.ownerName,strategyAccess:true,strategyViewerUids:a.viewerUids||[],assets:[],portfolioAccess:false}]));for(const p of portfolios)combined.set(p.id,{...combined.get(p.id),...p,portfolioAccess:true});next([...combined.values()]);};
  return [
    sdk.onSnapshot(sdk.query(c("sharedPortfolios"),sdk.where("viewerUids","array-contains",uid)),s=>{portfolios=s.docs.map(x=>({...x.data(),id:x.id}));portfoliosLoaded=true;emit();},error),
    sdk.onSnapshot(sdk.query(c("strategyAccess"),sdk.where("viewerUids","array-contains",uid)),s=>{access=s.docs.map(x=>({...x.data(),id:x.id}));accessLoaded=true;emit();},error)
  ];
}
export async function revoke(uid,viewerUid) {
  await sdk.runTransaction(db,async tx=>{
    const refs=[d("sharedPortfolios",uid),d("strategyAccess",uid)],snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
    snaps.forEach((snap,i)=>{if(snap.exists())tx.update(refs[i],{viewerUids:snap.data().viewerUids.filter(v=>v!==viewerUid),updatedAt:new Date().toISOString()});});
  });
}
// Restricted posts have a separate collection so a legacy published-post query
// never exposes them, and existing all-audience strategies keep working.
async function currentStrategy(ownerUid,postId,read=ref=>sdk.getDocFromServer(ref)){
  const selected=d("selectedStrategies",ownerUid,"posts",postId),snapshot=await read(selected);
  if(snapshot.exists())return {ref:selected,snapshot};
  const legacy=d("strategies",ownerUid,"posts",postId);
  return {ref:legacy,snapshot:await read(legacy)};
}
export function listenStrategyParticipation(ownerUid,postId,next,error){
  const ref=c("strategyParticipation",ownerUid,"posts",postId,"members");
  return sdk.onSnapshot(ref,snapshot=>next(snapshot.docs.map(item=>({...item.data(),uid:item.id}))),error);
}
export async function saveStrategyParticipation(user,ownerUid,postId,choice,_strategyUpdatedAt){
  if(!["participating","not-participating"].includes(choice))throw new Error("參與狀態無效。");
  const memberRef=d("strategyParticipation",ownerUid,"posts",postId,"members",user.uid);
  let phase="read",revision;
  for(let attempt=0;attempt<2;attempt++)try {
    return await sdk.runTransaction(db,async tx=>{
      phase="read";
      const {snapshot}=await currentStrategy(ownerUid,postId,ref=>tx.get(ref));
      if(!snapshot.exists())throw new Error("這份策略已刪除，無法設定參與狀態。");
      const post=snapshot.data();
      if(post.published!==true)throw new Error("這份策略已停止分享，無法設定參與狀態。");
      if(typeof post.updatedAt!=="string")throw new Error("策略版本資料不完整，請作者重新儲存策略後再試。");
      // A participation choice survives edits; never submit a cached page revision.
      revision=post.updatedAt;
      const entry={choice,strategyUpdatedAt:post.updatedAt,displayName:user.displayName||"使用者",photoURL:user.photoURL||"",updatedAt:new Date().toISOString()};
      phase="write";
      tx.set(memberRef,entry);
      return {post:{...post,id:postId},entry:{...entry,uid:user.uid}};
    });
  } catch(error) {
    if(error?.code!=="permission-denied")throw error;
    if(phase==="write"&&attempt===0){
      // Rules may reject a changed revision before the transaction conflict is
      // retried by the SDK. Retry once only after confirming a newer readable post.
      let current;
      try{current=(await currentStrategy(ownerUid,postId)).snapshot;}catch(readError){if(readError?.code!=="permission-denied")throw readError;error=readError;phase="read";}
      if(current){
        if(!current.exists())throw new Error("這份策略已刪除，無法設定參與狀態。");
        const latest=current.data();
        if(latest.published!==true)throw new Error("這份策略已停止分享，無法設定參與狀態。");
        if(typeof latest.updatedAt==="string"&&latest.updatedAt!==revision)continue;
      }
    }
    const failure=new Error(phase==="read"?"無法讀取這份策略。請重新整理共享頁，確認登入及策略授權仍有效。":"參與狀態未儲存：策略參與權限被拒絕。請重新整理後再試。",{cause:error});
    failure.code=error.code;failure.userMessage=failure.message;failure.operation="strategy-participation-"+phase;
    throw failure;
  }
}
export async function strategies(ownerUid,own=false) {
  const [legacy,selected]=await Promise.all(strategyQueries(ownerUid,own).map(ref=>sdk.getDocs(ref)));
  return mergeStrategies(legacy,selected);
}
function strategyQueries(ownerUid,own){
  const legacy=c("strategies",ownerUid,"posts"),selected=c("selectedStrategies",ownerUid,"posts");
  return own?[legacy,selected]:[sdk.query(legacy,sdk.where("published","==",true)),sdk.query(selected,sdk.where("viewerUids","array-contains",auth.currentUser.uid))];
}
function mergeStrategies(legacy,selected){
  const posts=new Map();
  for(const snap of [legacy,selected])for(const item of snap?.docs||[])posts.set(item.id,{...item.data(),id:item.id});
  return [...posts.values()];
}
export function listenStrategies(ownerUid,own,next,error){
  const snapshots=[null,null];let active=true,dirty=false;
  const emit=()=>{if(active&&dirty&&snapshots.every(Boolean)){dirty=false;next(mergeStrategies(...snapshots));}};
  const synchronized=typeof sdk.onSnapshotsInSync==="function",stopSync=synchronized?sdk.onSnapshotsInSync(db,emit):null;
  const off=strategyQueries(ownerUid,own).map((ref,index)=>sdk.onSnapshot(ref,value=>{if(!active)return;snapshots[index]=value;dirty=true;if(!synchronized)emit();},failure=>{if(active)error(failure);}));
  return ()=>{active=false;stopSync?.();off.forEach(stop=>stop());};
}
export async function saveStrategy(uid,post,expectedUpdatedAt=undefined) {
  return sdk.runTransaction(db,async tx=>{
    const legacy=d("strategies",uid,"posts",post.id),selected=d("selectedStrategies",uid,"posts",post.id);
    const [old,current,access]=await Promise.all([tx.get(legacy),tx.get(selected),tx.get(d("strategyAccess",uid))]);
    const before=current.exists()?current.data():old.data();
    if(expectedUpdatedAt!==undefined&&(!before||before.updatedAt!==expectedUpdatedAt))throw new Error("這份策略已在其他裝置更新或刪除，請重新開啟編輯。");
    // Backups import as private legacy drafts, with no sharing permissions.
    if(!Object.hasOwn(post,"audienceUids")){
      if(current.exists())throw new Error("請更新 App 後再編輯這份策略。");
      tx.set(legacy,clean(post));return post;
    }
    const authorized=access.data()?.viewerUids||[],audienceUids=[...new Set(post.audienceUids)].filter(value=>typeof value==="string"&&authorized.includes(value)&&value!==uid);
    if(post.audienceUids.some(value=>!authorized.includes(value)))throw new Error("策略授權名單已更新，請重新選擇分享對象。");
    if(post.published&&!audienceUids.length)throw new Error("請至少選擇一位策略分享對象，或儲存為私人草稿。");
    const saved=clean({...post,audienceUids,viewerUids:post.published?audienceUids:[]});
    tx.set(selected,saved);
    if(old.exists())tx.delete(legacy);
    return saved;
  });
}
export async function deleteStrategy(uid,postId){
  await sdk.runTransaction(db,async tx=>{tx.delete(d("strategies",uid,"posts",postId));tx.delete(d("selectedStrategies",uid,"posts",postId));});
}
export function listenStrategyReads(ownerUid,postId,userUid,next,error){
  const path=["strategyReads",ownerUid,"posts",postId,"members"];
  return userUid===ownerUid?sdk.onSnapshot(c(...path),snapshot=>next(snapshot.docs.map(item=>({...item.data(),uid:item.id}))),error):sdk.onSnapshot(d(...path,userUid),snapshot=>next(snapshot.exists()?[{...snapshot.data(),uid:userUid}]:[]),error);
}
export async function markStrategyRead(user,ownerUid,postId,expectedUpdatedAt){
  try{return await sdk.runTransaction(db,async tx=>{
    const {snapshot}=await currentStrategy(ownerUid,postId,ref=>tx.get(ref));
    if(!snapshot.exists()||snapshot.data().published!==true)throw new Error("這份策略已刪除或停止分享。");
    const post={...snapshot.data(),id:postId};
    if(typeof expectedUpdatedAt!=="string"||post.updatedAt!==expectedUpdatedAt){const error=new Error("策略剛剛已更新，請閱讀最新內容後再按已讀。");error.latestPost=post;throw error;}
    const entry={strategyUpdatedAt:post.updatedAt,displayName:(user.displayName||"使用者").slice(0,80),photoURL:user.photoURL||"",readAt:new Date().toISOString()};
    tx.set(d("strategyReads",ownerUid,"posts",postId,"members",user.uid),entry);
    return {...entry,uid:user.uid};
  });}catch(error){if(error?.code!=="permission-denied")throw error;const failure=new Error("已讀狀態未儲存：這份策略可能已更新或撤回分享，請重新開啟確認。",{cause:error});failure.code=error.code;failure.userMessage=failure.message;throw failure;}
}
export async function adminUsers() {const snap=await sdk.getDocs(c("access"));return snap.docs.map(s=>({...s.data(),id:s.id}));}
export const setAccess=(uid,status)=>sdk.setDoc(d("access",uid),{status},{merge:true});

export const loadReview=(uid,postId)=>reviewRepository(sdk,db).load(uid,postId);
export const startReview=(uid,postId,voters,deadline,roundId)=>reviewRepository(sdk,db).start(uid,postId,voters,deadline,roundId);
export const voteReview=(ownerUid,postId,roundId,uid,choice,reason,profile)=>reviewRepository(sdk,db).vote(ownerUid,postId,roundId,uid,choice,reason,profile);
export const reviewHistory=(uid,postId)=>reviewRepository(sdk,db).history(uid,postId);
export const submitTeacherStrategy=(uid,postId,profile,reason)=>reviewRepository(sdk,db).submitTeacher(uid,postId,profile,reason);
export const teacherStrategyDecision=(ownerUid,postId,decision,profile,reason)=>reviewRepository(sdk,db).decideTeacher(ownerUid,postId,decision,profile,reason);

