// Private Cloudflare Worker used via a service binding, not a public upload endpoint.
interface Env { SCANNER_ORIGIN:string;SCANNER_TOKEN:string; }
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/scan'||!env.SCANNER_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.SCANNER_TOKEN}`)return new Response(null,{status:401});
 const origin=new URL(env.SCANNER_ORIGIN);if(origin.protocol!=='https:')return new Response(null,{status:503});
 try{return await fetch(new URL('/scan',origin),{method:'POST',headers:{Authorization:`Bearer ${env.SCANNER_TOKEN}`,'Content-Type':'application/octet-stream'},body:request.body,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{return new Response(null,{status:503});}
}} satisfies ExportedHandler<Env>;
