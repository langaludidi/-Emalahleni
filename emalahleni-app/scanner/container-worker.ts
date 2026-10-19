import { Container, type StopParams } from '@cloudflare/containers';
import { startupReason, startupDiagnostic, type StartupReason } from './startup-errors';
import { scannerHealthReasons } from '../src/evidence-contracts';
import { readBytes } from '../src/http';
interface Env { SCANNER_CONTAINER: DurableObjectNamespace<DocumentScanner>; SCANNER_TOKEN: string; }
export class DocumentScanner extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
  // Freshclam needs outbound HTTPS to the official ClamAV signature mirror.
  enableInternet = true;
  envVars = { SCANNER_TOKEN: this.env.SCANNER_TOKEN };

  override onStart(): void { console.info('SCANNER_TRANSPORT_READY'); }
  override onStop(params: StopParams): void {
    console.info('SCANNER_CONTAINER_STOPPED', { exitCode: params.exitCode, reason: params.reason });
  }

  override onError(error: unknown): never {
    console.error('SCANNER_RUNTIME_ERROR', startupDiagnostic(error, this.env));
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    try {
      // The private HTTP listener opens immediately. Engine readiness is a
      // separate gate below, so a slow signature load never looks like a dead port.
      await this.startAndWaitForPorts({ cancellationOptions: {
        abort: request.signal, instanceGetTimeoutMS: 30_000, portReadyTimeoutMS: 90_000,
      } });
    } catch (error) {
      const reason = startupReason(error);
      console.error('SCANNER_START_FAILED', { ...startupDiagnostic(error, this.env), elapsedMs: Date.now() - started });
      return unavailable('SCANNER_START_FAILED', reason);
    }
    try {
      const deadline=Date.now()+90_000;
      let healthReason:typeof scannerHealthReasons[number]|undefined;
      while(Date.now()<deadline){
        request.signal.throwIfAborted();
        const health=await super.fetch(new Request('http://scanner.internal/healthz',{
          headers:{Authorization:request.headers.get('Authorization')??''},signal:request.signal,
        }));
        if(health.status===200){
          if(new URL(request.url).pathname==='/healthz')return health;
          await readBytes(health,1024);
          return await super.fetch(request);
        }
        if(health.status!==503)return health;
        try{
          const value=JSON.parse(new TextDecoder().decode(await readBytes(health,1024))) as {reason?:unknown};
          healthReason=scannerHealthReasons.find(code=>code===value.reason);
        }catch{healthReason=undefined;}
        if(healthReason&&!['SCAN_UNAVAILABLE','SCAN_TIMEOUT','READ_TIMEOUT'].includes(healthReason)){
          return Response.json({error:'SCANNER_NOT_READY',reason:healthReason},{status:503,headers:{'Cache-Control':'no-store'}});
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      return Response.json({error:'SCANNER_NOT_READY',...(healthReason?{reason:healthReason}:{})},{status:503,headers:{'Cache-Control':'no-store'}});
    }
    catch { return unavailable('SCANNER_CONNECTION_FAILED'); }
  }
}
const unavailable = (error: 'SCANNER_START_FAILED' | 'SCANNER_CONNECTION_FAILED', reason?: StartupReason) => Response.json({error,...(reason?{reason}:{})}, {status:503,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request: Request,env:Env):Promise<Response> {
    if (!env.SCANNER_TOKEN || env.SCANNER_TOKEN.length < 32 || request.headers.get('Authorization') !== `Bearer ${env.SCANNER_TOKEN}`) return new Response(null,{status:401});
    const path = new URL(request.url).pathname;
    if (!((request.method==='POST' && ['/scan','/read-id'].includes(path)) || (request.method==='GET' && path==='/healthz'))) return new Response(null,{status:404});
    if (Number(request.headers.get('Content-Length')) > 5*1024*1024) return new Response(null,{status:413});
    try {
      const container = env.SCANNER_CONTAINER.getByName('private-scanner-v1');
      // Native fetch carries the request and cancellation into the same object
      // that owns startup. No cross-object SDK lifecycle RPC is required.
      return await container.fetch(new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(120_000)])}));
    } catch (error) {
      const reason = startupReason(error);
      console.error('SCANNER_START_FAILED', startupDiagnostic(error, env));
      return unavailable('SCANNER_START_FAILED', reason);
    }
  },
} satisfies ExportedHandler<Env>;

