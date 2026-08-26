import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = path.join(ROOT, 'dist-public');
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');
const STATIC_FILES = ['index.html', 'app.mjs', 'public-location-format.mjs', 'nearby.mjs', 'admin-clusters.mjs', 'styles.css', '_headers'];

export function buildCloudflarePublic() {
  const dataset = readJson(PUBLIC_DATASET);
  validatePublicDataset(dataset);
  assertSafeOutput(DIST_ROOT);

  fs.rmSync(DIST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_ROOT, 'data'), { recursive: true });
  for (const filename of STATIC_FILES) fs.copyFileSync(path.join(ROOT, filename), path.join(DIST_ROOT, filename));
  fs.copyFileSync(PUBLIC_DATASET, path.join(DIST_ROOT, 'data/cinemas.json'));

  const files = collectFiles(DIST_ROOT).map((file) => path.relative(DIST_ROOT, file).replaceAll(path.sep, '/')).sort();
  if (files.some((file) => /(?:data\/local|provider-cache|rawCandidates|rankedCandidates|coordinate|marker).*\.(?:json|csv|geojson)$/i.test(file))) {
    throw new Error('Cloudflare static output contains a private or coordinate artifact.');
  }
  const outputText = files.filter((file) => /\.(?:html|mjs|js|css|json|txt)$/i.test(file)).map((file) => fs.readFileSync(path.join(DIST_ROOT, file), 'utf8')).join('\n');
  if (/AMAP_JS_SECURITY_CODE|securityJsCode|rawCandidates|rankedCandidates/i.test(outputText)) {
    throw new Error('Cloudflare static output contains raw candidates or credentials.');
  }

  return {
    ok: true,
    mode: 'cloudflare-static-assets',
    output: 'dist-public',
    files,
    records: dataset.records.length,
    staticCoordinates: dataset.coordinatesPublished,
    runtimeMarkers: dataset.runtimeMarkerCount,
    securityCodeInBundle: false
  };
}

function validatePublicDataset(dataset) {
  if (dataset?.mode !== 'public-amap-runtime' || !Array.isArray(dataset.records) || dataset.records.length !== 901) {
    throw new Error('Cloudflare static build requires the frozen 901-record public fact layer.');
  }
  if (dataset.coordinatesPublished !== 0 || dataset.runtimeMarkerCount !== 901) {
    throw new Error('Cloudflare static build requires zero static coordinates and 901 runtime markers.');
  }
  if (/providerLat|providerLng|rawCandidates|rankedCandidates|AMAP_JS_SECURITY_CODE/i.test(JSON.stringify(dataset))) {
    throw new Error('Public fact layer contains forbidden provider, raw candidate, or credential fields.');
  }
  for (const record of dataset.records) {
    if (record.location?.lat !== null || record.location?.lng !== null) throw new Error(`Public record ${record.id} contains static coordinates.`);
  }
}

function assertSafeOutput(outputRoot) {
  if (path.resolve(outputRoot) !== path.join(ROOT, 'dist-public')) throw new Error(`Refusing to replace unsafe public output directory: ${outputRoot}`);
}

function collectFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildCloudflarePublic(), null, 2));
}
