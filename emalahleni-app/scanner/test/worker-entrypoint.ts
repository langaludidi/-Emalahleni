// Local CI fixture only. Production uses src/entrypoint.ts and the authenticated app API.
import scanner, { DocumentScanner } from '../container-worker';
import {scanResult,digest} from '../../src/evidence';
import {readBytes} from '../../src/http';
export { DocumentScanner };
type Env = Parameters<typeof scanner.fetch>[1];
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
