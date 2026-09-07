import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCloudflarePublic } from './build-cloudflare-public.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = path.join(ROOT, 'tmp/cloudflare/worker-bundle');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const wranglerArgs = ['wrangler', 'deploy', '--dry-run', '--outdir', 'tmp/cloudflare/worker-bundle'];

const staticBuild = buildCloudflarePublic();
run(...commandFor(wranglerArgs));

const bundleFiles = fs.existsSync(BUNDLE_DIR) ? collectFiles(BUNDLE_DIR) : [];
const bundleBytes = bundleFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
console.log(JSON.stringify({
  ok: true,
  staticBuild,
  bundleFiles: bundleFiles.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
  bundleBytes,
  markerStorage: 'cloudflare-kv'
}, null, 2));

function commandFor(args) {
  if (process.platform !== 'win32') return [npx, args];
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [npx, ...args].join(' ')]];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
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
