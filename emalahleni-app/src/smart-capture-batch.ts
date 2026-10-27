/**
 * Deterministic, bounded operator batch selection.
 * This is not an unattended job runner; callers must reauthorise every
 * import and use the existing atomic process claim for each item.
 */
export type BatchCandidate={id:string;state:string;attemptCount:number;createdAt:string};
export function selectSmartCaptureBatch(candidates:readonly BatchCandidate[],max=5):string[]{
 if(!Number.isSafeInteger(max)||max<1||max>10)throw new Error('BATCH_LIMIT_INVALID');
 const seen=new Set<string>();
 return [...candidates].filter(item=>{
  if(item.state!=='DISCOVERED'||!Number.isSafeInteger(item.attemptCount)||item.attemptCount>=3)return false;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))return false;
  if(seen.has(item.id))return false;
  seen.add(item.id);return true;
 }).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))
 .slice(0,max).map(item=>item.id);
}
