import scanner, { DocumentScanner } from '../scanner/container-worker';
import { handle, type Env } from './worker';
import {consumeSmartCaptureBatch} from './smart-capture-queue';

// Keep this export on the app Worker: the existing namespace owns this class.
export { DocumentScanner };

interface RuntimeEnv extends Env {
  SCANNER_CONTAINER?: DurableObjectNamespace<DocumentScanner>;
}

function withScanner(env:RuntimeEnv):RuntimeEnv&{SCANNER?:Fetcher}{
 const namespace=env.SCANNER_CONTAINER;
 const privateScanner=namespace?{
  fetch:(input:RequestInfo|URL,init?:RequestInit)=>scanner.fetch(new Request(input,init),{
   SCANNER_CONTAINER:namespace,SCANNER_TOKEN:env.SCANNER_TOKEN??''
  }),
 } as Fetcher:undefined;
 return {...env,SCANNER:privateScanner};
}
export default {
  async queue(batch:MessageBatch<unknown>,env:RuntimeEnv):Promise<void>{
    await consumeSmartCaptureBatch(batch,withScanner(env));
  },
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    return handle(request,withScanner(env));
  },
} satisfies ExportedHandler<RuntimeEnv>;
