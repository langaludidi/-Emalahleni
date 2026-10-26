import {z} from 'zod';
import {Database} from './database';
import {dohsSections} from './contracts';
import {HttpError} from './http';

const inputSchema=z.object({formVersion:z.number().int().min(0),state:z.enum(['PENDING','COMPLETE','RETURNED']),note:z.string().trim().min(10).max(500),expectedReviewedAt:z.iso.datetime({offset:true}).nullable().default(null)}).strict();
export async function reviewDepartment(db:Database,actor:string,project:string,application:string,sectionValue:string,input:unknown){
 const section=z.enum(dohsSections).parse(sectionValue),v=inputSchema.parse(input);
 const [membership]=await db.forActor(actor,[{query:"SELECT 1 FROM public.project_memberships WHERE project_id=$1 AND user_id=$2 AND active AND role='DOHS_REVIEWER'",params:[project,actor]}]);
 if(!membership.length)throw new HttpError(403,'DEPARTMENT_REVIEW_DENIED');
 // Lock the checked form before writing the decision. A concurrent draft save
 // either precedes this version check or waits until this review commits.
 const [rows]=await db.forActor(actor,[{query:`WITH context AS MATERIALIZED (
   SELECT a.version FROM public.applications a WHERE a.project_id=$1 AND a.id=$2 AND a.version=$8 FOR SHARE
 ), reviewed AS (
   INSERT INTO public.dohs_section_reviews (project_id,application_id,section,state,note,reviewed_by,reviewed_at,reviewed_form_version)
   SELECT $1,$2,$3,$4,$5,$6,now(),$8 FROM context
   WHERE EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=$1 AND m.user_id=$6 AND m.active AND m.role='DOHS_REVIEWER')
   ON CONFLICT (application_id,section) DO UPDATE SET state=EXCLUDED.state,note=EXCLUDED.note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),reviewed_form_version=EXCLUDED.reviewed_form_version
   WHERE dohs_section_reviews.reviewed_at=$7::timestamptz
   RETURNING section,state,reviewed_form_version,to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed_at
 ), audited AS (
   INSERT INTO public.audit_events (project_id,actor_id,action,metadata)
   SELECT $1,$6,'DOHS_SECTION_REVIEWED',jsonb_build_object('applicationId',$2::text,'section',section,'state',state,'formVersion',reviewed_form_version) FROM reviewed
 ) SELECT * FROM reviewed`,params:[project,application,section,v.state,v.note,actor,v.expectedReviewedAt,v.formVersion]}]);
 if(!rows.length)throw new HttpError(409,'DEPARTMENT_REVIEW_CHANGED_OR_UNAVAILABLE');
 return rows[0];
}
