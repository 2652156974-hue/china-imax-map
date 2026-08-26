import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_ENTRY = path.join(ROOT, 'tmp/cloudflare/worker-entry.mjs');
const BUNDLE_DIR = path.join(ROOT, 'tmp/cloudflare/worker-bundle');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

run(process.execPath, ['scripts/build-cloudflare-public.mjs']);
run(npx, ['wrangler', 'types']);
run(npx, ['tsc', '--noEmit']);

const entry = fs.existsSync(DEPLOY_ENTRY) ? 'tmp/cloudflare/worker-entry.mjs' : 'worker/index.mjs';
run(npx, ['wrangler', 'deploy', entry, '--dry-run', '--outdir', 'tmp/cloudflare/worker-bundle']);

const bundleFiles = fs.existsSync(BUNDLE_DIR) ? collectFiles(BUNDLE_DIR) : [];
const bundleBytes = bundleFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
console.log(JSON.stringify({
  ok: true,
  entry,
  bundleFiles: bundleFiles.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
  bundleBytes
}, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' && command === npx });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}
