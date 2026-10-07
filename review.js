// Additive strategy review policy. Existing strategy content and status remain unchanged.
export function reviewState(round,post,viewers,now=Date.now()){
  if(!round)return {state:'none',agree:0,reject:0,pending:0,total:0};
  const voters=round.voterUids||[],choices=round.choices||{};
  const agree=voters.filter(uid=>choices[uid]==='agree').length,reject=voters.filter(uid=>choices[uid]==='reject').length;
  const counts={agree,reject,pending:voters.length-agree-reject,total:voters.length};
  if(!post?.published)return {...counts,state:'private'};
  if(round.strategyUpdatedAt!==post.updatedAt)return {...counts,state:'changed'};
  if(!voters.length||voters.some(uid=>!viewers.includes(uid)))return {...counts,state:'revoked'};
  if(round.adoptedMs)return {...counts,state:'adopted'};
  if(now>=round.deadlineMs)return {...counts,state:'expired'};
  if(reject)return {...counts,state:'rejected'};
  return {...counts,state:agree===voters.length?'approved':'pending'};
}
export function createReview(post,voterUids,viewers,deadlineMs,roundId,now=Date.now()){
  if(!post?.published)throw new Error('請先用原本的分享功能發布策略，再送審。');
  const voters=[...new Set(voterUids)];
  if(!voters.length||voters.length>20)throw new Error('請指定 1～20 位審核成員。');
  if(voters.some(uid=>uid===post.ownerUid||!viewers.includes(uid)))throw new Error('審核成員必須已取得策略授權，作者不能代替成員投票。');
  if(!Number.isFinite(deadlineMs)||deadlineMs<=now||deadlineMs>now+30*86400000)throw new Error('請設定未來 30 天內的審核截止時間。');
  return {roundId,strategyUpdatedAt:post.updatedAt,voterUids:voters,deadlineMs,createdMs:now,choices:{},reasons:{},adoptedMs:0};
}
export function castReviewVote(round,post,viewers,uid,choice,reason='',now=Date.now()){
  const state=reviewState(round,post,viewers,now).state;
  if(!['pending','approved','rejected'].includes(state))throw new Error('本輪審核已失效、截止或已採用，請重新整理。');
  if(!round.voterUids.includes(uid))throw new Error('你不是本輪指定的審核成員。');
  if(!['agree','reject'].includes(choice))throw new Error('請選擇同意或否決。');
  const text=String(reason).trim();
  if(text.length>500)throw new Error('投票理由最多 500 字。');
  if(choice==='reject'&&!text)throw new Error('否決時請說明理由，方便作者修改。');
  return {...round,choices:{...round.choices,[uid]:choice},reasons:{...round.reasons,[uid]:text}};
}
export function adoptReview(round,post,viewers,uid,now=Date.now()){
  if(uid!==post.ownerUid)throw new Error('只有策略作者可以標記採用。');
  if(reviewState(round,post,viewers,now).state!=='approved')throw new Error('必須在截止前取得全員同意，才可標記採用。');
  return {...round,adoptedMs:now};
}
