// Isolated probe preflight: read-only, no credentials, no Cloudflare API calls.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function fail(message){throw new Error('SC_NEON_PROBE_PREFLIGHT: '+message);}
const text=readFileSync(resolve(root,'wrangler.smart-capture-neon-probe.jsonc'),'utf8');
const config=JSON.parse(text.replace(/\/\/[^\n]*/g,''));
if(config.name!=='vectra-smart-capture-neon-probe')fail('unexpected Worker name');
if(config.main!=='src/smart-capture-synthetic-neon-worker.ts')fail('unexpected entrypoint');
if(config.workers_dev!==false||config.routes)fail('public URL/route must be disabled');
if(config.vars?.SYNTHETIC_NEON_PROBE_ENABLED!=='false')fail('probe feature must default to disabled');
if(config.vars?.SYNTHETIC_NEON_DATABASE_URL||config.vars?.DATABASE_URL)fail('never embed database URLs');
if(config.r2_buckets||config.durable_objects||config.services)fail('unexpected sensitive bindings');
const q=config.queues?.consumers;
if(!Array.isArray(q)||q.length!==1||q[0].queue!=='vectra-smart-capture-neon-probe-test'||
 q[0].dead_letter_queue!=='vectra-smart-capture-neon-probe-test-dlq'||
 q[0].max_batch_size!==1||q[0].max_retries!==3||q[0].max_concurrency!==1)
 fail('unexpected queue routing or retry limits');
if(config.queues?.producers)fail('probe must not produce to beneficiary queues');
console.log('PASS: synthetic-only Worker config and queue isolation');
console.log('NEXT: operator must confirm correct Cloudflare account, queues, and secret before any deployment');
