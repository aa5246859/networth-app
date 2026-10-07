// Additive strategy vote and teacher-decision policy. Existing strategy content and status remain unchanged.
export function reviewState(round,post,viewers,now=Date.now()){
  if(!round?.roundId)return {state:'none',agree:0,reject:0,pending:0,total:0};
  const voters=round.voterUids||[],choices=round.choices||{};
  const agree=voters.filter(uid=>choices[uid]==='agree').length,reject=voters.filter(uid=>choices[uid]==='reject').length;
  const counts={agree,reject,pending:voters.length-agree-reject,total:voters.length};
  if(!post?.published)return {...counts,state:'private'};
  if(round.strategyUpdatedAt!==post.updatedAt)return {...counts,state:'changed'};
  if(!voters.length||voters.some(uid=>!viewers.includes(uid)))return {...counts,state:'revoked'};
  if(round.adoptedMs)return {...counts,state:'adopted'};
  if(now>=round.deadlineMs)return {...counts,state:agree>reject?'approved':reject>agree?'rejected':'tie'};
  return {...counts,state:'voting'};
}
export function createReview(post,voterUids,viewers,deadlineMs,roundId,now=Date.now()){
  if(!post?.published)throw new Error('請先用原本的分享功能發布策略，再送審。');
  const voters=[...new Set(voterUids)];
  if(!voters.length||voters.length>100)throw new Error('策略授權名單需有 1～100 位投票成員。');
  if(voters.some(uid=>uid===post.ownerUid||!viewers.includes(uid)))throw new Error('投票成員必須已取得策略授權，作者不能代替成員投票。');
  if(!Number.isFinite(deadlineMs)||deadlineMs<=now||deadlineMs>now+30*86400000)throw new Error('請設定未來 30 天內的審核截止時間。');
  return {roundId,strategyUpdatedAt:post.updatedAt,voterUids:voters,deadlineMs,createdMs:now,choices:{},reasons:{},voterProfiles:{},adoptedMs:0};
}
export function castReviewVote(round,post,viewers,uid,choice,reason='',profile={},now=Date.now()){
  const state=reviewState(round,post,viewers,now).state;
  if(!['voting'].includes(state))throw new Error('本輪投票已失效、截止或已採用，請重新整理。');
  if(!round.voterUids.includes(uid))throw new Error('你不是本輪指定的審核成員。');
  if(!['agree','reject'].includes(choice))throw new Error('請選擇同意或否決。');
  const text=String(reason).trim();
  if(text.length>500)throw new Error('投票理由最多 500 字。');
  const voterProfile={displayName:String(profile.displayName||'').slice(0,80),photoURL:String(profile.photoURL||'').slice(0,500)};
  return {...round,choices:{...round.choices,[uid]:choice},reasons:{...round.reasons,[uid]:text},voterProfiles:{...(round.voterProfiles||{}),[uid]:voterProfile}};
}
export function teacherDecisionState(decision,post){
  if(!decision)return 'none';
  if(decision.strategyUpdatedAt!==post.updatedAt)return 'outdated';
  return decision.decision==='pending'?'pending':decision.decision==='approved'?'approved':'returned';
}
