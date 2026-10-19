// Private binary document service. No document text, filenames, tokens or scan signatures are logged.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 16_000;
const MAX_PIXELS = 12_000_000;
class ServiceError extends Error { constructor(code, status = 503) { super(code); this.status = status; } }
const problem = (code, status) => new ServiceError(code, status);

function authorised(header, secret) {
  const supplied = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function clamCommand(command, bytes, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: options.host ?? process.env.CLAMAV_HOST ?? '127.0.0.1', port: options.port ?? Number(process.env.CLAMAV_PORT ?? 3310) });
    let reply = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(15_000, () => finish(problem('SCAN_TIMEOUT')));
    socket.on('error', () => finish(problem('SCAN_UNAVAILABLE')));
    socket.on('connect', () => {
      socket.write(Buffer.from(`z${command}\0`));
      if (bytes) {
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          const chunk = bytes.subarray(offset, offset + 65536), length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length); socket.write(length); socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      }
    });
    socket.on('data', chunk => {
      reply += chunk.toString();
      if (reply.length > 4096) return finish(problem('INVALID_SCANNER_RESPONSE'));
      if (reply.includes('\0')) finish(null, reply.split('\0')[0]);
    });
    socket.on('end', () => { if (!settled) finish(problem('INCOMPLETE_SCANNER_RESPONSE')); });
  });
}
export async function scan(bytes, options) {
  await signaturesReady(options);
  const line = await clamCommand('INSTREAM', bytes, options);
  if (line === 'stream: OK') return 'CLEAN';
  if (/^stream: .+ FOUND$/.test(line)) return 'INFECTED';
  throw problem('SCAN_FAILED');
}

// No shell is used. Every decoder runs under the image's unprivileged account,
// with process-group cancellation, address-space, CPU, open-file and output limits.
export function runTool(command, args, { timeout = 15_000, maxOutput = MAX_TEXT, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('prlimit', ['--as=1073741824', '--cpu=30', '--fsize=33554432', '--nofile=64', '--', command, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: tmpdir(), OMP_THREAD_LIMIT: '1', OMP_NUM_THREADS: '1' },
    });
    const output = []; let length = 0, settled = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) stop(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(problem('READ_TIMEOUT'));
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', () => finish(problem('READ_TOOLS_UNAVAILABLE')));
    child.stdout.on('data', chunk => { length += chunk.length; if (length > maxOutput) finish(problem('READ_OUTPUT_TOO_LARGE', 422)); else output.push(chunk); });
    // Decoder errors can contain document content. Discard stderr, including when a tool fails.
    child.stderr.resume();
    child.on('close', code => code === 0 ? finish(null, Buffer.concat(output).toString('utf8')) : finish(problem('DOCUMENT_UNREADABLE', 422)));
  });
}

function checkImage(bytes, contentType) {
  let width, height;
  if (contentType === 'image/png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR') throw problem('INVALID_DOCUMENT', 422);
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw problem('INVALID_DOCUMENT', 422);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw problem('INVALID_DOCUMENT', 422);
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 7) break;
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw problem('INVALID_DOCUMENT', 422);
  if (width > 6000 || height > 6000 || width * height > MAX_PIXELS) throw problem('IMAGE_TOO_LARGE', 422);
}

