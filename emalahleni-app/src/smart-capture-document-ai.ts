/**
 * Provider-independent Document AI normaliser.
 * Only produces a review proposal. Never commits beneficiary records.
 */
import { extractionProposalSchema, type ExtractionProposal } from './smart-capture-proposal';
import {classifyDocumentPages} from './smart-capture-classify';

type TextAnchor={textSegments?:Array<{startIndex?:string|number;endIndex?:string|number}>};
type ProviderField={fieldName?:{textAnchor?:TextAnchor;confidence?:number};fieldValue?:{textAnchor?:TextAnchor;confidence?:number}};
type ProviderPage={pageNumber?:number;formFields?:ProviderField[]};
type ProviderDoc={text?:string;pages?:ProviderPage[];entities?:Array<{type?:string;mentionText?:string;pageAnchor?:{pageRefs?:Array<{page?:string|number}>}}>;};

function anchorText(text:string,anchor:TextAnchor|undefined):string{
 if(!anchor?.textSegments?.length)return '';
 const full=Array.from(text).join('');
 let output='';
 for(const segment of anchor.textSegments.slice(0,4)){
  const from=Number(segment.startIndex??0),to=Number(segment.endIndex??0);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>full.length)continue;
  output+=full.slice(from,to);
 }
 return output.trim().slice(0,2000);
}
const labels:Record<string,string>={
 'first name':'applicant.firstNames','first names':'applicant.firstNames','given names':'applicant.firstNames',
 'surname':'applicant.surname','last name':'applicant.surname',
 'identity number':'applicant.idNumber','identity document number':'applicant.idNumber',
 'id number':'applicant.idNumber','sa id number':'applicant.idNumber',
 'cellphone':'applicant.phone','cell number':'applicant.phone','contact number':'applicant.phone',
 'phone number':'applicant.phone','marital status':'applicant.maritalStatus',
 'spouse name':'applicant.spouseName','income source':'household.incomeSource',
};
function canonicalName(label:string){
 return label.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
/**
 * Document AI form-field anchors use Unicode codepoint offsets in the document
 * text. We intentionally keep unsupported fields in extraFields and flag them.
 */
export function normaliseDocumentAi(value:unknown):ExtractionProposal{
 const wrapped=value as {document?:ProviderDoc}|null;
 const doc=wrapped?.document;
 if(!doc||typeof doc.text!=='string'||!Array.isArray(doc.pages))throw new Error('DOCUMENT_AI_RESPONSE_INVALID');
 if(doc.text.length>250000||doc.pages.length>200)throw new Error('DOCUMENT_AI_RESPONSE_TOO_LARGE');
 const fields=new Map<string,{value:string;page:number}[]>();
 for(let i=0;i<doc.pages.length;i++){
  const page=doc.pages[i],pageNumber=page.pageNumber??i+1;
  if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>2000)continue;
  for(const field of (page.formFields??[]).slice(0,300)){
   const label=anchorText(doc.text,field.fieldName?.textAnchor);
   const answer=anchorText(doc.text,field.fieldValue?.textAnchor);
   if(!label||!answer)continue;
   const key=labels[canonicalName(label)]??'extra.'+canonicalName(label).slice(0,80);
   if(!fields.has(key))fields.set(key,[]);
   fields.get(key)!.push({value:answer,page:pageNumber});
  }
 }
 for(const entity of (doc.entities??[]).slice(0,400)){
  const label=canonicalName(entity.type??''),answer=(entity.mentionText??'').trim().slice(0,2000);
  const key=labels[label];
  if(!key||!answer)continue;
  const page=Number(entity.pageAnchor?.pageRefs?.[0]?.page??0)+1;
  if(!fields.has(key))fields.set(key,[]);
  fields.get(key)!.push({value:answer,page:Number.isSafeInteger(page)&&page>0?page:1});
 }
 const applicant:Record<string,unknown>={
  firstNames:null,surname:null,idNumber:null,phone:null,maritalStatus:null,spouseName:null,
  disability:null,disaster:null,disasterDetails:null,propertyOwned:null,propertySold:null,
 };
 const household:Record<string,unknown>={incomeSource:null,dependants:[]};
 const extraFields:Record<string,string>={},provenance:Record<string,{page:number;rawText:string;state:'EXTRACTED'|'CONFLICT'}>={};
 for(const [key,entries] of fields){
  const distinct=[...new Set(entries.map(e=>e.value.toLowerCase()))];
  const main=entries[0];
  const state=distinct.length>1?'CONFLICT':'EXTRACTED';
  provenance[key]={page:main.page,rawText:main.value,state};
  if(key==='applicant.idNumber'){
   if(/^\d{13}$/.test(main.value))applicant.idNumber=main.value;
   else extraFields['unmapped-id-number']=main.value;
  }else if(key==='applicant.maritalStatus'){
   const status=main.value.toUpperCase().replace(/\s+/g,'_');
   if(['SINGLE','MARRIED','DIVORCED','WIDOWED'].includes(status))applicant.maritalStatus=status;
   else extraFields['unmapped-marital-status']=main.value;
  }else if(key==='household.incomeSource'){
   const income=main.value.toUpperCase().replace(/\s+/g,'_');
   if(['UNEMPLOYED','SOCIAL_GRANT','EMPLOYED','SELF_EMPLOYED','PENSION','OTHER'].includes(income))household.incomeSource=income;
   else extraFields['unmapped-income-source']=main.value;
  }else if(key.startsWith('applicant.')&&main.value.length<=250){
   applicant[key.slice('applicant.'.length)]=main.value;
  }else extraFields[key.slice(0,90)]=main.value;
 }
 return extractionProposalSchema.parse({version:1,applicant,household,extraFields,provenance,sections:classifyDocumentPages(doc)});
}

/** Client only: private scanning and real-data approval MUST occur before calling. */
export async function processScannedPdfWithDocumentAi(input:{
 pdf:Uint8Array;accessToken:string;processorName:string;fetcher?:(r:Request)=>Promise<Response>;
}):Promise<ExtractionProposal>{
 const {pdf,accessToken,processorName}=input;
 if(pdf.byteLength<5||pdf.byteLength>5*1024*1024)throw new Error('DOCUMENT_AI_PDF_SIZE');
 if(new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-')throw new Error('DOCUMENT_AI_PDF_INVALID');
 if(!/^projects\/[a-zA-Z0-9_-]+\/locations\/eu\/processors\/[a-zA-Z0-9_-]+$/.test(processorName))
  throw new Error('DOCUMENT_AI_PROCESSOR_NOT_ALLOWED');
 if(!accessToken)throw new Error('DOCUMENT_AI_CREDENTIAL_UNAVAILABLE');
 let base64='';
 for(let i=0;i<pdf.length;i+=32768)base64+=String.fromCharCode(...pdf.subarray(i,i+32768));
 const url='https://eu-documentai.googleapis.com/v1/'+processorName+':process';
 let response:Response;
 try{response=await (input.fetcher??fetch)(new Request(url,{
   method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
   body:JSON.stringify({rawDocument:{content:btoa(base64),mimeType:'application/pdf'}}),
   signal:AbortSignal.timeout(110_000),
  }));}catch{throw new Error('DOCUMENT_AI_UNAVAILABLE');}
 if(!response.ok)throw new Error('DOCUMENT_AI_PROCESSING_FAILED');
 let payload:unknown;
 try{payload=await response.json();}catch{throw new Error('DOCUMENT_AI_RESPONSE_INVALID');}
 return normaliseDocumentAi(payload);
}
