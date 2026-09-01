import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicDataset } from './build-public-dataset.mjs';
import { buildPublicAmapLayer } from './build-public-amap-layer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = path.join(ROOT, 'dist-public');
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');
const DEFAULT_REVIEWED_SOURCE = [
  path.join(ROOT, 'data/local/private-reviewed-geocodes.json'),
  path.join(ROOT, 'data/local/cinemas-preview.json')
].find((file) => fs.existsSync(file));
const REVIEWED_SOURCE = process.env.PUBLIC_AMAP_REVIEWED_SOURCE_FILE
  ? path.resolve(process.env.PUBLIC_AMAP_REVIEWED_SOURCE_FILE)
  : DEFAULT_REVIEWED_SOURCE;
const REVIEWED_OUTPUT = path.resolve(
  process.env.PUBLIC_AMAP_REVIEWED_FILE || path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json')
);

if (!REVIEWED_SOURCE) {
  throw new Error('Public release assembly requires PUBLIC_AMAP_REVIEWED_SOURCE_FILE when the private data/local layer is excluded.');
}
if (!fs.existsSync(REVIEWED_SOURCE)) {
  throw new Error(`Public release marker source is missing: ${REVIEWED_SOURCE}`);
}

const layer = buildPublicAmapLayer({ inputFile: REVIEWED_SOURCE, outputFile: REVIEWED_OUTPUT });
const dataset = buildPublicDataset({ runtimeMarkerCount: layer.accepted });
assertSafeOutput(DIST_ROOT);
fs.rmSync(DIST_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST_ROOT, 'data'), { recursive: true });

for (const filename of [
  'index.html',
  'app.mjs',
  'styles.css',
  'nearby.mjs',
  'admin-clusters.mjs',
  'cinema-lifecycle.mjs',
  'focus-navigation.mjs',
  'focus-navigation.css',
  'marker-render-descriptor.mjs',
  'navigation-coordinator.mjs',
  'render-signature.mjs',
  'visible-state.mjs'
]) {
  fs.copyFileSync(path.join(ROOT, filename), path.join(DIST_ROOT, filename));
}
fs.copyFileSync(PUBLIC_DATASET, path.join(DIST_ROOT, 'data/cinemas.json'));

console.log(JSON.stringify({
  ok: true,
  output: 'dist-public',
  dataset: {
    records: dataset.records,
    staticCoordinates: dataset.staticCoordinates,
    runtimeMarkerCount: dataset.runtimeMarkerCount
  },
  markerLayer: {
    input: path.relative(ROOT, layer.outputFile).replaceAll(path.sep, '/'),
    accepted: layer.accepted,
    unresolved: layer.unresolved
  },
  server: 'scripts/public-amap-server.mjs',
  securityCodeInBundle: false
}, null, 2));

function assertSafeOutput(outputRoot) {
  const expected = path.join(ROOT, 'dist-public');
  if (path.resolve(outputRoot) !== path.resolve(expected)) {
    throw new Error(`Refusing to replace unsafe public output directory: ${outputRoot}`);
  }
}
