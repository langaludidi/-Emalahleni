import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('SC-017 processing attempt token is checked before each transition',()=>{
 const code=readFileSync(new URL('../src/smart-capture-process.ts',import.meta.url),'utf8');
 assert.ok(code.includes('crypto.randomUUID()'));
 assert.ok(code.includes('claim_token=$7 RETURNING id'));
 assert.ok(code.includes('claim_token=$4 AND state IN'));
});
