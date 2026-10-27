import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fixture=readFileSync(new URL(
 '../migrations/20261027_smart_capture_SYNTHETIC_BRANCH_AUDIT_FIXTURE.sql',import.meta.url
),'utf8');

test('SC-030 isolated fixture is explicitly forbidden on preview or production',()=>{
 assert.match(fixture,/ISOLATED SYNTHETIC NEON BRANCH ONLY/);
 assert.match(fixture,/must never be/);
 assert.match(fixture,/br-proud-union-zaded8kk/);
});
test('SC-030 auditing remains append-only under restricted worker role',()=>{
 assert.match(fixture,/CREATE TABLE public\.audit_events/);
 assert.match(fixture,/FORCE ROW LEVEL SECURITY/);
 assert.match(fixture,/actor_id=current_setting\('app.actor_id',true\)/);
 assert.match(fixture,/GRANT SELECT,INSERT ON public\.audit_events TO emalahleni_worker/);
 assert.doesNotMatch(fixture,/GRANT[^;]*(?:UPDATE|DELETE) ON public\.audit_events/);
});
test('SC-030 application INSERT is restricted to active project writers and draft state',()=>{
 assert.match(fixture,/AS RESTRICTIVE FOR INSERT TO emalahleni_worker/);
 assert.match(fixture,/workflow_status='DRAFT' AND dohs_complete=false/);
 assert.match(fixture,/m\.active AND m\.role IN/);
 assert.doesNotMatch(fixture,/GRANT[^;]*(?:UPDATE|DELETE) ON public\.applications/);
});
