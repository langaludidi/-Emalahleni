import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(
 new URL('../migrations/20261027_smart_capture_commit_parity_READONLY.sql',import.meta.url),'utf8'
);
test('SC-022 confirmation preflight checks audit table and restricted grants',()=>{
 assert.ok(sql.includes('AUDIT_EVENTS_TABLE_MISSING'));
 assert.ok(sql.includes('APPLICATION_INSERT_GRANT_MISSING'));
 assert.ok(sql.includes('WORKER_LOGIN_DISABLED'));
});
test('SC-022 confirmation preflight contains no schema or data writes',()=>{
 assert.ok(sql.trimStart().startsWith('-- SC-022'));
 assert.ok(!/\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|INSERT|UPDATE|DELETE)\s+(?:TABLE|INTO|public\.|emalahleni_worker)/i.test(sql));
});
