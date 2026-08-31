import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLIND_SEED = 'china-imax-map-blind-50-v1-20260820';
export const PREVIOUS_SOURCE_ROWS = Object.freeze([
  309, 311, 314, 21, 30, 37, 198, 200, 224, 228,
  593, 699, 59, 51, 155, 305, 610, 233, 538, 843
]);

export const STRATUM_TARGETS = Object.freeze({
  ordinaryCommercial: 15,
  duplicateChain: 10,
  formerNameComplex: 8,
  closedOrTemporary: 5,
  atypicalVenue: 5,
  deterministicFill: 7
});

const CHAIN_PATTERN = /万达|cgv|金逸|幸福蓝海|博纳|百丽宫|寰映|英皇|中影|保利|卢米埃|横店|大地|橙天|嘉禾|ume/i;
const VENUE_PATTERN = /科技馆|科学技术馆|科学馆|博物馆|天文馆|科技中心|球幕|dome/i;

function normalizedText(record) {
  return [record.name, record.nameRaw, ...(record.formerNames ?? []), record.projection?.raw, record.projection?.system]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
}

function hasFormerNameComplexity(record) {
  return (record.formerNames ?? []).length > 0 || /(^|[\n（(\s-])原[^平]|曾用名|更名|改名/.test(String(record.nameRaw ?? ''));
}

function isClosed(record) {
  return ['closed', 'temporarily_closed'].includes(record.status);
}

function isAtypicalVenue(record) {
  return record.projection?.dome === true || VENUE_PATTERN.test(normalizedText(record));
}

function isDuplicateChain(record) {
  return CHAIN_PATTERN.test(normalizedText(record));
}

function isOrdinaryCommercial(record) {
  const text = normalizedText(record);
  return /影城|影院|电影院|电影城/.test(text)
    && !isDuplicateChain(record)
    && !hasFormerNameComplexity(record)
    && !isClosed(record)
    && !isAtypicalVenue(record);
}

function seedNumber(seed) {
  const digest = crypto.createHash('sha256').update(seed).digest();
  return digest.readUInt32LE(0);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(records, seed, label) {
  const result = [...records].sort((left, right) => Number(left.sourceRow) - Number(right.sourceRow));
  const random = mulberry32(seedNumber(`${seed}:${label}`));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function selectBlind50(records, seed = BLIND_SEED) {
  const frozen = loadFrozenSelection(records, seed);
  if (frozen) return frozen;

  const excluded = new Set(PREVIOUS_SOURCE_ROWS);
  const mainland = records.filter((record) => record.region === '中国大陆' && !excluded.has(Number(record.sourceRow)));
  const selected = [];
  const used = new Set();
  const select = (stratum, predicate) => {
    const requested = STRATUM_TARGETS[stratum];
    const candidates = shuffled(mainland.filter((record) => !used.has(record.sourceRow) && predicate(record)), seed, stratum);
    if (candidates.length < requested) throw new Error(`Blind stratum ${stratum} has ${candidates.length} candidates; ${requested} required`);
    for (const record of candidates.slice(0, requested)) {
      used.add(record.sourceRow);
      selected.push({ stratum, record });
    }
  };

  select('ordinaryCommercial', isOrdinaryCommercial);
  select('duplicateChain', (record) => isDuplicateChain(record) && !isClosed(record) && !isAtypicalVenue(record));
  select('formerNameComplex', hasFormerNameComplexity);
  select('closedOrTemporary', isClosed);
  select('atypicalVenue', isAtypicalVenue);
  select('deterministicFill', () => true);

  if (selected.length !== 50 || new Set(selected.map((item) => item.record.sourceRow)).size !== 50) {
    throw new Error('Blind sample must contain exactly 50 unique source rows');
  }
  if (selected.some((item) => excluded.has(Number(item.record.sourceRow)))) throw new Error('Blind sample overlaps the previous 20 records');
  return selected;
}

function loadFrozenSelection(records, seed) {
  if (seed !== BLIND_SEED) return null;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const lockFile = path.resolve(moduleDirectory, '../../data/audit/geocode-blind-50-matcher-lock.json');
  const auditFile = path.resolve(moduleDirectory, '../../data/audit/geocode-blind-50.json');
  if (!fs.existsSync(lockFile) || !fs.existsSync(auditFile)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
    if (lock.seed !== seed || !Array.isArray(lock.sourceRows) || lock.sourceRows.length !== 50) return null;
    const byRow = new Map(records.map((record) => [Number(record.sourceRow), record]));
    const strataByRow = new Map((audit.selection?.records ?? []).map((item) => [Number(item.sourceRow), item.stratum]));
    if (lock.sourceRows.some((sourceRow) => !byRow.has(Number(sourceRow)) || !strataByRow.has(Number(sourceRow)))) return null;
    const selected = lock.sourceRows.map((sourceRow) => ({
      stratum: strataByRow.get(Number(sourceRow)),
      record: byRow.get(Number(sourceRow))
    }));
    if (new Set(selected.map((item) => Number(item.record.sourceRow))).size !== 50) return null;
    return selected;
  } catch {
    return null;
  }
}

export function matcherFingerprint(root) {
  const files = [
    'scripts/geocode/scoring.mjs',
    'scripts/geocode/admin-divisions.mjs',
    'scripts/geocode/query.mjs',
    'scripts/geocode/crs.mjs',
    'data/geocode/mainland-admin-hierarchy.json'
  ];
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return { algorithm: 'SHA-256', files, value: hash.digest('hex') };
}

export function blindSelectionSummary(selection) {
  const counts = {};
  for (const item of selection) counts[item.stratum] = (counts[item.stratum] ?? 0) + 1;
  return {
    seed: BLIND_SEED,
    excludedPreviousSourceRows: [...PREVIOUS_SOURCE_ROWS],
    targetCounts: { ...STRATUM_TARGETS },
    actualCounts: counts,
    sourceRows: selection.map((item) => item.record.sourceRow),
    records: selection.map((item) => ({ sourceRow: item.record.sourceRow, stratum: item.stratum, name: item.record.name, city: item.record.city }))
  };
}
