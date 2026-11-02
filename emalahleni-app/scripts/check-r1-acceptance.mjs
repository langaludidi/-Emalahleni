// Fail-closed deployment guard. This is not a deploy command.
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(join(root, 'wrangler.r1-acceptance.jsonc'), 'utf8'));
const expectedWorker = 'vectra-assure-r1-acceptance';
const expectedBucket = 'vectra-assure-r1-evidence-test';
const expectedScanner = 'vectra-assure-r1-scanner';
const expectedAuth = 'https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
function demand(ok, reason) {
  if (!ok) throw new Error('R1 acceptance preflight blocked: ' + reason);
}
demand(cfg.name === expectedWorker, 'Worker name is not dedicated');
demand(cfg.account_id === 'f887a522ca852a80491c2485853d4363', 'Cloudflare account differs');
demand(cfg.main === 'src/entrypoint.ts', 'Unexpected Worker entrypoint');
demand(cfg.workers_dev === true && !('routes' in cfg) && !('route' in cfg), 'Custom route is forbidden');
demand(cfg.preview_urls === false, 'Unexpected preview URL setting');
demand(cfg.r2_buckets?.length === 1 && cfg.r2_buckets[0].binding === 'EVIDENCE_BUCKET' && cfg.r2_buckets[0].bucket_name === expectedBucket, 'R2 is not isolated');
demand(cfg.containers?.length === 1 && cfg.containers[0].name === expectedScanner && cfg.containers[0].class_name === 'DocumentScanner', 'Scanner container is not isolated');
demand(cfg.exports?.DocumentScanner?.container === expectedScanner, 'Scanner export is not isolated');
demand(cfg.vars?.NEON_AUTH_BASE_URL === expectedAuth && cfg.vars?.NEON_AUTH_JWKS_URL === expectedAuth + '/.well-known/jwks.json', 'Acceptance Neon Auth URLs differ');
demand(process.env.NEXT_PUBLIC_NEON_AUTH_BASE_URL === expectedAuth, 'NEXT_PUBLIC_NEON_AUTH_BASE_URL must be set to acceptance Auth at build time');
for (const key of ['ENABLE_CASE_API', 'ENABLE_DOCUMENT_UPLOADS', 'ENABLE_ID_READING']) {
  demand(cfg.vars?.[key] === 'false', key + ' must remain disabled until synthetic acceptance clearance');
}
for (const key of ['DATABASE_URL', 'FORM_ENCRYPTION_KEY', 'SCANNER_TOKEN', 'CLOUDFLARE_API_TOKEN']) {
  demand(!(key in (cfg.vars || {})), key + ' must not be a plaintext Wrangler var');
}

if (process.argv.includes('--verify-assets')) {
  const webRoot = join(root, 'web', 'out', '_next', 'static');
  let foundAcceptance = false;
  let scanned = 0;
  async function walk(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const next = join(path, item.name);
      if (item.isDirectory()) await walk(next);
      else if (item.name.endsWith('.js')) {
        const body = await readFile(next, 'utf8');
        scanned++;
        if (body.includes('ep-shiny-field-zakdrjle')) foundAcceptance = true;
        demand(!body.includes('ep-cold-scene-zaa3qek2'), 'Built JavaScript still contains staging Neon Auth endpoint');
      }
    }
  }
  await walk(webRoot);
  demand(scanned > 0 && foundAcceptance, 'Built JavaScript does not contain acceptance Auth endpoint');
}
console.log('R1 acceptance configuration and build-time auth isolation verified.');
