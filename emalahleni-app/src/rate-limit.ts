import {HttpError} from './http';

export interface RateLimitEnv {
 ENABLE_API_RATE_LIMITS?:string;
 API_RATE_LIMITER?:RateLimit;
 WRITE_RATE_LIMITER?:RateLimit;
 DOCUMENT_RATE_LIMITER?:RateLimit;
}
async function check(binding:RateLimit|undefined,scope:string,identity:string){
 if(!binding)throw new HttpError(503,'RATE_LIMIT_SERVICE_UNAVAILABLE');
 // Never use caller-selected object keys, raw bearer tokens or personal details as keys.
 const bytes=new TextEncoder().encode(`emalahleni-api-staging:${scope}:${identity}`);
 const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
 let allowed:boolean;
 try{allowed=(await binding.limit({key})).success;}catch{throw new HttpError(503,'RATE_LIMIT_SERVICE_UNAVAILABLE');}
 if(!allowed)throw new HttpError(429,'TOO_MANY_REQUESTS',{'Retry-After':'60'});
}
export async function limitPublicApi(request:Request,env:RateLimitEnv){
 if(env.ENABLE_API_RATE_LIMITS!=='true')return;
 // Cloudflare supplies this address at the edge. Ignore X-Forwarded-For and user headers.
 await check(env.API_RATE_LIMITER,'api',request.headers.get('CF-Connecting-IP')??'unknown');
}
export async function limitActorAction(request:Request,env:RateLimitEnv,actor:string){
 if(env.ENABLE_API_RATE_LIMITS!=='true'||['GET','HEAD'].includes(request.method))return;
 await check(env.WRITE_RATE_LIMITER,'write',actor);
 if(/\/evidence\/[0-9a-f-]+\/(upload|scan|read-id)$|\/document-service-check$/i.test(new URL(request.url).pathname)){
  await check(env.DOCUMENT_RATE_LIMITER,'document',actor);
 }
}
