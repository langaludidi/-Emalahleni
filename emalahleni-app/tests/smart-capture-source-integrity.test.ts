import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySmartCaptureSourcePdf} from '../src/smart-capture-source-integrity';
const project='00000000-0000-4000-8000-000000000001';
const importId='00000000-0000-4000-8000-000000000002';
const key=`smart-capture/quarantine/${project}/${importId}/00000000-0000-4000-8000-000000000004/original.pdf`;
const bytes=new TextEncoder().encode('%PDF-1.4 synthetic test only');
const sha=async(data:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
const bucket=(data:Uint8Array|null,size=data?.length??0)=>({get:async()=>data?{size,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}:null}) as unknown as R2Bucket;
test('SC-I07 verified synthetic source PDF allows draft preflight',async()=>{
 await verifySmartCaptureSourcePdf({bucket:bucket(bytes),project,importId,storageKey:key,contentSha256:await sha(bytes)});
});
test('SC-I07 missing source PDF fails closed',async()=>{
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(null),project,importId,storageKey:key,contentSha256:await sha(bytes)}),{code:'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE'});
});
test('SC-I07 altered PDF bytes fail hash verification',async()=>{
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(new TextEncoder().encode('altered')),project,importId,storageKey:key,contentSha256:await sha(bytes)}),{code:'SMART_CAPTURE_STORAGE_MISMATCH'});
});
test('SC-I07 wrong import quarantine key fails before reading storage',async()=>{
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(bytes),project,importId,storageKey:key.replace(importId,'00000000-0000-4000-8000-000000000005'),contentSha256:await sha(bytes)}),{code:'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE'});
});
test('SC-I07 oversized PDF fails before hashing',async()=>{
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(bytes,5*1024*1024+1),project,importId,storageKey:key,contentSha256:await sha(bytes)}),{code:'SMART_CAPTURE_SOURCE_PDF_UNAVAILABLE'});
});

test('SC-I07 non-PDF bytes are rejected even with a matching checksum',async()=>{
 const payload=new TextEncoder().encode('synthetic plain text, not a PDF');
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(payload),project,importId,storageKey:key,contentSha256:await sha(payload)}),{code:'SMART_CAPTURE_STORAGE_MISMATCH'});
});
test('SC-I07 truncated R2 reads fail closed before draft insertion',async()=>{
 await assert.rejects(verifySmartCaptureSourcePdf({bucket:bucket(bytes,bytes.length+1),project,importId,storageKey:key,contentSha256:await sha(bytes)}),{code:'SMART_CAPTURE_STORAGE_MISMATCH'});
});
