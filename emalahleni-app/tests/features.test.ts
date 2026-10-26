import test from 'node:test';import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {blankForm} from '../src/contracts';import {evaluate} from '../src/rules';
import {dateFromCamera,extractPhoto,proposalFromTags} from '../src/photo-metadata';
import {summaryPdf,draftPack} from '../web/app/pdf-exports';
import type {ExportSnapshot} from '../src/export-contracts';

function snapshot():ExportSnapshot{const form=blankForm();form.applicant.firstNames='Synthetic';form.applicant.surname='Example';return {applicationId:'00000000-0000-4000-8000-000000000001',projectId:'00000000-0000-4000-8000-000000000002',reference:'SYN-PDF-TEST',version:1,form,readiness:evaluate(form,[],[],'2026-10-14'),evidence:[],reviews:[],generatedAt:'2026-10-14T08:00:00Z',fingerprint:'snapshot-one',preview:false};}
async function hash(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}
test('camera dates preserve their calendar day and reject invalid or revived timezone values',()=>{
 assert.equal(dateFromCamera('2026:09:14 23:59:59'),'2026-09-14');assert.equal(dateFromCamera('2024:02:29 12:00:00'),'2024-02-29');
 assert.equal(dateFromCamera('2026:02:29 12:00:00'),'');assert.equal(dateFromCamera(new Date('2026-09-14')),'');
 const p=proposalFromTags({DateTimeOriginal:'2026:09:14 12:12:00',OffsetTimeOriginal:'+02:00'},{latitude:-31.786492,longitude:27.358176},'a'.repeat(64),'site.jpg');
 assert.equal(p.date,'2026-09-14');assert.equal(p.timezone,'+02:00');assert.equal(p.latitude,-31.786492);
 assert.equal(proposalFromTags({}, {latitude:100,longitude:NaN},'hash','photo').latitude,null);
});
test('exifr reads capture date from a real EXIF segment and binds it to the file hash',async()=>{
 const date=Buffer.from('2026:09:14 12:12:00\0');const tiff=Buffer.alloc(52+date.length);
 tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);
 tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);
 tiff.writeUInt16LE(1,26);tiff.writeUInt16LE(0x9003,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(date.length,32);tiff.writeUInt32LE(52,36);date.copy(tiff,52);
 const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);const segment=Buffer.alloc(4);segment[0]=0xff;segment[1]=0xe1;segment.writeUInt16BE(exif.length+2,2);
 const jpeg=Buffer.concat([Buffer.from([0xff,0xd8]),segment,exif,Buffer.from([0xff,0xd9])]);
 const file=new File([jpeg],'synthetic-site.jpg',{type:'image/jpeg'});const p=await extractPhoto(file);
 assert.equal(p.date,'2026-09-14');assert.equal(p.latitude,null);assert.equal(p.sha256,await hash(await file.arrayBuffer()));
});
test('metadata proposals cannot satisfy a different verified photograph',()=>{
 const s=snapshot();s.form.site.photoMetadataSource='EXIF';s.form.site.photoMetadataSha256='a'.repeat(64);s.form.site.photoEvidenceId='00000000-0000-4000-8000-000000000010';
 assert.ok(evaluate(s.form,[],[],'2026-10-14').issues.some(i=>i.code==='PHOTO_METADATA_BINDING'));
});
test('react-pdf produces a readable draft summary without granting submission readiness',async()=>{
 const s=snapshot();const bytes=await (await summaryPdf(s)).arrayBuffer();const doc=await PDFDocument.load(bytes);
 assert.ok(doc.getPageCount()>=1);assert.match(doc.getTitle()??'',/^DRAFT/);assert.match(doc.getSubject()??'',/not submission approval/);
 assert.equal(s.readiness.submissionReady,false);
});
test('draft packs include only verified clean evidence, check hashes, and reject stale snapshots',async()=>{
 const donor=await PDFDocument.create();donor.addPage([595,842]);donor.addJavaScript('ignored','app.alert("test")');const bytes=new Uint8Array(await donor.save()).buffer;const sha256=await hash(bytes);
 const s=snapshot();const entry={id:'doc-1',kind:'APPLICANT_ID',filename:'synthetic.pdf',content_type:'application/pdf',sha256,status:'VERIFIED',malware_status:'CLEAN',reviewed_by:'synthetic-assessor',reviewed_at:'2026-10-14T08:00:00Z',reviewed_form_version:1,document_date:null,document_subtype:'ID_COPY',certification_acknowledged:true,dependant_ordinal:null};
 s.evidence=[entry,{...entry,id:'unreviewed',status:'PENDING_REVIEW'},{...entry,id:'infected',malware_status:'INFECTED'},{...entry,id:'stale-review',reviewed_form_version:0},{...entry,id:'legacy-review',reviewed_form_version:null}];const fetched:string[]=[];
 const pack=await draftPack(s,async id=>{fetched.push(id);return bytes},async()=>s.fingerprint);const merged=await PDFDocument.load(await pack.arrayBuffer());
 const summary=await PDFDocument.load(await (await summaryPdf(s)).arrayBuffer());assert.equal(merged.getPageCount(),summary.getPageCount()+1);assert.deepEqual(fetched,['doc-1']);
 assert.equal(merged.catalog.has(PDFName.of('Names')),false);assert.match(merged.getTitle()??'',/^DRAFT/);
 await assert.rejects(draftPack(s,async()=>bytes,async()=>'changed'),/changed during export/);
 await assert.rejects(draftPack(s,async()=>new Uint8Array([1,2,3]).buffer,async()=>s.fingerprint),/evidence file changed/);
 await assert.rejects(draftPack({...s,preview:true},async()=>bytes,async()=>s.fingerprint),/recorded case/);
});

