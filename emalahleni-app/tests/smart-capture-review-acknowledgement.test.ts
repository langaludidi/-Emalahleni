import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('SC-I05 editing applicant and household fields invalidates previous PDF acknowledgements',()=>{
 const code=readFileSync(new URL('../web/app/smart-capture/review/page.tsx',import.meta.url),'utf8');
 assert.match(code,/function changeApplicant[\s\S]*?setChecked\(current=>current\.filter\(field=>field!=='applicant\.'\+key\)\)/);
 assert.match(code,/function changeHousehold[\s\S]*?setChecked\(current=>current\.filter\(field=>field!=='household\.'\+key\)\)/);
});
test('SC-I05 saving a revised proposal clears stale field approvals before draft confirmation',()=>{
 const code=readFileSync(new URL('../web/app/smart-capture/review/page.tsx',import.meta.url),'utf8');
 assert.match(code,/async function save\(\)[\s\S]*?setChecked\(\[\]\)/);
 assert.match(code,/async function confirm\(\)[\s\S]*?JSON\.stringify\(data\.proposal\)!==JSON\.stringify\(proposal\)/);
});

test('SC-I05 switching imports clears previous beneficiary PDF, data and approvals',()=>{
 const code=readFileSync(new URL('../web/app/smart-capture/review/page.tsx',import.meta.url),'utf8');
 assert.match(code,/useEffect\(\(\)=>\{[\s\S]*?setData\(null\);setProposal\(null\);setChecked\(\[\]\);setPdfUrl\(''\);setPage\(1\)/);
 assert.match(code,/return\(\)=>\{live=false;if\(blobUrl\)URL\.revokeObjectURL\(blobUrl\)/);
});
