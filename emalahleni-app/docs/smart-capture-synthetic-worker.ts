/**
 * Standalone Cloudflare dashboard test Worker. This is NOT the Smart Capture
 * application processor. It has no Neon, Drive, R2 or production bindings.
 * Keep its message schema intentionally distinct from production queue schema 1.
 */
export default {
 async fetch():Promise<Response>{
  return new Response('VectraSA Smart Capture - Synthetic Test Worker',{
   headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
  });
 },
 async queue(batch:MessageBatch<unknown>):Promise<void>{
  for(const message of batch.messages){
   const data=message.body;
   if(data!==null && typeof data==='object' && !Array.isArray(data) &&
    (data as Record<string,unknown>).type==='SMART_CAPTURE_SYNTHETIC_TEST' &&
    (data as Record<string,unknown>).synthetic===true){
    console.log('Synthetic queue test processed',{messageId:message.id});
    message.ack();
   }else{
    // This test worker must never attempt to process a production import.
    console.warn('Rejected non-synthetic queue message',{messageId:message.id});
    message.ack();
   }
  }
 }
};
