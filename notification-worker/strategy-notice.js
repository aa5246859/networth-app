// Read only the saved Firestore result; notification callers cannot supply it.
export function strategyNotificationContent(post){
  const text=key=>post.fields?.[key]?.stringValue||"";
  const closed=text("status")==="closed",outcome=post.fields?.completion?.mapValue?.fields?.outcome?.stringValue;
  const result={profit:"獲利",loss:"虧損",flat:"損益兩平"}[outcome];
  return {title:closed?"策略已結單"+(result?" · "+result:""):"交易策略更新",body:text("title")+" · "+text("symbol")};
}
