/**
 * SC-026: read-only inventory of abandoned attempt-specific R2 quarantine objects.
 * This module deliberately does not delete objects. An operator must review the
 * inventory and approved retention policy before any separate purge implementation.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError} from './http';
import {validSmartCaptureQuarantineKey} from './smart-capture-storage';

export type OrphanInventoryEnv={
 SMART_CAPTURE_ENABLED?:string;
 SMART_CAPTURE_PROCESSING_ENABLED?:string;
 EVIDENCE_BUCKET?:R2Bucket;
};
const uuid=z.string().uuid();
export async function inventorySmartCaptureOrphans(
 db:Database,actor:string,projectId:string,env:OrphanInventoryEnv
){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true'||!env.EVIDENCE_BUCKET)
  throw new HttpError(503,'SMART_CAPTURE_PROCESSING_DISABLED');
 const project=uuid.parse(projectId);
 const [membership]=await db.forActor(actor,[{query:`SELECT role FROM public.project_memberships
  WHERE project_id=$1 AND user_id=$2 AND active AND role IN ('ADMIN','MANAGER')`,
  params:[project,actor]}],true);
 if(!membership.length)throw new HttpError(403,'SMART_CAPTURE_ORPHAN_INVENTORY_DENIED');
 // Limit enumeration to a single page; a cursor is not returned to clients
 // because object names must remain private and are not a public API.
 const prefix=`smart-capture/quarantine/${project}/`;
 const listed=await env.EVIDENCE_BUCKET.list({prefix,limit:100});
 const objects=listed.objects;
 const keys=objects.map(object=>object.key);
 const importIds=[...new Set(keys.map(key=>key.slice(prefix.length).split('/')[0])
  .filter(id=>uuid.safeParse(id).success))];
 const [imports]=importIds.length?await db.forActor(actor,[{query:`
  SELECT id,storage_key,state FROM public.smart_capture_imports
  WHERE project_id=$1 AND id=ANY($2::uuid[])`,params:[project,importIds]}],true):[[]];
 const active=new Map(imports.map(row=>[String(row.id),{key:String(row.storage_key??''),state:String(row.state)}]));
 let retained=0,orphanCandidates=0,invalid=0,tooRecent=0;
 const now=Date.now();
 const MIN_AGE_MS=24*60*60*1000;
 for(const object of objects){
  const key=object.key;
  const id=key.slice(prefix.length).split('/')[0];
  if(!uuid.safeParse(id).success||!validSmartCaptureQuarantineKey(key,project,id)){invalid++;continue;}
  const match=active.get(id);
  if(match?.key===key){retained++;continue;}
  // R2 listing timestamps are mandatory for candidate classification.
  // Never recommend an object for cleanup while it may still be in flight.
  const uploaded=object.uploaded instanceof Date?object.uploaded.getTime():NaN;
  if(!Number.isFinite(uploaded)||now-uploaded<MIN_AGE_MS){tooRecent++;continue;}
  orphanCandidates++;
 }
 return {projectId:project,scanned:keys.length,retained,orphanCandidates,invalid,tooRecent,
  truncated:listed.truncated,
  note:'Read-only inventory; candidates are not deletion-authorised. Candidates are at least 24h old; still review retention, legal holds and active workers before purge.'};
}
