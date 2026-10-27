/**
 * SC-015: conservative stale-claim reconciliation.
 * Deliberately never resumes a partial PDF job or replays external AI work.
 * An operator must inspect the record and explicitly retry eligible failures.
 */
import {z} from 'zod';
import {Database} from './database';
import {HttpError} from './http';

const activeStates=['FETCHING','QUARANTINED','SCANNING','EXTRACTING'] as const;
export function recoveryDisposition(state:string,ageMinutes:number):'IGNORE'|'MANUAL_REVIEW'{
 if(!activeStates.includes(state as typeof activeStates[number])||
  !Number.isFinite(ageMinutes)||ageMinutes<30)return 'IGNORE';
 return 'MANUAL_REVIEW';
}
export type RecoveryEnv={SMART_CAPTURE_ENABLED?:string;SMART_CAPTURE_PROCESSING_ENABLED?:string};
export async function reconcileStaleSmartCaptureImports(
 db:Database,actor:string,projectId:string,env:RecoveryEnv
){
 if(env.SMART_CAPTURE_ENABLED!=='true'||env.SMART_CAPTURE_PROCESSING_ENABLED!=='true')
  throw new HttpError(503,'SMART_CAPTURE_PROCESSING_DISABLED');
 const project=z.string().uuid().parse(projectId);
 // Bounded, project-scoped operation; never runs automatically on live data.
 const [rows]=await db.forActor(actor,[{query:`
  WITH candidates AS (
   SELECT i.id FROM public.smart_capture_imports i
   WHERE i.project_id=$1 AND i.state IN ('FETCHING','QUARANTINED','SCANNING','EXTRACTING')
    AND i.claimed_at<now()-interval '30 minutes'
    AND EXISTS(SELECT 1 FROM public.project_memberships m
     WHERE m.project_id=i.project_id AND m.user_id=$2 AND m.active
      AND m.role IN ('ADMIN','MANAGER'))
   ORDER BY i.claimed_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.smart_capture_imports i
  SET state='FAILED',error_code='STALE_CLAIM_REQUIRES_REVIEW',
   claimed_at=NULL,claimed_by=NULL,updated_at=now()
  FROM candidates c WHERE i.id=c.id AND i.project_id=$1
  RETURNING i.id`,params:[project,actor]}]);
 return {markedForReview:rows.length,importIds:rows.map(r=>String(r.id)),
  note:'No PDF was retried; stale jobs require manual investigation'};
}
