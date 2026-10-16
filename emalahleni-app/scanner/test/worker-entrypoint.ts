// Local CI fixture only. Production uses src/entrypoint.ts and the authenticated app API.
import scanner, { DocumentScanner } from '../container-worker';
import {scanResult,digest,upload} from '../../src/evidence';
import type {Database} from '../../src/database';
import {readBytes} from '../../src/http';
export { DocumentScanner };
type Env = Parameters<typeof scanner.fetch>[1]&{EVIDENCE_BUCKET:R2Bucket};
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if(new URL(request.url).pathname==='/__ci_stored_upload'&&request.method==='POST'){
      if(request.headers.get('Authorization')!==`Bearer ${env.SCANNER_TOKEN}`)return new Response(null,{status:401});
      const bytes=await readBytes(request,5*1024*1024),hash=await digest(bytes);
      // Only SQL is doubled here: the production upload function owns real local R2 bytes
      // and invokes the actual Durable Object, Container and ClamAV service.
      const db={forActor:async(_actor:string,statements:{query:string;params?:unknown[]}[])=>{
        const {query,params=[]}=statements[0];
        if(query.startsWith('SELECT 1 FROM public.project_memberships'))return [[{allowed:1}]];
        if(query.startsWith('SELECT e.storage_key'))return [[{storage_key:'quarantine/ci/synthetic.pdf',status:'PENDING_UPLOAD',expected_size:bytes.length,expected_sha256:hash,expected_content_type:'application/pdf'}]];
        if(query.startsWith('UPDATE public.evidence SET status='))return [[{id:'synthetic-document'}]];
        if(query.startsWith('UPDATE public.evidence SET uploaded_at'))return [[]];
        if(query.startsWith('WITH scanned AS'))return [[{id:'synthetic-document',status:params[5],malware_status:params[4]}]];
        throw new Error('Unexpected CI database statement');
      }} as unknown as Database;
      const privateScanner={fetch:(input:RequestInfo|URL,init?:RequestInit)=>scanner.fetch(new Request(input,init),env)} as Fetcher;
      const input=new Request('https://app.internal/upload',{method:'PUT',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes).buffer});
      return Response.json(await upload(db,'synthetic-actor','synthetic-project','synthetic-case','synthetic-document',input,{ENABLE_DOCUMENT_UPLOADS:'true',EVIDENCE_BUCKET:env.EVIDENCE_BUCKET,SCANNER:privateScanner,SCANNER_TOKEN:env.SCANNER_TOKEN}));
    }
    if(new URL(request.url).pathname==='/__ci_upload_scan'&&request.method==='POST'){
      if(request.headers.get('Authorization')!==`Bearer ${env.SCANNER_TOKEN}`)return new Response(null,{status:401});
      const bytes=await readBytes(request,5*1024*1024);
      const privateScanner={fetch:(input:RequestInfo|URL,init?:RequestInit)=>scanner.fetch(new Request(input,init),env)} as Fetcher;
      return Response.json(await scanResult(bytes,await digest(bytes),{SCANNER:privateScanner,SCANNER_TOKEN:env.SCANNER_TOKEN}));
    }
    if (new URL(request.url).pathname === '/__ci_stop' && request.method === 'POST') {
      if (request.headers.get('Authorization') !== `Bearer ${env.SCANNER_TOKEN}`) return new Response(null,{status:401});
      await env.SCANNER_CONTAINER.getByName('private-scanner-v1').stop();
      return new Response(null,{status:204});
    }
    return scanner.fetch(request,env);
  },
} satisfies ExportedHandler<Env>;
