import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('SC-033 independent Neon Worker configuration passes predeployment safety check',()=>{
 const script=fileURLToPath(new URL('../scripts/check-smart-capture-neon-probe.mjs',import.meta.url));
 const output=execFileSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
 assert.match(output,/PASS: synthetic-only Worker config and queue isolation/);
});
