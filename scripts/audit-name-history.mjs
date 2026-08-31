import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseName } from './name-history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_FILE = path.join(ROOT, 'data/raw/arvin-imax.json');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const AUDIT_FILE = path.join(ROOT, 'data/audit/name-history.json');
const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
const derivedDocument = JSON.parse(fs.readFileSync(DERIVED_FILE, 'utf8'));
const derived = Array.isArray(derivedDocument) ? derivedDocument : derivedDocument.records;
const dataRows = raw.rows.filter((row) => row.rowType === 'data');

const records = dataRows.map((row) => {
  const sourceRow = Number(row.rowIndex);
  const rawName = String(row.cells?.[0]?.displayValue ?? '');
  const parsed = parseName(rawName);
  const derivedRecord = derived.find((record) => Number(record.sourceRow) === sourceRow);
  const suspiciousFormerNames = parsed.formerNames.filter((name) => /拆除|营业|營業|备注|備註|设备|設備|开放|開放|放映|影厅说明|影廳說明/i.test(name));
  return {
    sourceRow,
    sourceName: parsed.name,
    formerNames: parsed.formerNames,
    unparsedNameLines: parsed.unparsedNameLines,
    suspiciousFormerNames,
    parserMatchesDerived: JSON.stringify(parsed.formerNames) === JSON.stringify(derivedRecord?.formerNames ?? [])
      && JSON.stringify(parsed.unparsedNameLines) === JSON.stringify(derivedRecord?.unparsedNameLines ?? [])
  };
});

const explicitFormerNameRecords = records.filter((record) => record.formerNames.length > 0);
const unparsedRecords = records.filter((record) => record.unparsedNameLines.length > 0);
const suspiciousRecords = records.filter((record) => record.suspiciousFormerNames.length > 0);
const mismatches = records.filter((record) => !record.parserMatchesDerived);

const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: mismatches.length === 0 && suspiciousRecords.length === 0 ? 'passed' : 'review-required',
  source: {
    raw: 'data/raw/arvin-imax.json',
    derived: 'data/derived/cinemas.json',
    rule: 'Only explicit former-name grammar is parsed; all other lines remain unparsedNameLines and nameRaw is preserved.'
  },
  summary: {
    records: records.length,
    explicitFormerNameRecords: explicitFormerNameRecords.length,
    unparsedNameLineRecords: unparsedRecords.length,
    suspiciousFormerNameRecords: suspiciousRecords.length,
    parserDerivedMismatches: mismatches.length
  },
  knownRegressionChecks: {
    ordinaryPlaceNameContainingYuan: records.find((record) => record.sourceRow === 314)?.formerNames ?? [],
    row59FormerNames: records.find((record) => record.sourceRow === 59)?.formerNames ?? [],
    row59UnparsedNameLines: records.find((record) => record.sourceRow === 59)?.unparsedNameLines ?? []
  },
  suspiciousRecords,
  unparsedRecords,
  mismatches
};

fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
fs.writeFileSync(AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: audit.status === 'passed',
  ...audit.summary,
  audit: 'data/audit/name-history.json'
}, null, 2));
