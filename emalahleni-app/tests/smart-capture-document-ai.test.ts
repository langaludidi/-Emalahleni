import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseDocumentAi,processScannedPdfWithDocumentAi} from '../src/smart-capture-document-ai';
function source(){
 const text='First names\\nSynthetic\\nSurname\\nExample\\nID number\\n0000000000000\\n';
 const pairs=[['First names','Synthetic'],['Surname','Example'],['ID number','0000000000000']];
 const formFields=pairs.map(([a,b])=>({
  fieldName:{textAnchor:{textSegments:[{startIndex:String(text.indexOf(a)),endIndex:String(text.indexOf(a)+a.length)}]}},
  fieldValue:{textAnchor:{textSegments:[{startIndex:String(text.indexOf(b)),endIndex:String(text.indexOf(b)+b.length)}]}}
 }));
 return {document:{text,pages:[{pageNumber:1,formFields}]}};
}
test('SC-006 normalises synthetic form fields without inventing site observations or truth',()=>{
 const result=normaliseDocumentAi(source());
 assert.equal(result.applicant.firstNames,'Synthetic');
 assert.equal(result.applicant.surname,'Example');
 assert.equal(result.applicant.idNumber,'0000000000000');
 assert.equal(result.applicant.disability,null);
 assert.deepEqual(result.sections,[{type:'UNKNOWN',fromPage:1,toPage:1,status:'NOT_FOUND'}]);
 assert.equal(result.provenance['applicant.firstNames'].page,1);
});
test('SC-006 rejects invalid provider responses',()=>{
 assert.throws(()=>normaliseDocumentAi({document:{text:'',pages:'wrong'}}),/DOCUMENT_AI_RESPONSE_INVALID/);
});
test('SC-006 never sends documents to arbitrary processor locations',async()=>{
 const pdf=new TextEncoder().encode('%PDF-test');
 await assert.rejects(processScannedPdfWithDocumentAi({
  pdf,accessToken:'synthetic',processorName:'projects/abc/locations/us/processors/123',
  fetcher:async()=>{throw Error('should never call');}
 }),/DOCUMENT_AI_PROCESSOR_NOT_ALLOWED/);
});
test('SC-006 normalises result via injected synthetic Document AI client',async()=>{
 const pdf=new TextEncoder().encode('%PDF-test');
 const result=await processScannedPdfWithDocumentAi({
  pdf,accessToken:'synthetic',processorName:'projects/abc/locations/eu/processors/123',
  fetcher:async req=>{
   assert.equal(new URL(req.url).hostname,'eu-documentai.googleapis.com');
   const body=await req.json() as {rawDocument:{content:string}};
   assert.ok(body.rawDocument.content);
   return Response.json(source());
  }
 });
 assert.equal(result.applicant.firstNames,'Synthetic');
});
