// Workers Builds authorises this app Worker. Deploy its app and private Container together.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
if (config.name !== 'emalahleni-api-staging' || config.main !== 'src/entrypoint.ts' ||
    config.exports?.DocumentScanner?.container !== 'emalahleni-scanner-staging-documentscanner') {
  throw new Error('Expected the app Worker with its existing private DocumentScanner container.');
}
// Preserve provider guards and existing runtime secrets. Never deploy a second Worker here.
const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', 'wrangler.jsonc'], {
  cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit',
});
child.once('error', () => { console.error('Deployment could not start.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
