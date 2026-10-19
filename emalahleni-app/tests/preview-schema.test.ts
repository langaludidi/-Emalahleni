import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const access = readFileSync(new URL('../db/preview/04-access.sql', import.meta.url), 'utf8');
const tables = readFileSync(new URL('../db/preview/01-tables.sql', import.meta.url), 'utf8');
const constraints = readFileSync(new URL('../db/preview/02-constraints.sql', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../db/preview/03-guard.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../db/preview/seed-fictional.mjs', import.meta.url), 'utf8');

test('isolated preview creates restricted roles using SQL, never Neon managed elevated defaults', () => {
  for (const name of ['vectra_preview_reader', 'emalahleni_worker']) {
    assert.match(access, new RegExp(`CREATE ROLE ${name} NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;`));
  }
  assert.match(access, /GRANT vectra_preview_reader TO emalahleni_worker/);
  assert.doesNotMatch(access, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[\s\S]*TO\s+(?:vectra_preview_reader|emalahleni_worker)/i);
});

test('all five project-sensitive preview tables force actor-scoped RLS', () => {
  for (const table of ['projects', 'project_memberships', 'applications', 'evidence', 'dohs_section_reviews']) {
    assert.match(access, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(access, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`));
    assert.match(tables, new RegExp(`CREATE TABLE public\\."${table}"`));
  }
  assert.match(access, /current_setting\('app\.actor_id'/);
  assert.match(access, /GRANT SELECT ON TABLE public\.projects, public\.project_memberships, public\.applications, public\.evidence, public\.dohs_section_reviews TO vectra_preview_reader/);
  assert.match(constraints, /FOREIGN KEY \(project_id, application_id\) REFERENCES applications\(project_id, id\)/);
});

test('departmental signature guard is present in reproducible schema', () => {
  assert.match(guard, /CREATE OR REPLACE FUNCTION public\.guard_dohs_application_fields\(\)/);
  assert.match(guard, /m\.role = 'DOHS_REVIEWER'/);
  assert.match(guard, /CREATE TRIGGER trg_guard_dohs_application_fields/);
});

test('fixture seeder fails closed unless explicitly pointed at isolated preview', () => {
  assert.match(seed, /!process\.argv\.includes\('--apply'\)/);
  assert.match(seed, /url\.username!=='vectra_preview_owner'/);
  assert.match(seed, /url\.pathname!=='\/vectra_preview'/);
  assert.match(seed, /url\.searchParams\.get\('sslmode'\)!=='require'/);
  assert.match(seed, /additionalData:context/);
  assert.match(seed, /process\.argv\.includes\('--rotate-key'\)/);
  assert.match(seed, /applications\.project_id=EXCLUDED\.project_id AND applications\.reference=EXCLUDED\.reference/);
  assert.match(seed, /latitude:null,longitude:null/);
  assert.doesNotMatch(seed, /https?:\/\/[^\s]*@/);
});

test('dashboard-only Worker config never binds evidence or scanner resources', () => {
  const preview = JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc', import.meta.url), 'utf8'));
  assert.equal(preview.vars.PREVIEW_MODE, 'true');
  assert.equal(preview.vars.ENABLE_CASE_API, 'false');
  assert.equal(preview.vars.ENABLE_DOCUMENT_UPLOADS, 'false');
  assert.equal(preview.vars.ENABLE_ID_READING, 'false');
  assert.match(preview.vars.NEON_AUTH_BASE_URL, /\/vectra_preview\/auth$/);
  assert.match(preview.vars.NEON_AUTH_JWKS_URL, /\/vectra_preview\/auth\/\.well-known\/jwks\.json$/);
  for (const forbidden of ['r2_buckets', 'containers', 'durable_objects', 'exports']) {
    assert.equal(Object.hasOwn(preview, forbidden), false, forbidden + ' must be absent');
  }
  assert.equal(Object.hasOwn(preview.vars, 'DATABASE_URL'), false);
  assert.equal(Object.hasOwn(preview.vars, 'FORM_ENCRYPTION_KEY'), false);
});

test('preview connection must use restricted worker identity and never the database owner', async () => {
  const { Database } = await import('../src/database');
  const base='postgresql://';
  for (const username of ['vectra_preview_owner','neondb_owner','postgres','vectra_preview_reader']) {
    assert.throws(() => new Database(base+username+':fake@ep-example.neon.tech/vectra_preview?sslmode=require'), /DATABASE_UNCONFIGURED/);
  }
  assert.throws(() => new Database(base+'emalahleni_worker:fake@ep-example.neon.tech/neondb?sslmode=disable'), /DATABASE_UNCONFIGURED/);
});

test('preview Worker keeps fail-closed route allowlist and synthetic-only mode', async () => {
  const { createHandler } = await import('../src/worker');
  const preview = JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc', import.meta.url), 'utf8'));
  const handler = createHandler(async () => 'synthetic:test:alpha-manager');
  const env = {...preview.vars};
  const url='https://preview.invalid';
  const mutation=await handler(new Request(url+'/api/projects/22222222-2222-4222-8222-222222222221/dashboard',{method:'POST'}), env);
  assert.equal(mutation.status,403);
  const documents=await handler(new Request(url+'/api/documents/synthetic'),env);
  assert.equal(documents.status,403);
  const previewCalc=await handler(new Request(url+'/api/preview',{method:'POST',body:'{}'}),env);
  assert.equal(previewCalc.status,403);
});
