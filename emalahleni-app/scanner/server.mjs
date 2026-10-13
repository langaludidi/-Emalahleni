// ClamAV adapter: deploy privately behind a TLS gateway, never expose clamd itself.
import http from 'node:http';
import net from 'node:net';
import { createHash,timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const limit=5*1024*1024;
const secret=process.env.SCANNER_TOKEN;
if(!secret||secret.length<32)throw new Error('SCANNER_TOKEN must contain at least 32 characters.');
function authorised(header){const supplied=Buffer.from(header??'');const expected=Buffer.from(`Bearer ${secret}`);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
export function scan(bytes){return new Promise((resolve,reject)=>{
 const socket=net.createConnection({host:process.env.CLAMAV_HOST??'127.0.0.1',port:Number(process.env.CLAMAV_PORT??3310)});let reply='';let settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(value);};
 socket.setTimeout(15000,()=>finish(new Error('SCAN_TIMEOUT')));socket.on('error',e=>finish(e));
 socket.on('connect',()=>{socket.write(Buffer.from('zINSTREAM\0'));for(let offset=0;offset<bytes.length;offset+=65536){const chunk=bytes.subarray(offset,offset+65536);const length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);socket.write(length);socket.write(chunk);}socket.write(Buffer.alloc(4));});
 socket.on('data',chunk=>{reply+=chunk.toString();if(reply.length>4096)return finish(new Error('INVALID_SCANNER_RESPONSE'));if(reply.includes('\0')){const line=reply.split('\0')[0];if(line==='stream: OK')finish(null,'CLEAN');else if(/^stream: .+ FOUND$/.test(line))finish(null,'INFECTED');else finish(new Error('SCAN_FAILED'));}});
 socket.on('end',()=>{if(!settled)finish(new Error('INCOMPLETE_SCANNER_RESPONSE'));});
});}
export function createScannerServer(){return http.createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(req.url!=='/scan'||req.method!=='POST')return send(404,{error:'NOT_FOUND'});
 if(!authorised(req.headers.authorization))return send(401,{error:'UNAUTHENTICATED'});
 const chunks=[];let size=0;
 try{for await(const chunk of req){size+=chunk.length;if(size>limit){send(413,{error:'BODY_TOO_LARGE'});req.destroy();return;}chunks.push(chunk);}if(!size)return send(400,{error:'EMPTY_FILE'});const bytes=Buffer.concat(chunks);const sha256=createHash('sha256').update(bytes).digest('hex');const verdict=await scan(bytes);send(200,{sha256,verdict});}catch{send(503,{error:'SCAN_UNAVAILABLE'});}
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createScannerServer().listen(Number(process.env.PORT??8080),process.env.LISTEN_HOST??'127.0.0.1');
