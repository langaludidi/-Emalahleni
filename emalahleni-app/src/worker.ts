import { z, ZodError } from 'zod';
import { actorFrom } from './auth';
import { Database, writeScope } from './database';
import { encryptForm, decryptForm } from './crypto';
import { formSchema, blankForm, type Evidence, type DepartmentReview } from './contracts';
import { evaluate } from './rules';
import { HttpError } from './http';
import { createIntent, upload, rescan, review, listEvidence, download, uploadsConfigured, type EvidenceEnv } from './evidence';
import {reviewDepartment} from './department-review';
import {exportSnapshot} from './export-snapshot';
import {readIdDocument,idReadingConfigured,type IdReadingEnv} from './id-document';
import {probeDocumentService,DocumentServiceCheckError} from './document-service-probe';
import {evidenceWriterRoles} from './evidence-contracts';
import {limitPublicApi,limitActorAction,type RateLimitEnv} from './rate-limit';
import {projectDashboard} from './dashboard';

export interface Env extends IdReadingEnv,RateLimitEnv {
  ASSETS?: Fetcher; EVIDENCE_BUCKET?: R2Bucket; DATABASE_URL?: string; FORM_ENCRYPTION_KEY?: string;
  NEON_AUTH_BASE_URL?: string; NEON_AUTH_JWKS_URL?: string; ENABLE_CASE_API?: string;
}
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const json = (data: unknown, status = 200, extra:Record<string,string>={}) => new Response(JSON.stringify(data), { status, headers:{...headers,...extra} });
async function body(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'BODY_REQUIRED');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 32768) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'INVALID_JSON'); }
}
const saveSchema = z.object({ version: z.number().int().min(0), form: formSchema }).strict();
const createSchema = z.object({ reference: z.string().regex(/^SYN-[A-Z0-9-]{1,40}$/), form: formSchema }).strict();

