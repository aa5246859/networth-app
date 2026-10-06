import {FIREBASE_CONFIG,ADMIN_EMAIL,DEFAULT_SETTINGS} from "./config.js";
import {normalizeAsset,sharedAsset} from "./core.js";
let sdk,db,auth;
export async function connect() {
  const [appModule,authModule,firestoreModule]=await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);
  sdk={...appModule,...authModule,...firestoreModule};
  const app=sdk.getApps()[0]||sdk.initializeApp(FIREBASE_CONFIG);auth=sdk.getAuth(app);db=sdk.getFirestore(app);
  sdk.getRedirectResult(auth).catch(()=>{});
  return sdk.onAuthStateChanged;
}
export const watchAuth=handler=>sdk.onAuthStateChanged(auth,handler);
export const logout=()=>sdk.signOut(auth);
export async function login() {
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
  let portfolios=[],access=[];
  const emit=()=>{const combined=new Map(access.map(a=>[a.id,{id:a.id,ownerName:a.ownerName,strategyAccess:true,assets:[],portfolioAccess:false}]));for(const p of portfolios)combined.set(p.id,{...combined.get(p.id),...p,portfolioAccess:true});next([...combined.values()]);};
  return [
    sdk.onSnapshot(sdk.query(c("sharedPortfolios"),sdk.where("viewerUids","array-contains",uid)),s=>{portfolios=s.docs.map(x=>({...x.data(),id:x.id}));emit();},error),
    sdk.onSnapshot(sdk.query(c("strategyAccess"),sdk.where("viewerUids","array-contains",uid)),s=>{access=s.docs.map(x=>({...x.data(),id:x.id}));emit();},error)
  ];
}
export async function revoke(uid,viewerUid) {
  await sdk.runTransaction(db,async tx=>{
    const refs=[d("sharedPortfolios",uid),d("strategyAccess",uid)],snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
    snaps.forEach((snap,i)=>{if(snap.exists())tx.update(refs[i],{viewerUids:snap.data().viewerUids.filter(v=>v!==viewerUid),updatedAt:new Date().toISOString()});});
  });
}
export async function strategies(ownerUid,own=false) {
  const ref=c("strategies",ownerUid,"posts");
  const snap=await sdk.getDocs(own?ref:sdk.query(ref,sdk.where("published","==",true)));return snap.docs.map(s=>({...s.data(),id:s.id}));
}
export async function saveStrategy(uid,post) {
  await sdk.setDoc(d("strategies",uid,"posts",post.id),clean(post));
}
export const deleteStrategy=(uid,postId)=>sdk.deleteDoc(d("strategies",uid,"posts",postId));
export async function adminUsers() {const snap=await sdk.getDocs(c("access"));return snap.docs.map(s=>({...s.data(),id:s.id}));}
export const setAccess=(uid,status)=>sdk.setDoc(d("access",uid),{status},{merge:true});
