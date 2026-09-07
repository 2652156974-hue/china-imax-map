import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCanonicalScreenField } from '../nearby.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'data/public/cinemas.json');
const FIELDS = ['width', 'height', 'area', 'seats'];

export function summarizeCanonicalDisplay(records, { before = false } = {}) {
  const summary = Object.fromEntries(FIELDS.map((field) => [field, before
    ? { displayedCanonical: 0, displayedPending: 0, missing: 0, reviewedButCurrentlyShownPending: 0 }
    : { displayedCanonicalReviewed: 0, displayedCanonicalDirect: 0, unresolved: 0, missing: 0 }]));

  for (const record of records ?? []) {
    for (const field of FIELDS) {
      const state = before ? legacyDisplayState(record, field) : resolveCanonicalScreenField(record, field).status;
      if (before) {
        if (state === 'direct') summary[field].displayedCanonical += 1;
        else if (state === 'missing') summary[field].missing += 1;
        else {
          summary[field].displayedPending += 1;
          if (hasReviewedField(record, field)) summary[field].reviewedButCurrentlyShownPending += 1;
        }
      } else if (state === 'reviewed') summary[field].displayedCanonicalReviewed += 1;
      else if (state === 'direct') summary[field].displayedCanonicalDirect += 1;
      else if (state === 'missing') summary[field].missing += 1;
      else summary[field].unresolved += 1;
    }
  }
  return { recordCount: records?.length ?? 0, fields: summary };
}

function legacyDisplayState(record, field) {
  const isSeats = field === 'seats';
  const source = isSeats ? record : record?.screen ?? {};
  const rawField = isSeats ? 'seatsRaw' : `raw${field[0].toUpperCase()}${field.slice(1)}`;
  const raw = String((isSeats ? record?.[rawField] : source?.[rawField]) ?? '').replace(/\u00a0/g, ' ').trim();
  const value = Number(source?.[field]);
  const confidence = isSeats ? null : source?.selectionConfidence;
  const allowed = confidence === undefined || confidence === null || confidence === 'high';
  const valid = isSeats ? Number.isInteger(value) && value >= 0 : Number.isFinite(value) && value > 0;
  const single = isSeats ? /^\d+$/.test(raw) : /^[-+]?\d+(?:\.\d+)?$/.test(raw);
  if (!raw) return 'missing';
  return valid && allowed && single ? 'direct' : 'pending';
}

function hasReviewedField(record, field) {
  const review = record?.screenSeatReview;
  return review?.confidence === 'high' && Array.isArray(review.materializedFields) && review.materializedFields.includes(field);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const records = readJson(filePath).records;
  console.log(JSON.stringify({
    ok: true,
    file: path.relative(ROOT, filePath).replaceAll(path.sep, '/'),
    before: summarizeCanonicalDisplay(records, { before: true }),
    after: summarizeCanonicalDisplay(records)
  }, null, 2));
}