export async function readId(bytes, contentType, { scanFile = scan, signal } = {}) {
  // The malware gate is deliberately inside this function, before even pdfinfo or an image decoder.
  if (await scanFile(bytes) !== 'CLEAN') throw problem('DOCUMENT_INFECTED', 422);
  if (!['application/pdf','image/jpeg','image/png'].includes(contentType)) throw problem('UNSUPPORTED_MEDIA_TYPE', 415);
  const directory = await mkdtemp(join(tmpdir(), 'emalahleni-read-'));
  try {
    const input = join(directory, 'input');
    await writeFile(input, bytes, { mode: 0o600 });
    let pages;
    if (contentType === 'application/pdf') {
      if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) throw problem('INVALID_DOCUMENT', 422);
      const info = await runTool('pdfinfo', [input], { signal, timeout: 8_000 });
      const count = Number(info.match(/^Pages:\s+(\d+)\s*$/m)?.[1]);
      if (!Number.isInteger(count) || count < 1 || count > 2) throw problem('PDF_PAGE_LIMIT', 422);
      await runTool('pdftoppm', ['-f','1','-l',String(count),'-r','200','-scale-to','2600','-png',input,join(directory,'page')], { signal, timeout: 15_000 });
      pages = (await readdir(directory)).filter(name => /^page-\d+\.png$/.test(name)).sort().map(name => join(directory,name));
      if (pages.length !== count) throw problem('DOCUMENT_UNREADABLE', 422);
    } else {
      checkImage(bytes, contentType); pages = [input];
    }
    const text = [];
    for (const page of pages) {
      const result = await runTool('tesseract', [page,'stdout','-l','eng','--psm','6'], { signal, timeout: 20_000 });
      text.push(result.replace(/\x00/g,''));
      if (Buffer.byteLength(text.join('\n')) > MAX_TEXT) throw problem('READ_OUTPUT_TOO_LARGE', 422);
    }
    return text.join('\n').trim();
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function signaturesReady(clamOptions) {
  const version = await clamCommand('VERSION', undefined, clamOptions);
  // ClamAV VERSION includes engine/database-version/database-date. Refuse missing/stale databases.
  const match = version.match(/^ClamAV [^/]+\/(\d+)\/(.+)$/);
  const updated = match ? Date.parse(match[2]) : NaN;
  if (!match || !Number(match[1]) || !Number.isFinite(updated) || Date.now() - updated > 7 * 86400_000 || updated > Date.now() + 86400_000) throw problem('SIGNATURES_NOT_READY');
}

export async function readiness({ clamOptions, run = runTool } = {}) {
  await signaturesReady(clamOptions);
  if (await clamCommand('PING', undefined, clamOptions) !== 'PONG') throw problem('SCAN_UNAVAILABLE');
  await Promise.all([
    run('tesseract',['--list-langs'],{ timeout: 5_000 }).then(value => { if (!/^eng$/m.test(value)) throw problem('READ_TOOLS_UNAVAILABLE'); }).catch(()=>{throw problem('TESSERACT_UNAVAILABLE');}),
    run('pdfinfo',['-v'],{ timeout: 5_000 }).catch(()=>{throw problem('PDFINFO_UNAVAILABLE');}),
    run('pdftoppm',['-v'],{ timeout: 5_000 }).catch(()=>{throw problem('PDFTOPPM_UNAVAILABLE');}),
  ]);
  return { status: 'ready', malwareScanner: 'ready', idReader: 'ready' };
}

export function createScannerServer(options = {}) {
  const secret = options.secret ?? process.env.SCANNER_TOKEN;
  if (!secret || secret.length < 32) throw new Error('SCANNER_TOKEN must contain at least 32 characters.');
  const scanFile = options.scanFile ?? scan, ready = options.ready ?? readiness;
  let busy = false;
  const server = http.createServer(async (req,res) => {
    const send = (status,body) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(body)); };
    if (!authorised(req.headers.authorization,secret)) { req.resume(); return send(401,{error:'UNAUTHENTICATED'}); }
    const path = new URL(req.url,'http://scanner').pathname;
    if (req.method === 'GET' && path === '/healthz') {
      try { return send(200,await ready()); } catch (error) {
        const allowed=['ENGINE_EXEC_PERMISSION','ENGINE_LOG_PERMISSION','ENGINE_SOCKET_PERMISSION','ENGINE_DATABASE_PERMISSION','ENGINE_CONFIG_PERMISSION','ENGINE_TEMP_PERMISSION','ENGINE_MEMORY','ENGINE_PERMISSION','ENGINE_DATABASE','ENGINE_KILLED','ENGINE_STOPPED','SIGNATURES_NOT_READY','SCAN_UNAVAILABLE','SCAN_TIMEOUT','READ_TOOLS_UNAVAILABLE','READ_TIMEOUT','DOCUMENT_UNREADABLE','TESSERACT_UNAVAILABLE','PDFINFO_UNAVAILABLE','PDFTOPPM_UNAVAILABLE'];
        const reason=allowed.find(code=>code===error?.message);
        return send(503,{error:'SCANNER_NOT_READY',...(reason?{reason}:{})});
      }
    }
    if (req.method !== 'POST' || !['/scan','/read-id'].includes(path)) { req.resume(); return send(404,{error:'NOT_FOUND'}); }
    const type = String(req.headers['content-type'] ?? '').split(';')[0].toLowerCase();
    const supported = ['application/pdf','image/jpeg','image/png',...(path === '/scan' ? ['application/octet-stream'] : [])];
    if (!supported.includes(type)) { req.resume(); return send(415,{error:'UNSUPPORTED_MEDIA_TYPE'}); }
    if (busy) { req.resume(); res.setHeader('Retry-After','1'); return send(429,{error:'SCANNER_BUSY'}); }
    busy = true;
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 50_000);
    let sha256;
    try {
      if (Number(req.headers['content-length']) > MAX_BYTES) throw problem('BODY_TOO_LARGE',413);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BYTES) throw problem('BODY_TOO_LARGE',413); chunks.push(chunk); }
      if (!size) throw problem('EMPTY_FILE',400);
      const bytes = Buffer.concat(chunks); sha256 = createHash('sha256').update(bytes).digest('hex');
      if (path === '/scan') return send(200,{ sha256, verdict: await scanFile(bytes) });
      const text = await readId(bytes,type,{ scanFile,signal: controller.signal });
      return send(200,{sha256,text});
    } catch (error) {
      req.resume();
      if (path === '/read-id' && sha256 && error instanceof ServiceError && error.message === 'DOCUMENT_INFECTED') send(422,{sha256,verdict:'INFECTED'});
      else send(error instanceof ServiceError ? error.status : 503,{ error: error instanceof ServiceError ? error.message : 'SCAN_UNAVAILABLE' });
    } finally { clearTimeout(deadline); busy = false; }
  });
  server.requestTimeout = 55_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createScannerServer().listen(Number(process.env.PORT ?? 8080), process.env.LISTEN_HOST ?? '127.0.0.1');
}

