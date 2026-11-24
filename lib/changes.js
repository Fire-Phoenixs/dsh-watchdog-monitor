import {randomUUID} from 'node:crypto';
const states=new Set(['OK','FAIL','STALE','UNKNOWN']);
export function recordChanges(previous,next,history=[]){
  const before=new Map((previous?.items||[]).map(item=>[item.id,item]));
  const added=[];
  for(const item of next.items){
    const old=before.get(item.id);
    if(!old||!states.has(old.status)||!states.has(item.status)||old.status===item.status)continue;
    // Configuration edits and task identity changes are not execution transitions.
    if(old.kind!==item.kind||old.target!==item.target||old.hostId!==item.hostId)continue;
    const kind=item.status==='OK'?(old.status==='UNKNOWN'?'verified':'recovered'):item.status==='FAIL'?'failed':item.status==='STALE'?'stale':'unknown';
    added.push({id:randomUUID(),itemId:item.id,name:item.name,hostId:item.hostId,from:old.status,to:item.status,kind,at:next.collectedAt,reason:String(item.reason||'').slice(0,500)});
  }
  return [...added,...history].slice(0,100);
}
