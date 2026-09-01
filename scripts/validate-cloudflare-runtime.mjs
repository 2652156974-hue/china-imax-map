import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeMarkerLayer } from './public-marker-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'tmp/cloudflare/public-amap-markers.json');

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`Cloudflare runtime marker file is missing: ${input}`);
const layer = validateRuntimeMarkerLayer(JSON.parse(fs.readFileSync(input, 'utf8')));
console.log(JSON.stringify({
  ok: true,
  mode: layer.mode,
  coordinateSystem: layer.coordinateSystem,
  records: layer.records.length,
  firstSourceRow: layer.records[0]?.sourceRow ?? null,
  lastSourceRow: layer.records.at(-1)?.sourceRow ?? null
}, null, 2));
