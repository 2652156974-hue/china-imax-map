import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMinimalMarkerLayer, stableStringify } from './public-marker-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json');
const OUTPUT_DIR = path.resolve(process.env.PUBLIC_AMAP_MARKER_OUTPUT_DIR || path.join(ROOT, 'tmp/cloudflare'));
const OUTPUT_FILE = path.resolve(process.env.PUBLIC_AMAP_MARKER_OUTPUT_FILE || path.join(OUTPUT_DIR, 'public-amap-markers.json'));
const HASH_FILE = path.resolve(process.env.PUBLIC_AMAP_MARKER_HASH_FILE || path.join(OUTPUT_DIR, 'public-amap-markers.sha256'));
const inputFile = path.resolve(process.env.PUBLIC_AMAP_REVIEWED_FILE || DEFAULT_INPUT);

export function prepareCloudflareMarker({ input = inputFile, output = OUTPUT_FILE, hashFile = HASH_FILE } = {}) {
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
    throw new Error(`Public AMap reviewed layer is missing: ${input}`);
  }
  const layer = JSON.parse(fs.readFileSync(input, 'utf8'));
  const minimalLayer = buildMinimalMarkerLayer(layer);
  const serialized = `${stableStringify(minimalLayer)}\n`;
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, 'utf8');
  fs.writeFileSync(hashFile, `${hash}  ${path.basename(output)}\n`, 'utf8');
  return {
    ok: true,
    input: path.relative(ROOT, input).replaceAll(path.sep, '/'),
    output: path.relative(ROOT, output).replaceAll(path.sep, '/'),
    hashFile: path.relative(ROOT, hashFile).replaceAll(path.sep, '/'),
    sha256: hash,
    records: minimalLayer.records.length,
    coordinateSystem: minimalLayer.coordinateSystem
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareCloudflareMarker(), null, 2));
}
