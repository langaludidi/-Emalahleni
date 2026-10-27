/**
 * SC-031: isolated Cloudflare Queue to Neon smoke-test handler.
 * IMPORTANT: this is NOT the beneficiary processor and is NOT configured as
 * the existing VectraSA Worker entrypoint. Bundle using Wrangler/npm.
 */
import {neon} from '@neondatabase/serverless';
interface ProbeEnv{
 SYNTHETIC_NEON_DATABASE_URL?:string;
 SYNTHETIC_NEON_PROBE_ENABLED?:string;
}
type SyntheticMessage={type:'SMART_CAPTURE_SYNTHETIC_NEON_PROBE';synthetic:true};
function isProbe(payload:unknown):payload is SyntheticMessage{
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return false;
 const x=payload as Record<string,unknown>;
 return x.type==='SMART_CAPTURE_SYNTHETIC_NEON_PROBE'&&x.synthetic===true
  &&Object.keys(x).length===2;
}
export function checkSyntheticDatabaseUrl(connection:string){
 const url=new URL(connection);
 if(!['postgres:','postgresql:'].includes(url.protocol)||
  decodeURIComponent(url.username)!=='vectra_sc_synthetic_limited'||
  url.pathname!=='/vectra_preview'||
  !url.hostname.endsWith('.neon.tech')||
  url.searchParams.get('sslmode')!=='require')
  throw new Error('SYNTHETIC_PROBE_DATABASE_REJECTED');
 return connection;
}
export async function probeSyntheticNeon(env:ProbeEnv){
 if(env.SYNTHETIC_NEON_PROBE_ENABLED!=='true'||!env.SYNTHETIC_NEON_DATABASE_URL)
  throw new Error('SYNTHETIC_PROBE_DISABLED');
 const connection=checkSyntheticDatabaseUrl(env.SYNTHETIC_NEON_DATABASE_URL);
 const sql=neon(connection);
 const rows=await sql`SELECT marker,synthetic_imports FROM smart_capture_test.integration_probe WHERE id=1`;
 if(rows.length!==1||rows[0].marker!=='SYNTHETIC_ONLY'||rows[0].synthetic_imports!==2)
  throw new Error('SYNTHETIC_PROBE_INVALID');
 return true;
}
export default {
 async fetch():Promise<Response>{
  return new Response('VectraSA isolated synthetic Neon probe (queue only)',{
   headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}
  });
 },
 async queue(batch:MessageBatch<unknown>,env:ProbeEnv):Promise<void>{
  for(const message of batch.messages){
   if(!isProbe(message.body)){message.ack();continue;}
   try{
    await probeSyntheticNeon(env);
    console.log('Synthetic Neon probe passed',{messageId:message.id});
    message.ack();
   }catch{
    // Never print credentials, DB errors or data. Exhaust bounded queue retries
    // to the test-only DLQ, rather than silently discarding a failed probe.
    console.warn('Synthetic Neon probe failed',{messageId:message.id});
    message.retry();
   }
  }
 }
};
