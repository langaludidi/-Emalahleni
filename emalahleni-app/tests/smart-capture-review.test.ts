import test from 'node:test';
import assert from 'node:assert/strict';
import {type Database} from '../src/database';
import {sealSmartCaptureProposal} from '../src/smart-capture-crypto';
import {readSmartCaptureProposal,confirmSmartCaptureProposal} from '../src/smart-capture-review';
const project='00000000-0000-4000-8000-000000000001',importId='00000000-0000-4000-8000-000000000002';
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(37)));
const completeProposal={
 version:1 as const,applicant:{
 firstNames:'Synthetic',surname:'Example',idNumber:'0000000000000',phone:null,maritalStatus:'SINGLE' as const,
 spouseName:null,disability:false,disaster:false,disasterDetails:null,propertyOwned:false,propertySold:false
 },household:{incomeSource:'UNEMPLOYED' as const,dependants:[]},
 extraFields:{},provenance:{},sections:[]
};
async function mockDb(role:string|null,state='NEEDS_REVIEW',applicationId:string|null=null,sourcePdfAvailable=true):Promise<Database>{
 const ciphertext=await sealSmartCaptureProposal(completeProposal,key,project,importId);
 return {forActor:async(_actor:string,statements:Array<{query:string}>)=>{
  if(statements.length!==1)throw Error('unexpected DB transaction');
  const q=statements[0].query;
  if(q.includes('FROM public.project_memberships'))return [role?[{role}]:[]];
  if(q.includes('JOIN public.smart_capture_proposals'))return [[{ciphertext,review_version:0,state,application_id:applicationId,content_sha256:sourcePdfAvailable?'a'.repeat(64):null,storage_key:sourcePdfAvailable?`smart-capture/quarantine/${project}/${importId}/00000000-0000-4000-8000-000000000004/original.pdf`:null}]];
  throw Error('unexpected mutation');
 }} as unknown as Database;
}
test('SC-009 a non-capture role cannot read encrypted OCR review details',async()=>{
 const db=await mockDb('AUDITOR');
 await assert.rejects(readSmartCaptureProposal(db,'actor',project,importId,
  {SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_ENCRYPTION_KEY:key}),{code:'SMART_CAPTURE_REVIEW_DENIED'});
});
test('SC-009 reviewer can read proposal after role verification',async()=>{
 const db=await mockDb('OFFICER');
 const result=await readSmartCaptureProposal(db,'actor',project,importId,
  {SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_ENCRYPTION_KEY:key});
 assert.equal(result.proposal.applicant.firstNames,'Synthetic');
 assert.equal(result.state,'NEEDS_REVIEW');
});
test('SC-009 unconfirmed fields cannot be committed as an applicant draft',async()=>{
 const db=await mockDb('OFFICER');
 await assert.rejects(confirmSmartCaptureProposal(db,'actor',project,importId,
  {version:0,confirmedFields:[]},
  {SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
   SMART_CAPTURE_ENCRYPTION_KEY:key,FORM_ENCRYPTION_KEY:key}),
  {code:'SMART_CAPTURE_REVIEW_INCOMPLETE'});
});
test('SC-009 a completed import returns existing application rather than creating another',async()=>{
 const applicationId='00000000-0000-4000-8000-000000000003';
 const db=await mockDb('OFFICER','COMMITTED',applicationId);
 const result=await confirmSmartCaptureProposal(db,'actor',project,importId,
  {version:0,confirmedFields:[]},
  {SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
   SMART_CAPTURE_ENCRYPTION_KEY:key,FORM_ENCRYPTION_KEY:key});
 assert.deepEqual(result,{applicationId,state:'COMMITTED'});
});

test('SC-009 API refuses draft confirmation when source PDF quarantine metadata is absent',async()=>{
 const db=await mockDb('OFFICER','NEEDS_REVIEW',null,false);
 await assert.rejects(confirmSmartCaptureProposal(db,'actor',project,importId,
  {version:0,confirmedFields:[]},
  {SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
   SMART_CAPTURE_ENCRYPTION_KEY:key,FORM_ENCRYPTION_KEY:key}),
  {code:'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE'});
});

