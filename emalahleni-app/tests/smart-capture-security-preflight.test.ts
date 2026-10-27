import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('SC-018 read-only security preflight checks token, forced RLS and delete grants',()=>{
 const sql=readFileSync(new URL('../migrations/20261027_smart_capture_security_preflight_READONLY.sql',import.meta.url),'utf8');
 assert.ok(sql.includes('missing_claim_token'));
 assert.ok(sql.includes('relforcerowsecurity'));
 assert.ok(sql.includes('unexpected_delete_grant'));
 assert.ok(!/\b(ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\s+(TABLE|INTO|public\.)/i.test(sql));
});
