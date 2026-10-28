import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Smart Capture migration creates proposal composite key once',()=>{
 const sql=readFileSync(new URL('../migrations/20261027_smart_capture_proposals_DRAFT.sql',import.meta.url),'utf8');
 assert.equal(sql.split('ADD CONSTRAINT smart_capture_imports_project_id_id_key').length-1,1);
});
