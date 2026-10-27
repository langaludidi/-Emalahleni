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
async function mockDb(role:string|null,state='NEEDS_REVIEW',applicationId:string|null=null):Promise<Database>{
 const ciphertext=await sealSmartCaptureProposal(completeProposal,key,project,importId);
 return {forActor:async(_actor:string,statements:Array<{query:string}>)=>{
  if(statements.length!==1)throw Error('unexpected DB transaction');
  const q=statements[0].query;
  if(q.includes('FROM public.project_memberships'))return [role?[{role}]:[]];
  if(q.includes('JOIN public.smart_capture_proposals'))return [[{ciphertext,review_version:0,state,application_id:applicationId,content_sha256:null,storage_key:null}]];
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
