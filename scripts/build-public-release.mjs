import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicDataset } from './build-public-dataset.mjs';
import { buildPublicAmapLayer } from './build-public-amap-layer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = path.join(ROOT, 'dist-public');
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');

const layer = buildPublicAmapLayer();
const dataset = buildPublicDataset({ runtimeMarkerCount: layer.accepted });
assertSafeOutput(DIST_ROOT);
fs.rmSync(DIST_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST_ROOT, 'data'), { recursive: true });

for (const filename of ['index.html', 'app.mjs', 'styles.css']) {
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