export function createHandler(authenticate: typeof actorFrom = actorFrom) {
return async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname;
  try {
    if(path.startsWith('/api/'))await limitPublicApi(request,env);
    if (request.method === 'GET' && path === '/healthz') return json({ application: 'Vectra Assure', status: 'operational', caseApi: env.ENABLE_CASE_API === 'true' ? 'enabled' : 'disabled', documentUploads: uploadsConfigured(env)?'enabled':'disabled', idReading:idReadingConfigured(env)?'enabled':'disabled',mode: 'synthetic-only' });
    if (request.method === 'GET' && path === '/storage-healthz') return json({ service: 'R2', binding: env.EVIDENCE_BUCKET ? 'configured' : 'missing', uploads: uploadsConfigured(env)?'enabled':'disabled' }, env.EVIDENCE_BUCKET ? 200 : 503);
    if (request.method === 'GET' && path === '/storage-probe') {
      if (!env.EVIDENCE_BUCKET) return json({ service: 'R2', status: 'unavailable', writeEnabled: false }, 503);
      try { const object = await env.EVIDENCE_BUCKET.head('__preflight__/synthetic-probe'); return json({ service: 'R2', status: 'reachable', syntheticProbeObjectPresent: object !== null, writeEnabled: false }); }
      catch { return json({ service: 'R2', status: 'unavailable', writeEnabled: false }, 503); }
    }
    // Browser preview calculations are advisory; evidence is never accepted from this endpoint.
    if (path === '/api/preview') {
      if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const form = formSchema.parse(await body(request));
      return json(evaluate(form, [], [], new Date().toISOString().slice(0, 10)));
    }
    if (!path.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'NOT_FOUND' }, 404);
    }
    // Case and evidence access remain gated until deployment configuration is complete.
    if (env.ENABLE_CASE_API !== 'true' || !env.DATABASE_URL || !env.FORM_ENCRYPTION_KEY) throw new HttpError(503, 'CASE_API_NOT_CONFIGURED');
    let actor: string;
    try { actor = await authenticate(request, env); } catch (e) { if (e instanceof Error && e.message === 'AUTH_UNCONFIGURED') throw new HttpError(503, 'AUTH_NOT_CONFIGURED'); throw new HttpError(401, 'UNAUTHENTICATED'); }
    await limitActorAction(request,env,actor);
    const db = new Database(env.DATABASE_URL);
    const serviceProbe=path.match(/^\/api\/projects\/([0-9a-f-]+)\/applications\/([0-9a-f-]+)\/document-service-check$/i);
    if(serviceProbe){
      if(request.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED');
      const project=z.uuid().parse(serviceProbe[1]),application=z.uuid().parse(serviceProbe[2]);
      const [membership]=await db.forActor(actor,[{query:`SELECT m.role FROM public.project_memberships m JOIN public.applications a ON a.project_id=m.project_id WHERE m.project_id=$1 AND a.id=$2 AND m.user_id=$3 AND m.active`,params:[project,application,actor]}]);
      if(!membership.length||!evidenceWriterRoles.includes(membership[0].role))throw new HttpError(403,'EVIDENCE_ACTION_DENIED');
      return json({...await probeDocumentService(env),uploadsEnabled:uploadsConfigured(env),idReadingEnabled:idReadingConfigured(env)});
    }
    const evidenceRoute=path.match(/^\/api\/projects\/([0-9a-f-]+)\/applications\/([0-9a-f-]+)\/evidence(?:\/([0-9a-f-]+))?(?:\/(upload|scan|review|download|read-id))?$/i);
    if(evidenceRoute){
      const project=z.uuid().parse(evidenceRoute[1]),application=z.uuid().parse(evidenceRoute[2]);
      const id=evidenceRoute[3]?z.uuid().parse(evidenceRoute[3]):undefined,action=evidenceRoute[4];
      if(!id&&request.method==='GET')return json({evidence:await listEvidence(db,actor,project,application),uploads:{enabled:uploadsConfigured(env)},idReading:{enabled:idReadingConfigured(env)}});
      if(!id&&request.method==='POST')return json(await createIntent(db,actor,project,application,await body(request),env),201);
      if(id&&action==='upload'&&request.method==='PUT')return json(await upload(db,actor,project,application,id,request,env));
      if(id&&action==='scan'&&request.method==='POST')return json(await rescan(db,actor,project,application,id,env));
      if(id&&action==='read-id'&&request.method==='POST')return json(await readIdDocument(db,actor,project,application,id,env));
      if(id&&action==='review'&&request.method==='PUT')return json(await review(db,actor,project,application,id,await body(request)));
      if(id&&action==='download'&&request.method==='GET')return await download(db,actor,project,application,id,env);
      throw new HttpError(405,'METHOD_NOT_ALLOWED');
    }
    if (path === '/api/projects' && request.method === 'GET') {
      const [rows] = await db.forActor(actor, [{ query: 'SELECT p.id,p.code,p.name,m.role FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id WHERE m.user_id=$1 AND m.active ORDER BY p.name', params: [actor] }]);
      return json({ projects: rows });
    }
    const dashboardRoute=path.match(/^\/api\/projects\/([0-9a-f-]+)\/dashboard$/i);
    if(dashboardRoute){
      if(request.method!=='GET')throw new HttpError(405,'METHOD_NOT_ALLOWED');
      return json(await projectDashboard(db,actor,z.uuid().parse(dashboardRoute[1])));
    }
    const route = path.match(/^\/api\/projects\/([0-9a-f-]+)\/applications(?:\/([0-9a-f-]+))?(?:\/(readiness|dohs|export)(?:\/([A-Z_0-9]+))?)?$/i);
    if (!route) throw new HttpError(404, 'NOT_FOUND');
    const project = z.uuid().parse(route[1]); const id = route[2] ? z.uuid().parse(route[2]) : undefined;
    const action = route[3];
    if (!id && !action && request.method === 'GET') {
      const [rows] = await db.forActor(actor, [{ query: 'SELECT id,reference,version,workflow_status,updated_at FROM public.applications WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 100', params: [project] }]);
      return json({ applications: rows });
    }
    if (!id && !action && request.method === 'POST') {
      const input = createSchema.parse(await body(request)); const caseId = crypto.randomUUID();
      const ciphertext = await encryptForm(input.form, env.FORM_ENCRYPTION_KEY, project, caseId);
      const [rows] = await db.forActor(actor, [{ query: `WITH created AS (INSERT INTO public.applications (id,organisation_id,project_id,reference,fields_ciphertext) SELECT $1,p.organisation_id,p.id,$3,$4 FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id WHERE p.id=$2 AND m.user_id=$5 AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER') RETURNING id,reference,version), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $2,$5,'DRAFT_CREATED',jsonb_build_object('applicationId',id) FROM created) SELECT * FROM created`, params: [caseId, project, input.reference, ciphertext, actor] }]);
      if (!rows.length) throw new HttpError(403, 'PROJECT_WRITE_DENIED');
      return json(rows[0], 201);
    }
    if (!id) throw new HttpError(404, 'NOT_FOUND');
    if (!action && request.method === 'GET') {
      const [rows] = await db.forActor(actor, [{ query: 'SELECT id,reference,version,fields_ciphertext,workflow_status FROM public.applications WHERE project_id=$1 AND id=$2', params: [project, id] }]);
      if (!rows.length) throw new HttpError(404, 'NOT_FOUND');
      const { fields_ciphertext, ...result } = rows[0];
      return json({ ...result, form: formSchema.parse(await decryptForm(fields_ciphertext, env.FORM_ENCRYPTION_KEY, project, id)) });
    }
    if (!action && request.method === 'PUT') {
      const input = saveSchema.parse(await body(request));
      const ciphertext = await encryptForm(input.form, env.FORM_ENCRYPTION_KEY, project, id);
      const [rows] = await db.forActor(actor, [{ query: `WITH updated AS (UPDATE public.applications a SET fields_ciphertext=$4,version=version+1,updated_at=now() WHERE a.project_id=$1 AND a.id=$2 AND a.version=$3 AND a.workflow_status IN ('DRAFT','RETURNED') AND ${writeScope} RETURNING id,reference,version), audited AS (INSERT INTO public.audit_events (project_id,actor_id,action,metadata) SELECT $1,$5,'DRAFT_SAVED',jsonb_build_object('applicationId',id,'version',version) FROM updated) SELECT * FROM updated`, params: [project, id, input.version, ciphertext, actor] }]);
      if (!rows.length) throw new HttpError(409, 'SAVE_CONFLICT_OR_DENIED');
      return json(rows[0]);
    }
    if (action === 'readiness' && request.method === 'GET') {
      const [cases, evidence, reviews] = await db.forActor(actor, [
        { query: 'SELECT fields_ciphertext,version FROM public.applications WHERE project_id=$1 AND id=$2', params: [project, id] },
        { query: 'SELECT id,kind,status,malware_status,document_subtype,document_date,reviewed_by,reviewed_at,reviewed_form_version,certification_acknowledged,dependant_ordinal,sha256 FROM public.evidence WHERE project_id=$1 AND application_id=$2', params: [project, id] },
        { query: 'SELECT section,state,reviewed_by,reviewed_at,reviewed_form_version FROM public.dohs_section_reviews WHERE project_id=$1 AND application_id=$2', params: [project, id] }
      ],true);
      if (!cases.length) throw new HttpError(404, 'NOT_FOUND');
      const form = formSchema.parse(await decryptForm(cases[0].fields_ciphertext, env.FORM_ENCRYPTION_KEY, project, id));
      return json({ formVersion: cases[0].version, ...evaluate(form, evidence as Evidence[], reviews as DepartmentReview[], new Date().toISOString().slice(0, 10),cases[0].version) });
    }
    if (action === 'dohs' && request.method === 'PUT' && route[4]) {
      return json(await reviewDepartment(db,actor,project,id,route[4],await body(request)));
    }
    if(action==='dohs'&&request.method==='GET'&&!route[4]){
      const [rows]=await db.forActor(actor,[{query:`SELECT section,state,note,reviewed_by,reviewed_form_version,to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed_at FROM public.dohs_section_reviews WHERE project_id=$1 AND application_id=$2 ORDER BY section`,params:[project,id]}]);
      return json({reviews:rows});
    }
    if(action==='export'&&request.method==='GET'&&!route[4])return json(await exportSnapshot(db,actor,project,id,env.FORM_ENCRYPTION_KEY));
    throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...(e instanceof DocumentServiceCheckError?{failedCheck:e.failedCheck}:{}) }, e.status,e.headers);
    if (e instanceof ZodError) return json({ error: 'VALIDATION_FAILED', fields: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, 400);
    if ((e as { code?: string }).code === '23505') return json({ error: 'REFERENCE_ALREADY_EXISTS' }, 409);
    if ((e as { code?: string }).code === '42501') return json({ error: 'ACCESS_DENIED' }, 403);
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503);
  }
};
}
export const handle = createHandler();
export default { fetch: handle } satisfies ExportedHandler<Env>;

