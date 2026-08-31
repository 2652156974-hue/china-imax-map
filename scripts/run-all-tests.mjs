import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = collectTests(path.join(ROOT, 'scripts'));

if (!tests.length) throw new Error('No *.test.mjs files found.');

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit'
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function collectTests(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectTests(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) output.push(fullPath);
  }
  return output.sort((a, b) => a.localeCompare(b, 'en'));
}
