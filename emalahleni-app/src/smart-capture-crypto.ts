/**
 * Dedicated Smart Capture proposal encryption domain, separate from the
 * application's existing form ciphertext. Raw OCR must never enter logs.
 */
function decode64(value:string){
 return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
function encode64(bytes:Uint8Array){
 let data='';
 for(let i=0;i<bytes.length;i+=16384)data+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return btoa(data);
}
async function keyFrom(secret:string):Promise<CryptoKey>{
 const raw=decode64(secret);
 if(raw.byteLength!==32)throw new Error('SMART_CAPTURE_ENCRYPTION_UNCONFIGURED');
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
function context(project:string,importId:string){
 return new TextEncoder().encode(`vectrasa:smart-capture:v1:${project}:${importId}`);
}
export async function sealSmartCaptureProposal(value:unknown,secret:string,project:string,importId:string){
 const nonce=crypto.getRandomValues(new Uint8Array(12));
 const data=new TextEncoder().encode(JSON.stringify(value));
 if(data.byteLength>256*1024)throw new Error('SMART_CAPTURE_PROPOSAL_TOO_LARGE');
 const result=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,
  additionalData:context(project,importId)},await keyFrom(secret),data);
 return `sc1.${encode64(nonce)}.${encode64(new Uint8Array(result))}`;
}
export async function openSmartCaptureProposal(ciphertext:string,secret:string,project:string,importId:string):Promise<unknown>{
 const [version,nonce,encoded,extra]=ciphertext.split('.');
 if(version!=='sc1'||!nonce||!encoded||extra)throw new Error('SMART_CAPTURE_CIPHERTEXT_INVALID');
 const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(nonce),
  additionalData:context(project,importId)},await keyFrom(secret),decode64(encoded));
 return JSON.parse(new TextDecoder().decode(result));
}
