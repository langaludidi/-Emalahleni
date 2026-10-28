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

test('SC-I05 does not create an object URL after the import review was unmounted',()=>{
 const code=readFileSync(new URL('../web/app/smart-capture/review/page.tsx',import.meta.url),'utf8');
 assert.match(code,/blob\.type==='application\/pdf'&&live\)\{blobUrl=URL\.createObjectURL\(blob\);setPdfUrl\(blobUrl\)/);
});
test('SC-I05 requires source PDF preview before allowing draft confirmation',()=>{
 const code=readFileSync(new URL('../web/app/smart-capture/review/page.tsx',import.meta.url),'utf8');
 assert.match(code,/if\(!pdfUrl\)\{setError\('The original PDF must be available/);
 assert.match(code,/disabled=\{busy\|\|!pdfUrl\|\|data\?\.state!=='NEEDS_REVIEW'\} onClick=\{confirm\}/);
});

test('SC-I05 API refuses draft confirmation without valid quarantined source PDF metadata',()=>{
 const code=readFileSync(new URL('../src/smart-capture-review.ts',import.meta.url),'utf8');
 const confirm=code.split('export async function confirmSmartCaptureProposal')[1]?.split('export async function downloadSmartCapturePdf')[0]??'';
 assert.match(confirm,/row\.content_sha256/);
 assert.match(confirm,/validSmartCaptureQuarantineKey\(row\.storage_key,project,id\)/);
 assert.match(confirm,/SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE/);
});

test('SC-I05 API requires verified applicant name and identity before creating a draft',()=>{
 const code=readFileSync(new URL('../src/smart-capture-review.ts',import.meta.url),'utf8');
 const confirm=code.split('export async function confirmSmartCaptureProposal')[1]?.split('export async function downloadSmartCapturePdf')[0]??'';
 assert.match(confirm,/check\.form\.applicant\.firstNames\.trim\(\)/);
 assert.match(confirm,/check\.form\.applicant\.surname\.trim\(\)/);
 assert.match(confirm,/check\.form\.applicant\.idNumber/);
 assert.match(confirm,/SMART_CAPTURE_APPLICANT_IDENTITY_INCOMPLETE/);
});

test('SC-I07 draft creation invokes verified PDF integrity before inserting applications',()=>{
 const code=readFileSync(new URL('../src/smart-capture-review.ts',import.meta.url),'utf8');
 const confirm=code.split('export async function confirmSmartCaptureProposal')[1]?.split('export async function downloadSmartCapturePdf')[0]??'';
 assert.match(confirm,/await verifySmartCaptureSourcePdf\(/);
 assert.ok(confirm.indexOf('await verifySmartCaptureSourcePdf(')<confirm.indexOf('INSERT INTO public.applications'));
});
