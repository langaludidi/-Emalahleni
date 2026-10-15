// Local CI fixture only. Production uses src/entrypoint.ts and the authenticated app API.
import scanner, { DocumentScanner } from '../container-worker';
export { DocumentScanner };
type Env = Parameters<typeof scanner.fetch>[1];
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/__ci_stop' && request.method === 'POST') {
      if (request.headers.get('Authorization') !== `Bearer ${env.SCANNER_TOKEN}`) return new Response(null,{status:401});
      await env.SCANNER_CONTAINER.getByName('private-scanner-v1').stop();
      return new Response(null,{status:204});
    }
    return scanner.fetch(request,env);
  },
} satisfies ExportedHandler<Env>;
