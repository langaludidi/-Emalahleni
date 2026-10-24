// Read-only public cutover check. No credentials, DNS writes or sign-in attempts.
const origin='https://app.vectrasa.co.za';
const auth='https://ep-cold-scene-zaa3qek2.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
async function check(task){try{return await task();}catch{return {ready:false,reason:'Connection or TLS check did not complete.'};}}
const dns=await check(async()=>{
  const response=await fetch('https://dns.google/resolve?name=app.vectrasa.co.za&type=A',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {ready:false,reason:'Public DNS lookup failed.'};
  const result=await response.json();
  return {ready:result.Status===0&&result.Answer?.some(record=>record.type===1)===true,reason:result.Status===3?'Hostname is not published in DNS yet.':undefined};
});
const authOrigin=await check(async()=>{
  const response=await fetch(auth+'/get-session',{headers:{Origin:origin},signal:AbortSignal.timeout(10000),redirect:'manual'});
  const allowed=(response.ok||response.status===401)&&response.headers.get('access-control-allow-origin')===origin&&response.headers.get('access-control-allow-credentials')==='true';
  await response.body?.cancel();
  return {ready:allowed,reason:allowed?'Origin accepted; this does not verify a user sign-in.':'Auth origin has not been confirmed.'};
});
const app=dns.ready?await check(async()=>{
  const response=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(10000),redirect:'manual'});
  if(!response.ok)return {ready:false,reason:'The custom domain is not serving the app health endpoint.'};
  const result=await response.json();
  return {ready:result.application==='Vectra Assure'&&result.status==='operational',mode:result.mode};
}):{ready:false,reason:'Waiting for DNS before checking HTTPS and the application.'};
const ready=dns.ready&&authOrigin.ready&&app.ready;
console.log(JSON.stringify({origin,checkedAt:new Date().toISOString(),status:ready?'ready':'pending',checks:{dns,authOrigin,httpsApplication:app}},null,2));
process.exitCode=ready?0:2;
