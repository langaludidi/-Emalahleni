// Optional adapter for a private, separately hosted scanner. The default deployment uses container-worker.ts.
interface Env { SCANNER_ORIGIN:string; SCANNER_TOKEN:string; }
export default {async fetch(request:Request,env:Env){
  const path = new URL(request.url).pathname;
  if(!env.SCANNER_TOKEN || env.SCANNER_TOKEN.length<32 || request.headers.get('Authorization')!==`Bearer ${env.SCANNER_TOKEN}`) return new Response(null,{status:401});
  if(!((request.method==='POST' && ['/scan','/read-id'].includes(path)) || (request.method==='GET' && path==='/healthz'))) return new Response(null,{status:404});
  try {
    const origin=new URL(env.SCANNER_ORIGIN);
    if(origin.protocol!=='https:') return new Response(null,{status:503});
    return await fetch(new URL(path,origin),{method:request.method,headers:{Authorization:`Bearer ${env.SCANNER_TOKEN}`,'Content-Type':request.headers.get('Content-Type')??'application/octet-stream'},body:request.body,redirect:'error',signal:AbortSignal.timeout(path==='/read-id'?65_000:20_000)});
  } catch { return new Response(null,{status:503}); }
}} satisfies ExportedHandler<Env>;