test('SC-I07 verified synthetic PDF permits exactly one audited draft handoff',async()=>{
 const pdf=new TextEncoder().encode('%PDF-1.4 synthetic source');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(pdf)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const ciphertext=await sealSmartCaptureProposal(completeProposal,key,project,importId);
 const storageKey=`smart-capture/quarantine/${project}/${importId}/00000000-0000-4000-8000-000000000004/original.pdf`;
 let commits=0,checks=0;
 const db={forActor:async(_actor:string,statements:Array<{query:string}>)=>{
  const q=statements[0].query;
  if(q.includes('FROM public.project_memberships'))return [[{role:'OFFICER'}]];
  if(q.includes('JOIN public.smart_capture_proposals'))return [[{ciphertext,review_version:0,state:commits?'COMMITTED':'NEEDS_REVIEW',
   application_id:commits?'00000000-0000-4000-8000-000000000003':null,content_sha256:digest,storage_key:storageKey}]];
  if(q.includes('JOIN public.smart_capture_imports existing'))return [[]];
  if(q.includes('WITH claimed AS')){commits++;assert.match(q,/INSERT INTO public.audit_events/);return [[{application_id:'00000000-0000-4000-8000-000000000003'}]];}
  throw Error('unexpected query: '+q);
 }} as unknown as Database;
 const env={SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
  SMART_CAPTURE_ENCRYPTION_KEY:key,FORM_ENCRYPTION_KEY:key,
  EVIDENCE_BUCKET:{get:async()=>{checks++;return {size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)};}} as unknown as R2Bucket};
 const confirmedFields=['applicant.firstNames','applicant.surname','applicant.idNumber',
  'applicant.maritalStatus','applicant.disability','applicant.disaster',
  'applicant.propertyOwned','applicant.propertySold','household.incomeSource'];
 const first=await confirmSmartCaptureProposal(db,'actor',project,importId,{version:0,confirmedFields},env);
 assert.equal(first.state,'COMMITTED');
 const repeated=await confirmSmartCaptureProposal(db,'actor',project,importId,{version:0,confirmedFields},env);
 assert.equal(repeated.applicationId,first.applicationId);
 assert.equal(commits,1);
 assert.equal(checks,1);
});

test('SC-I07 tampered quarantined PDF cannot create a beneficiary draft',async()=>{
 const ciphertext=await sealSmartCaptureProposal(completeProposal,key,project,importId);
 let mutated=false;
 const db={forActor:async(_actor:string,statements:Array<{query:string}>)=>{
  const q=statements[0].query;
  if(q.includes('FROM public.project_memberships'))return [[{role:'OFFICER'}]];
  if(q.includes('JOIN public.smart_capture_proposals'))return [[{ciphertext,review_version:0,state:'NEEDS_REVIEW',application_id:null,
   content_sha256:'a'.repeat(64),storage_key:`smart-capture/quarantine/${project}/${importId}/00000000-0000-4000-8000-000000000004/original.pdf`}]];
  if(q.includes('WITH claimed AS')){mutated=true;return [[]];}
  throw Error('unexpected query: '+q);
 }} as unknown as Database;
 const pdf=new TextEncoder().encode('%PDF-1.4 altered synthetic source');
 const env={SMART_CAPTURE_ENABLED:'true',SMART_CAPTURE_PROCESSING_ENABLED:'true',
  SMART_CAPTURE_ENCRYPTION_KEY:key,FORM_ENCRYPTION_KEY:key,
  EVIDENCE_BUCKET:{get:async()=>({size:pdf.length,arrayBuffer:async()=>pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength)})} as unknown as R2Bucket};
 const confirmedFields=['applicant.firstNames','applicant.surname','applicant.idNumber',
  'applicant.maritalStatus','applicant.disability','applicant.disaster',
  'applicant.propertyOwned','applicant.propertySold','household.incomeSource'];
 await assert.rejects(confirmSmartCaptureProposal(db,'actor',project,importId,{version:0,confirmedFields},env),
  {code:'SMART_CAPTURE_STORAGE_MISMATCH'});
 assert.equal(mutated,false);
});
