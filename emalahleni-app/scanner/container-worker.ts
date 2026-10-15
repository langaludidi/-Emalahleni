import { Container } from '@cloudflare/containers';
import { startupReason, type StartupReason } from './startup-errors';
interface Env { SCANNER_CONTAINER: DurableObjectNamespace<DocumentScanner>; SCANNER_TOKEN: string; }
export class DocumentScanner extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
  // Freshclam needs outbound HTTPS to the official ClamAV signature mirror.
  enableInternet = true;
  envVars = { SCANNER_TOKEN: this.env.SCANNER_TOKEN };

  override onStart(): void { console.info('SCANNER_CONTAINER_READY'); }

  override onError(error: unknown): never {
    console.error('SCANNER_RUNTIME_ERROR', { reason: startupReason(error) });
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    try {
      // Keep lifecycle work inside the Durable Object. A cold ClamAV database
      // load on the half-vCPU instance needs more time than a small HTTP server.
      await this.startAndWaitForPorts({ cancellationOptions: {
        abort: request.signal, instanceGetTimeoutMS: 30_000, portReadyTimeoutMS: 90_000,
      } });
    } catch (error) {
      const reason = startupReason(error);
      console.error('SCANNER_START_FAILED', { reason, elapsedMs: Date.now() - started });
      return unavailable('SCANNER_START_FAILED', reason);
    }
    try { return await super.fetch(request); }
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
      console.error('SCANNER_START_FAILED', { reason });
      return unavailable('SCANNER_START_FAILED', reason);
    }
  },
} satisfies ExportedHandler<Env>;
