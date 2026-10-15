import { Container } from '@cloudflare/containers';
interface Env { SCANNER_CONTAINER: DurableObjectNamespace<DocumentScanner>; SCANNER_TOKEN: string; }
export class DocumentScanner extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
  // Freshclam needs outbound HTTPS to the official ClamAV signature mirror.
  enableInternet = true;
  envVars = { SCANNER_TOKEN: this.env.SCANNER_TOKEN };
}
const unavailable = (error: 'SCANNER_START_FAILED' | 'SCANNER_CONNECTION_FAILED') => Response.json({error}, {status:503,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request: Request,env:Env):Promise<Response> {
    if (!env.SCANNER_TOKEN || env.SCANNER_TOKEN.length < 32 || request.headers.get('Authorization') !== `Bearer ${env.SCANNER_TOKEN}`) return new Response(null,{status:401});
    const path = new URL(request.url).pathname;
    if (!((request.method==='POST' && ['/scan','/read-id'].includes(path)) || (request.method==='GET' && path==='/healthz'))) return new Response(null,{status:404});
    if (Number(request.headers.get('Content-Length')) > 5*1024*1024) return new Response(null,{status:413});
    let container: DurableObjectStub<DocumentScanner>;
    try {
      container = env.SCANNER_CONTAINER.getByName('private-scanner-v1');
      await container.startAndWaitForPorts({cancellationOptions:{instanceGetTimeoutMS:8_000,portReadyTimeoutMS:30_000}});
    } catch { return unavailable('SCANNER_START_FAILED'); }
    try {
      return await container.fetch(new Request(request,{signal:AbortSignal.timeout(path==='/read-id'?60_000:20_000)}));
    } catch { return unavailable('SCANNER_CONNECTION_FAILED'); }
  },
} satisfies ExportedHandler<Env>;
