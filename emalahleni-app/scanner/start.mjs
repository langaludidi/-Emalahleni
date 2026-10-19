// All processes run as the image's unprivileged scanner user.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createScannerServer, readiness } from './server.mjs';
const children = new Set();
let stopping = false;
function child(command,args,onStderr) {
  const proc = spawn(command,args,{stdio:['ignore','ignore',onStderr?'pipe':'ignore']});
  if(onStderr)proc.stderr.on('data',onStderr);
  children.add(proc); proc.once('exit',()=>children.delete(proc));
  return proc;
}
function pingDaemon() {
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port:3310});
    let reply='',settled=false;
    const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
    socket.setTimeout(1000,()=>finish(false));
    socket.on('error',()=>finish(false));socket.on('end',()=>finish(false));
    socket.on('connect',()=>socket.write('zPING\0'));
    socket.on('data',bytes=>{reply+=bytes.toString();if(reply.length>32)finish(false);else if(reply.includes('\0'))finish(reply.split('\0')[0]==='PONG');});
  });
}
console.info('SCANNER_PROCESS_STARTED',{credentialConfigured:typeof process.env.SCANNER_TOKEN==='string'&&process.env.SCANNER_TOKEN.length>=32});
let engineReady=false,bootError='',engineFailure='';
const server = createScannerServer({ready:async()=>{
  if(engineFailure)throw new Error(engineFailure);
  return readiness();
}});
// Liveness is distinct from readiness: health remains503 and scan/read paths
// retain their malware/freshness gates while clamd loads its database.
server.listen(Number(process.env.PORT ?? 8080),'0.0.0.0');
function safeBootError(){
  const token=process.env.SCANNER_TOKEN??'';
  return (token?bootError.split(token).join('[redacted]'):bootError).replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s"']+/gi,'[redacted URL]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,2048);
}
async function initialise() {
  // Load the image's public seed immediately. No network download precedes clamd startup.
  // The existing per-scan/health freshness gate still rejects missing or >7-day-old signatures.
  const daemon = child('/usr/sbin/clamd',['--config-file=/app/clamd.conf'],bytes=>{
    if(!engineReady&&bootError.length<4096)bootError+=bytes.toString().slice(0,4096-bootError.length);
  });
  daemon.once('error',error=>{
    engineFailure=error.code==='EACCES'?'ENGINE_PERMISSION':'ENGINE_STOPPED';
    console.error('SCANNER_DAEMON_START_FAILED',{code:error.code??'UNKNOWN',reason:engineFailure});
  });
  daemon.once('exit',(code,signal)=> { if (!stopping) {
    engineFailure=/permission denied/i.test(bootError)?'ENGINE_PERMISSION':/cannot allocate|out of memory|bad_alloc/i.test(bootError)?'ENGINE_MEMORY':/no supported database|can.t open.*database|malformed database/i.test(bootError)?'ENGINE_DATABASE':signal==='SIGKILL'?'ENGINE_KILLED':'ENGINE_STOPPED';
    console.error('SCANNER_DAEMON_STOPPED',{code,signal,reason:engineFailure,...(!engineReady?{startupError:safeBootError()}:{})});
  }});
  // NotifyClamd can only reload signatures after the daemon accepts commands.
  // This is a bounded internal startup check, not an external health polling job.
  for(let attempt=0;attempt<120&&!stopping&&children.has(daemon);attempt++) {
    if(await pingDaemon()) {
      if(stopping)return;
      engineReady=true;bootError='';
      console.info('SCANNER_ENGINE_STARTED');
      const updater=child('/usr/bin/freshclam',['--config-file=/app/freshclam.conf','--daemon','--quiet']);
      updater.once('error',()=>console.error('SCANNER_SIGNATURE_UPDATE_FAILED'));
      updater.once('exit',()=>{if(!stopping)console.error('SCANNER_SIGNATURE_UPDATER_STOPPED');});
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!stopping)console.error('SCANNER_START_NOT_READY');
}
void initialise();
function shutdown(signal) { stopping = true;console.info('SCANNER_SHUTDOWN',{signal});if(server.listening)server.close(); for (const proc of children) proc.kill('SIGTERM'); setTimeout(()=>process.exit(0),5000).unref(); }
process.on('SIGTERM',()=>shutdown('SIGTERM')); process.on('SIGINT',()=>shutdown('SIGINT'));

