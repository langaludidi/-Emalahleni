import type {Database} from './database';
import {decryptForm} from './crypto';
import {formSchema} from './contracts';
import {compareIdReading} from './evidence-consistency';
import {readIdDocument,type IdReadingEnv} from './id-document';
import {HttpError} from './http';

// All state comparisons run server-side against the saved, encrypted form.
// Neither OCR output nor identity field values enter the persistence table.
export async function recordIdConsistency(db:Database,actor:string,project:string,application:string,evidenceId:string,env:IdReadingEnv&{FORM_ENCRYPTION_KEY?:string}){
 if(!env.FORM_ENCRYPTION_KEY)throw new HttpError(503,'CASE_API_NOT_CONFIGURED');
 const [cases]=await db.forActor(actor,[{query:'SELECT fields_ciphertext,version FROM public.applications WHERE project_id=$1 AND id=$2',params:[project,application]}],true);
 if(!cases.length)throw new HttpError(404,'NOT_FOUND');
 const form=formSchema.parse(await decryptForm(cases[0].fields_ciphertext,env.FORM_ENCRYPTION_KEY,project,application));
 const reading=await readIdDocument(db,actor,project,application,evidenceId,env);
 const findings=compareIdReading(reading,form.applicant);
 const [saved]=await db.forActor(actor,[{query:`WITH valid AS MATERIALIZED (
   SELECT a.id FROM public.applications a JOIN public.evidence e ON e.application_id=a.id AND e.project_id=a.project_id
   JOIN public.project_memberships m ON m.project_id=a.project_id AND m.user_id=current_setting('app.actor_id',true) AND m.active
   WHERE a.project_id=$1 AND a.id=$2 AND a.version=$3 AND e.id=$4 AND e.sha256=$5
     AND e.kind='APPLICANT_ID' AND e.malware_status='CLEAN' AND e.status IN ('PENDING_REVIEW','VERIFIED')
     AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER') FOR SHARE OF a,e
 ), inserted AS (
   INSERT INTO public.evidence_consistency_findings(id,project_id,application_id,evidence_id,source_sha256,form_version,field,state,method,recorded_by)
   SELECT gen_random_uuid(),$1,$2,$4,$5,$3,v.field,v.state,'SCANNER_OCR_LABELLED_ID_V1',$6
   FROM valid, jsonb_to_recordset($7::jsonb) AS v(field text,state text)
   ON CONFLICT (project_id,application_id,evidence_id,source_sha256,form_version,field) DO NOTHING
   RETURNING id
 ) SELECT (SELECT count(*) FROM valid)::int AS eligible`,params:[project,application,cases[0].version,evidenceId,reading.sha256,actor,JSON.stringify(findings.map(f=>({field:f.field,state:f.state})))]}]);
 if(saved[0]?.eligible!==1)throw new HttpError(409,'CONSISTENCY_SOURCE_CHANGED');
 return {formVersion:cases[0].version,findings};
}

export async function listIdConsistency(db:Database,actor:string,project:string,application:string){
 const [rows]=await db.forActor(actor,[{query:`SELECT f.evidence_id,f.source_sha256,f.form_version,f.field,f.state,f.method,f.recorded_at,
   (a.version=f.form_version AND e.sha256=f.source_sha256 AND e.malware_status='CLEAN' AND e.status IN ('PENDING_REVIEW','VERIFIED')) AS current
   FROM public.evidence_consistency_findings f
   JOIN public.applications a ON a.project_id=f.project_id AND a.id=f.application_id
   JOIN public.evidence e ON e.project_id=f.project_id AND e.application_id=f.application_id AND e.id=f.evidence_id
   WHERE f.project_id=$1 AND f.application_id=$2 ORDER BY f.recorded_at DESC LIMIT 100`,params:[project,application]}],true);
 return {findings:rows};
}
