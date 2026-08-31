import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'audit', 'project-manifest.json');

export function buildProjectManifest({ generatedAt = new Date().toISOString() } = {}) {
  const paths = collectFiles(ROOT)
    .map(file => toPosix(path.relative(ROOT, file)))
    .filter(relativePath => relativePath !== 'data/audit/project-manifest.json')
    .sort((a, b) => a.localeCompare(b, 'en'));
  const tracked = new Set(runGit(['ls-files']).split(/\r?\n/).filter(Boolean).map(toPosix));
  const ignored = ignoredPaths(paths);
  const files = paths.map(relativePath => {
    const fullPath = path.join(ROOT, relativePath);
    const buffer = fs.readFileSync(fullPath);
    const role = classify(relativePath);
    return {
      path: relativePath,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      gitState: tracked.has(relativePath) ? 'tracked' : ignored.has(relativePath) ? 'ignored' : 'untracked',
      role: role.role,
      publicationClass: role.publicationClass
    };
  });

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    project: 'china-imax-map',
    root: '.',
    exclusions: ['.git/', '.playwright-cli/', 'tmp/', 'node_modules/'],
    summary: {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      byGitState: countBy(files, file => file.gitState),
      byRole: countBy(files, file => file.role),
      byPublicationClass: countBy(files, file => file.publicationClass)
    },
    files
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { output: OUTPUT, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildProjectManifest();
  console.log(JSON.stringify({
    ok: true,
    output: toPosix(path.relative(ROOT, result.output)),
    ...result.manifest.summary
  }, null, 2));
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', '.playwright-cli', 'tmp', 'node_modules'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function classify(relativePath) {
  if (relativePath.startsWith('data/raw/')) return role('source-snapshot', 'internal-never-public');
  if (relativePath.startsWith('data/geocode/provider-cache/')) return role('provider-cache', 'private-never-public');
  if (relativePath.startsWith('data/local/')) return role('local-review-or-preview', 'private-never-public');
  if (relativePath.startsWith('dist-private/')) return role('generated-private-runtime', 'private-never-public');
  if (relativePath.startsWith('data/audit/geocode-') || relativePath.startsWith('data/audit/amap-')) {
    return role('coordinate-audit', 'internal-review-before-publication');
  }
  if (relativePath.startsWith('data/audit/')) return role('data-audit', 'public-summary-after-review');
  if (relativePath.startsWith('data/derived/')) return role('derived-data', 'internal-derived');
  if (relativePath.startsWith('data/public/')) return role('public-dataset', 'public-safe-output');
  if (relativePath.startsWith('data/geocode/')) return role('geocode-configuration', 'public-source');
  if (relativePath === 'data/cinemas.json') return role('legacy-demo-data', 'public-legacy');
  if (relativePath.startsWith('private-amap/')) return role('private-map-source', 'public-source-no-data');
  if (relativePath.startsWith('scripts/fixtures/')) return role('test-fixture', 'public-source');
  if (relativePath.startsWith('scripts/')) return role('project-tooling', 'public-source');
  if (['START_PRIVATE_MAP.cmd', 'STOP_PRIVATE_MAP.cmd'].includes(relativePath)) return role('project-launcher', 'public-source');
  if (relativePath.startsWith('docs/') || relativePath.endsWith('.md')) return role('documentation', 'public-source');
  if (relativePath === 'index.html') return role('public-map-source', 'public-source');
  if (relativePath === '.env.example') return role('environment-template', 'public-source');
  if (relativePath === '.gitignore' || relativePath === 'package.json') return role('project-configuration', 'public-source');
  return role('project-file', 'review');
}

function ignoredPaths(paths) {
  if (!paths.length) return new Set();
  try {
    return new Set(runGit(['check-ignore', '--stdin'], `${paths.join('\n')}\n`).split(/\r?\n/).filter(Boolean).map(toPosix));
  } catch {
    return new Set();
  }
}

function runGit(args, input) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}

function role(roleName, publicationClass) {
  return { role: roleName, publicationClass };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}
