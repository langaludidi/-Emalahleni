// Deliberate, fail-closed deployment entrypoint for the disposable acceptance Worker.
// No automatic deployments, no custom domains, and no production/staging Worker changes.
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedAccount = 'f887a522ca852a80491c2485853d4363';
const expectedAuth = 'https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
function assert(condition, reason) {
  if (!condition) throw new Error('R1 isolated deployment refused: ' + reason);
}
assert(process.argv.length === 3 && process.argv[2] === '--deploy-isolated',
  'requires explicit --deploy-isolated flag');
assert(process.env.R1_ISOLATED_DEPLOY_APPROVED === 'vectra-assure-r1-acceptance',
  'requires explicit R1_ISOLATED_DEPLOY_APPROVED acceptance Worker name');
assert(process.env.CLOUDFLARE_ACCOUNT_ID === expectedAccount,
  'Cloudflare account ID does not match');
assert(Boolean(process.env.CLOUDFLARE_API_TOKEN),
  'a scoped Cloudflare API token is required in the execution environment');
assert(process.env.NEXT_PUBLIC_NEON_AUTH_BASE_URL === expectedAuth,
  'frontend build must use the isolated test-branch Neon Auth URL');
assert(!process.env.DATABASE_URL && !process.env.FORM_ENCRYPTION_KEY && !process.env.SCANNER_TOKEN,
  'first deploy must be inert: do not attach database, form or scanner secrets yet');

async function run(executable, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { cwd:root, stdio:'inherit',
      env:{...process.env, WRANGLER_SEND_METRICS:'false'} });
    child.on('error', rejectRun);
    child.on('close', code => code === 0 ? resolveRun() :
      rejectRun(new Error(executable + ' ' + args.join(' ') + ' exited ' + code)));
  });
}
await run(process.execPath, [join(root, 'scripts/check-r1-acceptance.mjs')]);
await run('npx', ['next', 'build', 'web']);
await run(process.execPath, [join(root, 'scripts/check-r1-acceptance.mjs'), '--verify-assets']);
console.log('Deploying isolated R1 Worker with CASE API, uploads and ID reading disabled.');
console.log('Cloudflare deploy is not transactional: if container creation fails, inspect and remove only the acceptance Worker.');
await run('npx', ['wrangler', 'deploy', '--config', 'wrangler.r1-acceptance.jsonc']);
