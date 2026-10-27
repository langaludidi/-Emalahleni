// Routine app releases retain the deployed private scanner image.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--with-containers')) {
  throw new Error('Use npm run deploy for the app, or npm run deploy:scanner to update the scanner too.');
}
const updateContainers = args.includes('--with-containers');
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
if (config.name !== 'emalahleni-api-staging' || config.main !== 'src/entrypoint.ts' ||
    config.exports?.DocumentScanner?.container !== 'emalahleni-scanner-staging-documentscanner') {
  throw new Error('Expected the app Worker with its existing private DocumentScanner container.');
}
// Preserve provider guards and existing runtime secrets. Never deploy a second Worker here.
console.log(updateContainers
  ? 'Deploying the app and scanner image; Docker is required.'
  : 'Deploying the app while retaining the currently deployed scanner image.');
const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', 'wrangler.jsonc',
  ...(updateContainers ? [] : ['--containers-rollout=none'])], {
  cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit',
});
child.once('error', () => { console.error('Deployment could not start.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });

