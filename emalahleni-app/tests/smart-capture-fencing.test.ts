import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('SC-016 processor stage transitions are fenced by active actor claim',()=>{
 const code=readFileSync(new URL('../src/smart-capture-process.ts',import.meta.url),'utf8');
 const transitions=code.match(/claimed_by=current_setting\('app.actor_id',true\)/g)??[];
 assert.ok(transitions.length>=4,'stage transition, failure, proposal insert and final advancement require an active actor claim');
 assert.match(code,/claimed_at IS NOT NULL RETURNING id/);
 assert.match(code,/state='EXTRACTING'[\s\S]*?claimed_by=current_setting/);
});
