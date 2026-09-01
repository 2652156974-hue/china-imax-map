import fs from 'node:fs';
import { resolveScreenPresentation } from '../screen-presentation.mjs';

const dataset = JSON.parse(fs.readFileSync(new URL('../data/public/cinemas.json', import.meta.url), 'utf8'));
const derived = JSON.parse(fs.readFileSync(new URL('../data/derived/cinemas.json', import.meta.url), 'utf8'));
const records = dataset.records;
const countBy = (values) => Object.fromEntries([...new Set(values)].sort().map((key) => [key, values.filter((value) => value === key).length]));
const presentations = records.map(resolveScreenPresentation);
const fieldCounts = Object.fromEntries(['width', 'height', 'area', 'seats'].map((field) => {
  const states = presentations.map((p) => p.selected?.fields?.[field]?.state ?? 'missing');
  return [field, { displayed: states.filter((state) => state === 'value').length, missing: states.filter((state) => state === 'missing').length, invalid: states.filter((state) => state === 'invalid').length }];
}));
const legitimateSelectedFieldInvalid = presentations.reduce((total, presentation) => total + (presentation.selected ? Object.values(presentation.selected.fields).filter((field) => field.state === 'invalid').length : 0), 0);
const priorPending = records.filter((record) => ['width', 'height', 'area', 'seats'].some((field) => {
  const raw = field === 'seats' ? record.seatsRaw : record.screen?.[`raw${field[0].toUpperCase()}${field.slice(1)}`];
  const canonical = field === 'seats' ? record.seats : record.screen?.[field];
  return String(raw ?? '').includes('\n') || (String(raw ?? '').trim() && canonical == null);
}));
// Record-level false pending: the old record was pending, a usable configuration exists,
// but the new presentation still cannot select one (field-level invalid values are separate).
const falsePendingBefore = priorPending.filter((record, index) => presentations[index].configurations.length > 0).length;
const falsePendingAfter = presentations.filter((p, index) => priorPending.includes(records[index]) && p.configurations.length > 0 && !p.selected).length;
const derivedById = new Map(derived.records.map((record) => [record.id, record]));
const rawFingerprintPreserved = records.every((record) => {
  const source = derivedById.get(record.id);
  return source && record.screen?.rawWidth === source.screen?.rawWidth && record.screen?.rawHeight === source.screen?.rawHeight && record.screen?.rawArea === source.screen?.rawArea && record.seatsRaw === source.seatsRaw;
});
const out = {
  totalRecords: records.length,
  presentationStatus: countBy(presentations.map((p) => p.status)),
  candidateCountDistribution: countBy(presentations.map((p) => p.configurations.length >= 4 ? '4+' : String(p.configurations.length))),
  selectionReason: countBy(presentations.map((p) => p.selectionReason === 'review-materialized' ? 'reviewed' : p.selectionReason === 'default-first-complete' ? 'firstComplete' : p.selectionReason === 'default-first-usable' ? 'firstUsable' : p.selectionReason === 'canonical-selection' ? 'canonical' : 'none')),
  fields: fieldCounts,
  legitimateSelectedFieldInvalid,
  falsePendingBefore,
  falsePendingAfter: Math.max(0, falsePendingAfter),
  priorPendingRecordsConvertedToMultiple: records.filter((record, index) => priorPending.includes(record) && presentations[index].status === 'multiple').length,
  rawFingerprintPreserved
};
console.log(JSON.stringify(out, null, 2));
