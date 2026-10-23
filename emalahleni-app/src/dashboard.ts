import type {Database} from './database';
import {HttpError} from './http';

export type DashboardCase = {id:string;reference:string;version:number;workflow_status:string;updated_at:string};
export type ProjectDashboard = {
  generatedAt:string;
  applications:{total:number;draft:number;awaitingAssessment:number;returned:number;assessmentComplete:number};
  evidence:{total:number;pendingUpload:number;pendingScan:number;scanFailed:number;infected:number;awaitingReview:number;verified:number;rejected:number};
  recent:DashboardCase[];
};

// Aggregate metadata only. Actor context, membership and RLS apply to every
// query; no identity fields, ciphertext or document contents reach the dashboard.
export async function projectDashboard(db:Database,actor:string,project:string):Promise<ProjectDashboard> {
  const [memberships,applications,evidence,recent]=await db.forActor(actor,[
    {query:'SELECT 1 FROM public.project_memberships WHERE project_id=$1 AND user_id=$2 AND active',params:[project,actor]},
    {query:`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE workflow_status='DRAFT')::int AS draft,
      count(*) FILTER (WHERE workflow_status='SUBMITTED_FOR_ASSESSMENT')::int AS "awaitingAssessment",
      count(*) FILTER (WHERE workflow_status='RETURNED')::int AS returned,
      count(*) FILTER (WHERE workflow_status='ASSESSMENT_COMPLETE')::int AS "assessmentComplete"
      FROM public.applications WHERE project_id=$1`,params:[project]},
    {query:`SELECT count(*) FILTER (WHERE uploaded_at IS NOT NULL)::int AS total,
      count(*) FILTER (WHERE status='PENDING_UPLOAD')::int AS "pendingUpload",
      count(*) FILTER (WHERE uploaded_at IS NOT NULL AND malware_status='NOT_SCANNED')::int AS "pendingScan",
      count(*) FILTER (WHERE malware_status='SCAN_FAILED')::int AS "scanFailed",
      count(*) FILTER (WHERE malware_status='INFECTED')::int AS infected,
      count(*) FILTER (WHERE status='PENDING_REVIEW' AND malware_status='CLEAN')::int AS "awaitingReview",
      count(*) FILTER (WHERE status='VERIFIED' AND malware_status='CLEAN')::int AS verified,
      count(*) FILTER (WHERE status='REJECTED' AND malware_status='CLEAN')::int AS rejected
      FROM public.evidence WHERE project_id=$1`,params:[project]},
    {query:'SELECT id,reference,version,workflow_status,updated_at FROM public.applications WHERE project_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 10',params:[project]}
  ],true);
  if(!memberships.length)throw new HttpError(404,'NOT_FOUND');
  return {generatedAt:new Date().toISOString(),applications:applications[0] as ProjectDashboard['applications'],evidence:evidence[0] as ProjectDashboard['evidence'],recent:recent as DashboardCase[]};
}
