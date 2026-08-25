import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudflarePublic } from './build-cloudflare-public.mjs';
import { buildMinimalMarkerLayer, stableStringify, validateMarkerLayer } from './public-marker-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');
const DEFAULT_LAYER = path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json');
const OUTPUT_DIR = path.resolve(process.env.PUBLIC_AMAP_MARKER_OUTPUT_DIR || path.join(ROOT, 'tmp/cloudflare'));
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'public-amap-markers.json');
const HASH_FILE = path.join(OUTPUT_DIR, 'public-amap-markers.sha256');
const reviewedLayerFile = path.resolve(process.env.PUBLIC_AMAP_REVIEWED_FILE || DEFAULT_LAYER);

export function prepareCloudflareDeploy() {
  if (!fs.existsSync(reviewedLayerFile) || !fs.statSync(reviewedLayerFile).isFile()) {
    throw new Error(`Deploy marker layer is missing: ${reviewedLayerFile}`);
  }
  const layer = readJson(reviewedLayerFile);
  validateMarkerLayer(layer);
  const markerLayer = buildMinimalMarkerLayer(layer);
  const dataset = readJson(PUBLIC_DATASET);
  if (dataset?.mode !== 'public-amap-runtime' || !Array.isArray(dataset.records) || dataset.records.length !== 901) {
    throw new Error('Production deploy requires the frozen 901-record public fact layer.');
  }
  if (dataset.coordinatesPublished !== 0 || dataset.runtimeMarkerCount !== markerLayer.records.length) {
    throw new Error('Public fact layer does not match the zero-static-coordinate runtime marker contract.');
  }
  if (/providerLat|providerLng|rawCandidates|rankedCandidates|AMAP_JS_SECURITY_CODE/i.test(JSON.stringify(dataset))) {
    throw new Error('Public fact layer contains forbidden provider, raw candidate, or credential fields.');
  }

  const serialized = `${stableStringify(markerLayer)}\n`;
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, serialized, 'utf8');
  fs.writeFileSync(HASH_FILE, `${hash}  public-amap-markers.json\n`, 'utf8');
  const staticBuild = buildCloudflarePublic();

  return {
    ok: true,
    mode: 'cloudflare-deploy-prepared',
    output: 'dist-public',
    markerArtifact: path.relative(ROOT, OUTPUT_FILE).replaceAll(path.sep, '/'),
    markerSha256: hash,
    records: dataset.records.length,
    staticCoordinates: dataset.coordinatesPublished,
    runtimeMarkers: markerLayer.records.length,
    markerSource: 'runtime-secret-file',
    securityCodeInBundle: staticBuild.securityCodeInBundle
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareCloudflareDeploy(), null, 2));
}
