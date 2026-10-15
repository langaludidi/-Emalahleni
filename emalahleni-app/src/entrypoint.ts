import scanner, { DocumentScanner } from '../scanner/container-worker';
import { handle, type Env } from './worker';

// Keep this export on the app Worker: the existing namespace owns this class.
export { DocumentScanner };

interface RuntimeEnv extends Env {
  SCANNER_CONTAINER?: DurableObjectNamespace<DocumentScanner>;
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const namespace = env.SCANNER_CONTAINER;
    // Only the authenticated API can invoke this adapter. It has no public route.
    const privateScanner = namespace ? {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => scanner.fetch(new Request(input, init), {
        SCANNER_CONTAINER: namespace,
        SCANNER_TOKEN: env.SCANNER_TOKEN ?? '',
      }),
    } as Fetcher : undefined;
    return handle(request, { ...env, SCANNER: privateScanner });
  },
} satisfies ExportedHandler<RuntimeEnv>;
