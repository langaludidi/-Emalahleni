import {HttpError} from './http';
import {validSmartCaptureQuarantineKey} from './smart-capture-storage';

/** Fail closed when a quarantined source PDF is missing, oversized or altered. */
export async function verifySmartCaptureSourcePdf(input:{
 bucket?:Pick<R2Bucket,'get'>;
 project:string;importId:string;storageKey:string|null;contentSha256:string|null;
}):Promise<void>{
 const {bucket,project,importId,storageKey,contentSha256}=input;
 if(!storageKey||!contentSha256||!/^[a-f0-9]{64}$/.test(contentSha256)||
  !validSmartCaptureQuarantineKey(storageKey,project,importId))
  throw new HttpError(409,'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE');
 if(!bucket)throw new HttpError(503,'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE');
 const stored=await bucket.get(storageKey);
 if(!stored||stored.size<5||stored.size>5*1024*1024)
  throw new HttpError(409,'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE');
 const bytes=new Uint8Array(await stored.arrayBuffer());
 if(bytes.byteLength!==stored.size||bytes.byteLength<5||
  bytes[0]!==37||bytes[1]!==80||bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)
  throw new HttpError(409,'SMART_CAPTURE_STORAGE_MISMATCH');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))))
  .map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(hash!==contentSha256)throw new HttpError(409,'SMART_CAPTURE_STORAGE_MISMATCH');
}
