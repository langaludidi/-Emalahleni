import {z} from 'zod';
import {digest,type EvidenceEnv} from './evidence';
import {HttpError,readBytes} from './http';
import {parseIdText,validSaId} from './id-reading';
import {startupReasons} from '../scanner/startup-errors';

const healthSchema=z.object({status:z.literal('ready'),malwareScanner:z.literal('ready'),idReader:z.literal('ready')}).strict();
const scanSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.literal('CLEAN')}).strict();
const readingSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),text:z.string().max(16000)}).strict();
const syntheticId='9001010000080';

function syntheticPdf(){
 // Fixed ASCII-only, one-page specimen. No caller input, beneficiary data or R2 objects enter this probe.
 // Courier's fixed metrics also avoid substituting proportional-font widths during rasterisation.
 const content='BT /F1 18 Tf 40 730 Td (SPECIMEN - SYNTHETIC DOCUMENT SERVICE TEST) Tj /F1 26 Tf 0 -80 Td (NAMES: SYNTHETIC TEST) Tj 0 -55 Td (SURNAME: EXAMPLE) Tj 0 -55 Td (IDENTITY NUMBER: 9001010000080) Tj 0 -55 Td (DATE OF BIRTH: 1990-01-01) Tj ET';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
 ];
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(let index=0;index<objects.length;index++){offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
 const xref=pdf.length;
 pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
 return new TextEncoder().encode(pdf);
}
const specimen=syntheticPdf();
export interface DocumentServiceProbe {status:'ready';checks:{scannerHealth:true;cleanScan:true;idReading:true};}
export type DocumentServiceCheck='STARTUP'|'STARTUP_CONFIGURATION'|'STARTUP_INSTANCE'|'STARTUP_PORT'|'STARTUP_EXIT'|'STARTUP_RPC'|'CONNECTION'|'CREDENTIALS'|'HEALTH'|'SCAN'|'ID_READING'|'ID_VALIDATION';
export class DocumentServiceCheckError extends HttpError {
 constructor(readonly failedCheck:DocumentServiceCheck){super(503,'DOCUMENT_SERVICE_NOT_READY');}
}

export async function probeDocumentService(env:EvidenceEnv):Promise<DocumentServiceProbe>{
 if(!env.SCANNER||!env.SCANNER_TOKEN||env.SCANNER_TOKEN.length<32)throw new HttpError(503,'DOCUMENT_SERVICE_NOT_CONFIGURED');
 const scanner=env.SCANNER,token=env.SCANNER_TOKEN;
 let check:DocumentServiceCheck='HEALTH';
 async function call(path:string,timeout:number,bytes?:Uint8Array){
  const response=await scanner.fetch(new Request(`https://scanner.internal${path}`,{
   method:bytes?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(bytes?{'Content-Type':'application/pdf'}:{})},
   ...(bytes?{body:new Uint8Array(bytes).buffer}:{}),signal:AbortSignal.timeout(timeout)
  }));
  if(response.status!==200){
   if(response.status===401){await response.body?.cancel();throw new DocumentServiceCheckError('CREDENTIALS');}
   // Only fixed operational codes may cross this boundary. Never forward provider text.
   try{
    const value=JSON.parse(new TextDecoder().decode(await readBytes(response,1024))) as {error?:unknown;reason?:unknown};
    if(value.error==='SCANNER_START_FAILED'){
     const reason=startupReasons.find(candidate=>candidate===value.reason);
     throw new DocumentServiceCheckError(reason&&reason!=='UNKNOWN'?`STARTUP_${reason}`:'STARTUP');
    }
    if(value.error==='SCANNER_CONNECTION_FAILED')throw new DocumentServiceCheckError('CONNECTION');
   }catch(error){if(error instanceof DocumentServiceCheckError)throw error;}
   throw new DocumentServiceCheckError(check);
  }
  return JSON.parse(new TextDecoder().decode(await readBytes(response,131072))) as unknown;
 }
 try{
  if(!validSaId(syntheticId))throw new Error('INVALID_SPECIMEN');
  const sha256=await digest(specimen);
  healthSchema.parse(await call('/healthz',120000));
  check='SCAN';
  const scanned=scanSchema.parse(await call('/scan',45000,specimen));
  if(scanned.sha256!==sha256)throw new Error('SCAN_HASH_MISMATCH');
  check='ID_READING';
  const reading=readingSchema.parse(await call('/read-id',120000,specimen));
  if(reading.sha256!==sha256)throw new Error('READ_HASH_MISMATCH');
  check='ID_VALIDATION';
  const parsed=parseIdText(reading.text);
  if(parsed.fields.firstNames!=='SYNTHETIC TEST'||parsed.fields.surname!=='EXAMPLE'||parsed.fields.idNumber!==syntheticId||parsed.dateOfBirth!=='1990-01-01')throw new Error('READ_MISMATCH');
  return {status:'ready',checks:{scannerHealth:true,cleanScan:true,idReading:true}};
 }catch(error){
  // Provider messages and OCR text never become API errors, audit data or logs.
  if(error instanceof DocumentServiceCheckError)throw error;
  throw new DocumentServiceCheckError(check);
 }
}
