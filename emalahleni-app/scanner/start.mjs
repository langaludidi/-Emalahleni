// All processes run as the image's unprivileged scanner user.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createScannerServer } from './server.mjs';
const children = new Set();
let stopping = false;
function child(command,args) {
  const proc = spawn(command,args,{stdio:['ignore','ignore','ignore']});
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
const server = createScannerServer();
async function initialise() {
  // Load the image's public seed immediately. No network download precedes clamd startup.
  // The existing per-scan/health freshness gate still rejects missing or >7-day-old signatures.
  const daemon = child('clamd',['--config-file=/app/clamd.conf']);
  daemon.once('error',()=>console.error('SCANNER_START_FAILED'));
  daemon.once('exit',()=> { if (!stopping) console.error('SCANNER_STOPPED'); });
  // NotifyClamd can only reload signatures after the daemon accepts commands.
  // This is a bounded internal startup check, not an external health polling job.
  for(let attempt=0;attempt<120&&!stopping&&children.has(daemon);attempt++) {
    if(await pingDaemon()) {
      if(stopping)return;
      const updater=child('freshclam',['--config-file=/app/freshclam.conf','--daemon','--quiet']);
      updater.once('error',()=>console.error('SCANNER_SIGNATURE_UPDATE_FAILED'));
      updater.once('exit',()=>{if(!stopping)console.error('SCANNER_SIGNATURE_UPDATER_STOPPED');});
      // The Container SDK waits for this port. Keep it closed until the engine accepts commands,
      // so the first scan after an idle cold start does not race database loading.
      server.listen(Number(process.env.PORT ?? 8080),'0.0.0.0');
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!stopping)console.error('SCANNER_START_NOT_READY');
}
void initialise();
function shutdown() { stopping = true; if(server.listening)server.close(); for (const proc of children) proc.kill('SIGTERM'); setTimeout(()=>process.exit(0),5000).unref(); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
