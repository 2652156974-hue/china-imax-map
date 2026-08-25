import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAcceptedMarker, validateMarkerLayer } from './public-amap-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = path.join(ROOT, 'dist-public');
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');
const DEFAULT_LAYER = path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json');
const reviewedLayerFile = path.resolve(process.env.PUBLIC_AMAP_REVIEWED_FILE || DEFAULT_LAYER);

if (!fs.existsSync(reviewedLayerFile) || !fs.statSync(reviewedLayerFile).isFile()) {
  throw new Error(`Deploy marker layer is missing: ${reviewedLayerFile}`);
}

const layer = JSON.parse(fs.readFileSync(reviewedLayerFile, 'utf8'));
validateMarkerLayer(layer);
const markerCount = layer.records.filter(hasAcceptedMarker).length;
if (markerCount !== 901) {
  throw new Error(`Production deploy requires 901 accepted markers; received ${markerCount}.`);
}

const dataset = JSON.parse(fs.readFileSync(PUBLIC_DATASET, 'utf8'));
if (dataset?.mode !== 'public-amap-runtime' || !Array.isArray(dataset.records) || dataset.records.length !== 901) {
  throw new Error('Production deploy requires the frozen 901-record public fact layer.');
}
if (dataset.coordinatesPublished !== 0 || dataset.runtimeMarkerCount !== markerCount) {
  throw new Error('Public fact layer does not match the zero-static-coordinate runtime marker contract.');
}
if (JSON.stringify(dataset).match(/providerLat|providerLng|rawCandidates|AMAP_JS_SECURITY_CODE/i)) {
  throw new Error('Public fact layer contains forbidden provider, raw candidate, or credential fields.');
}

assertSafeOutput(DIST_ROOT);
fs.rmSync(DIST_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST_ROOT, 'data'), { recursive: true });

for (const filename of ['index.html', 'app.mjs', 'styles.css']) {
  fs.copyFileSync(path.join(ROOT, filename), path.join(DIST_ROOT, filename));
}
fs.copyFileSync(PUBLIC_DATASET, path.join(DIST_ROOT, 'data/cinemas.json'));

console.log(JSON.stringify({
  ok: true,
  mode: 'public-deploy-prepared',
  output: 'dist-public',
  records: dataset.records.length,
  staticCoordinates: dataset.coordinatesPublished,
  runtimeMarkers: markerCount,
  markerSource: 'runtime-secret-file',
  securityCodeInBundle: false
}, null, 2));

function assertSafeOutput(outputRoot) {
  const expected = path.join(ROOT, 'dist-public');
  if (path.resolve(outputRoot) !== path.resolve(expected)) {
    throw new Error(`Refusing to replace unsafe public output directory: ${outputRoot}`);
  }
}
