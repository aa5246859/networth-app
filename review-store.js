import {createReview,castReviewVote,adoptReview} from './review.js';
// Use the app's already authenticated SDK; do not create a second auth session.
export function reviewRepository(sdk,db){
  const doc=(...p)=>sdk.doc(db,...p),head=(uid,id)=>doc('strategyReviews',uid,'posts',id),round=(uid,id,r)=>doc('strategyReviews',uid,'posts',id,'rounds',r);
  async function context(tx,uid,id){const [post,access]=await Promise.all([tx.get(doc('strategies',uid,'posts',id)),tx.get(doc('strategyAccess',uid))]);if(!post.exists())throw new Error('策略已刪除。');return {post:post.data(),viewers:access.data()?.viewerUids||[]};}
  return {
    async load(uid,id){const h=await sdk.getDoc(head(uid,id));if(!h.exists())return null;const [r,a]=await Promise.all([sdk.getDoc(round(uid,id,h.data().roundId)),sdk.getDoc(doc('strategyAccess',uid))]);return r.exists()?{...r.data(),currentViewers:a.data()?.viewerUids||[]}:null;},
    async start(uid,id,voters,deadlineMs,roundId){return sdk.runTransaction(db,async tx=>{const c=await context(tx,uid,id);const r=createReview(c.post,voters,c.viewers,deadlineMs,roundId);await tx.get(head(uid,id));tx.set(round(uid,id,roundId),r);tx.set(head(uid,id),{roundId,strategyUpdatedAt:c.post.updatedAt});return {...r,currentViewers:c.viewers};});},
    async vote(ownerUid,id,roundId,uid,choice,reason){return sdk.runTransaction(db,async tx=>{const c=await context(tx,ownerUid,id);const [h,r]=await Promise.all([tx.get(head(ownerUid,id)),tx.get(round(ownerUid,id,roundId))]);if(h.data()?.roundId!==roundId||!r.exists())throw new Error('本輪審核已被新版取代，請重新整理。');const next=castReviewVote(r.data(),c.post,c.viewers,uid,choice,reason);tx.update(round(ownerUid,id,roundId),{choices:next.choices,reasons:next.reasons});return {...next,currentViewers:c.viewers};});},
    async adopt(ownerUid,id,roundId,uid){return sdk.runTransaction(db,async tx=>{const c=await context(tx,ownerUid,id);const [h,r]=await Promise.all([tx.get(head(ownerUid,id)),tx.get(round(ownerUid,id,roundId))]);if(h.data()?.roundId!==roundId||!r.exists())throw new Error('本輪審核已被新版取代，請重新整理。');const next=adoptReview(r.data(),c.post,c.viewers,uid);tx.update(round(ownerUid,id,roundId),{adoptedMs:next.adoptedMs});return {...next,currentViewers:c.viewers};});},
    async history(uid,id){const result=await sdk.getDocs(sdk.collection(db,'strategyReviews',uid,'posts',id,'rounds'));return result.docs.map(x=>x.data()).sort((a,b)=>b.createdMs-a.createdMs);}
  };
}
