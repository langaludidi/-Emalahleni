import { Database } from './database';
import { decryptForm } from './crypto';
import { formSchema, type DepartmentReview, type Evidence } from './contracts';
import { evaluate } from './rules';
import { HttpError } from './http';

/**
 * Read-only project reporting. No mutations to the capture, review, or evidence flows.
 * Do not put PII, coordinates or source documents in the dashboard response.
 */
export interface HistoricalSnapshot {
  id: string;
  sourceLabel: string;
  sourceModifiedAt: string;
  assessmentDate: string;
  applications: number;
  red: number;
  amber: number;
  green: number;
  fieldPlanSites: number;
  fieldPlanGpsCaptured: number;
  fieldPlanGpsOutstanding: number;
  applicationGpsAvailable: number;
  applicationGpsNeeded: number;
  applicationsWithoutMatchedSite: number;
  incomeConcessions: number;
  dohsIncomeDecisionsPending: number;
}
export type ReadinessKey = 'RED' | 'AMBER' | 'GREEN';
export interface DashboardApplication {
  id: string;
  reference: string;
  workflowStatus: string;
  updatedAt: string;
  readiness: ReadinessKey;
  blockerCount: number;
  reviewCount: number;
  gpsStatus: 'CAPTURED_UNVERIFIED' | 'NOT_CAPTURED';
  findings: { code:string; severity:'BLOCKER'|'REVIEW'; owner:string }[];
}
export interface DashboardResponse {
  project: { id: string; name: string; code: string; role: string };
  generatedAt: string;
  live: {
    total: number;
    drafts: number;
    returned: number;
    other: number;
    gpsCaptured: number | null;
    readiness: Record<ReadinessKey, number> | null;
    provisional: true;
    fullyEnumerated: boolean;
  };
  historicalSnapshots: HistoricalSnapshot[];
  applications: DashboardApplication[];
  limit: number;
  truncated: boolean;
}

export const DASHBOARD_ROW_LIMIT = 300;
const workbookLabel = 'Latest Emalahleni_Readiness_and_GPS_Assessment (3).xlsx';
const common = {
  sourceLabel: workbookLabel,
  applications: 209,
  fieldPlanSites: 211,
  fieldPlanGpsCaptured: 94,
  fieldPlanGpsOutstanding: 117,
  applicationGpsAvailable: 71,
  applicationGpsNeeded: 96,
  applicationsWithoutMatchedSite: 42
};

const snapshots: HistoricalSnapshot[] = [
  {
    ...common,
    id: 'emalahleni-2026-09-30',
    sourceLabel: '30 September preflight baseline',
    sourceModifiedAt: '2026-09-30',
    assessmentDate: '2026-09-30',
    red: 58, amber: 151, green: 0,
    incomeConcessions: 17, dohsIncomeDecisionsPending: 7
  },
  {
    ...common,
    id: 'emalahleni-2026-10-16',
    sourceModifiedAt: '2026-10-16T12:34:00Z',
    assessmentDate: '2026-10-16',
    red: 58, amber: 149, green: 2,
    incomeConcessions: 17, dohsIncomeDecisionsPending: 7
  }
];

export function historicalSnapshotsForProject(project: {name:string;code:string}): HistoricalSnapshot[] {
  // The Excel baseline must never appear for unrelated projects.
  return /emalahleni|mhlahlane/i.test(project.name + ' ' + project.code) ? snapshots.map(s => ({...s})) : [];
}
export function reportingCounts(rows: DashboardApplication[]) {
  return {
    RED: rows.filter(r => r.readiness === 'RED').length,
    AMBER: rows.filter(r => r.readiness === 'AMBER').length,
    GREEN: rows.filter(r => r.readiness === 'GREEN').length
  };
}
function memberScope(alias: string): string {
  return 'EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=' + alias + '.project_id AND m.user_id=$2 AND m.active)';
}

