/**
 * Private R2 quarantine keys are scoped to a single processing attempt.
 * Distinct keys prevent a stale worker from overwriting a newer attempt's PDF.
 */
import {z} from 'zod';
const uuid=z.string().uuid();
const attemptPath=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/original\.pdf$/;

export function smartCaptureQuarantineKey(project:string,importId:string,claimToken:string){
 return `smart-capture/quarantine/${uuid.parse(project)}/${uuid.parse(importId)}/${uuid.parse(claimToken)}/original.pdf`;
}
export function validSmartCaptureQuarantineKey(key:string,project:string,importId:string){
 const prefix=`smart-capture/quarantine/${uuid.parse(project)}/${uuid.parse(importId)}/`;
 return key.startsWith(prefix)&&attemptPath.test(key.slice(prefix.length));
}
