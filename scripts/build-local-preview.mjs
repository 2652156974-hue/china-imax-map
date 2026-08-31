import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalPreviewDocument } from './local-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const outputFile = path.join(ROOT, 'data/local/cinemas-preview.json');
const document = buildLocalPreviewDocument({
  derived: readJson('data/derived/cinemas.json'),
  mainlandAudit: readJson('data/audit/geocode-mainland-full.json'),
  reviewedOverrides: readJson('data/geocode/reviewed-overrides.json'),
});

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  output: 'data/local/cinemas-preview.json',
  status: document.status,
  records: document.records.length,
  coordinatesPublishedLocally: document.coordinatesPublished,
  nullCoordinates: document.summary.nullCoordinates,
  evidenceCounts: document.summary.evidenceCounts,
}, null, 2));