export async function readProjectDashboard(
  db: Database, actor: string, projectId: string, encryptionKey: string
): Promise<DashboardResponse> {
  const [membership, counts, records, evidence, reviews] = await db.forActor(actor, [
    {
      query: 'SELECT p.id,p.name,p.code,m.role FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id WHERE p.id=$1 AND m.user_id=$2 AND m.active',
      params: [projectId, actor]
    },
    {
      query: 'SELECT count(*)::int AS total, count(*) FILTER (WHERE a.workflow_status=$3)::int AS drafts, count(*) FILTER (WHERE a.workflow_status=$4)::int AS returned FROM public.applications a WHERE a.project_id=$1 AND ' + memberScope('a'),
      params: [projectId, actor, 'DRAFT', 'RETURNED']
    },
    {
      query: 'SELECT a.id,a.reference,a.version,a.workflow_status,a.updated_at,a.fields_ciphertext FROM public.applications a WHERE a.project_id=$1 AND ' + memberScope('a') + ' ORDER BY a.updated_at DESC,a.id DESC LIMIT ' + (DASHBOARD_ROW_LIMIT + 1),
      params: [projectId, actor]
    },
    {
      query: 'SELECT e.application_id,e.id,e.kind,e.status,e.malware_status,e.document_subtype,e.document_date,e.reviewed_by,e.reviewed_at,e.certification_acknowledged,e.dependant_ordinal,e.sha256 FROM public.evidence e WHERE e.project_id=$1 AND ' + memberScope('e'),
      params: [projectId, actor]
    },
    {
      query: 'SELECT d.application_id,d.section,d.state,d.reviewed_by,d.reviewed_at FROM public.dohs_section_reviews d WHERE d.project_id=$1 AND ' + memberScope('d'),
      params: [projectId, actor]
    }
  ], true);
  if (membership.length === 0) throw new HttpError(403, 'PROJECT_DASHBOARD_DENIED');
  const project = membership[0] as DashboardResponse['project'];
  const total = Number(counts[0]?.total ?? 0);
  const drafts = Number(counts[0]?.drafts ?? 0);
  const returned = Number(counts[0]?.returned ?? 0);
  const truncated = total > DASHBOARD_ROW_LIMIT;
  const evidenced = new Map<string, Evidence[]>();
  const reviewed = new Map<string, DepartmentReview[]>();
  for (const e of evidence) {
    const key = String(e.application_id);
    evidenced.set(key, [...(evidenced.get(key) ?? []), e as unknown as Evidence]);
  }
  for (const r of reviews) {
    const key = String(r.application_id);
    reviewed.set(key, [...(reviewed.get(key) ?? []), r as unknown as DepartmentReview]);
  }
  const date = new Date().toISOString().slice(0,10);
  const applications: DashboardApplication[] = await Promise.all(records.slice(0, DASHBOARD_ROW_LIMIT).map(async r => {
    const applicationId = String(r.id);
    const raw = await decryptForm(String(r.fields_ciphertext), encryptionKey, projectId, applicationId);
    const form = formSchema.parse(raw);
    const result = evaluate(form, evidenced.get(applicationId) ?? [], reviewed.get(applicationId) ?? [], date);
    return {
      id: applicationId,
      reference: String(r.reference),
      workflowStatus: String(r.workflow_status),
      updatedAt: new Date(String(r.updated_at)).toISOString(),
      readiness: result.readiness,
      findings: result.issues.map(i => ({code:i.code,severity:i.severity,owner:i.owner})).filter(i=>i.severity==='BLOCKER'||i.severity==='REVIEW'),
      blockerCount: result.issues.filter(i => i.severity === 'BLOCKER').length,
      reviewCount: result.issues.filter(i => i.severity === 'REVIEW').length,
      gpsStatus: form.site.latitude !== null && form.site.longitude !== null ? 'CAPTURED_UNVERIFIED' : 'NOT_CAPTURED'
    };
  }));
  const fullyEnumerated = !truncated && applications.length === total;
  return {
    project,
    generatedAt: new Date().toISOString(),
    live: {
      total, drafts, returned, other: total - drafts - returned,
      gpsCaptured: fullyEnumerated ? applications.filter(r => r.gpsStatus === 'CAPTURED_UNVERIFIED').length : null,
      readiness: fullyEnumerated ? reportingCounts(applications) : null,
      provisional: true,
      fullyEnumerated
    },
    historicalSnapshots: historicalSnapshotsForProject(project),
    applications,
    limit: DASHBOARD_ROW_LIMIT,
    truncated
  };
}
