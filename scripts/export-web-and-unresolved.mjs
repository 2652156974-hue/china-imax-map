import fs from 'node:fs';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const results = readJson('data/audit/human-verification-results.json');
const canonical = readJson('data/local/private-reviewed-geocodes.json');
const internal = readJson('data/derived/cinemas-final-internal.json');

const webVerified = results.filter((record) => record.reviewer === 'codex-browser-review');
const currentCanonicalUnresolved = canonical.records.filter((record) => record.reviewState === 'unresolved');
const auditUnresolved = internal.records.filter((record) => record.geocode?.decision === 'unresolved');
const provenanceExceptions = canonical.records.filter((record) => record.decisionOrigin === 'unresolved-final-amap');

const webRows = webVerified.map((record) => ({
  id: record.id,
  sourceRow: record.sourceRow,
  name: record.name ?? '',
  result: record.result ?? '',
  reviewer: record.reviewer ?? '',
  confirmationSource: record.confirmationSource ?? '',
  evidenceCount: Array.isArray(record.evidence) ? record.evidence.length : 0,
  evidenceUrls: (record.evidence ?? []).map((item) => item.url).filter(Boolean),
  notes: record.notes ?? ''
}));

const auditRows = auditUnresolved.map((record) => ({
  id: record.id,
  sourceRow: record.sourceRow,
  name: record.name ?? '',
  city: record.city ?? '',
  canonicalReviewState: record.reviewState ?? '',
  canonicalReviewVerdict: record.reviewVerdict ?? '',
  geocodeDecision: record.geocode?.decision ?? '',
  decisionOrigin: record.decisionOrigin ?? '',
  locationGranularity: record.location?.locationGranularity ?? '',
  geocodeSource: record.location?.geocodeSource ?? '',
  address: record.location?.address ?? '',
  lat: record.location?.lat ?? '',
  lng: record.location?.lng ?? '',
  note: 'canonical reviewState is located; final-internal geocode.decision remains unresolved because provider CRS/decision mapping is not closed.'
}));

const provenanceRows = provenanceExceptions.map((record) => ({
  id: record.id,
  sourceRow: record.sourceRow,
  name: record.name ?? '',
  reviewVerdict: record.reviewVerdict ?? '',
  finalVerdict: record.finalVerdict ?? '',
  decisionOrigin: record.decisionOrigin ?? '',
  locationSource: record.location?.geocodeSource ?? '',
  locationGranularity: record.location?.locationGranularity ?? '',
  address: record.location?.address ?? ''
}));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  definitions: {
    webVerified: 'human-verification-results where reviewer=codex-browser-review',
    currentUnresolved: 'canonical records where reviewState=unresolved',
    auditUnresolved: 'final-internal records where geocode.decision=unresolved',
    provenanceException: 'canonical records where decisionOrigin=unresolved-final-amap'
  },
  summary: {
    webVerified: webVerified.length,
    currentCanonicalUnresolved: currentCanonicalUnresolved.length,
    auditUnresolved: auditUnresolved.length,
    provenanceExceptions: provenanceExceptions.length,
    canonicalTotal: canonical.records.length
  },
  webVerified: webRows,
  currentCanonicalUnresolved: currentCanonicalUnresolved.map((record) => ({
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    city: record.city,
    reviewState: record.reviewState,
    reviewVerdict: record.reviewVerdict
  })),
  auditUnresolved: auditRows,
  provenanceExceptions: provenanceRows,
  sourceFiles: [
    'data/audit/human-verification-results.json',
    'data/local/private-reviewed-geocodes.json',
    'data/derived/cinemas-final-internal.json'
  ]
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(' | ') : String(value);
  return `"${text.replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`;
};

const csv = (headers, rows) => [
  `\ufeff${headers.join(',')}`,
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
].join('\n') + '\n';

fs.writeFileSync('data/audit/web-verified-and-unresolved.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync('data/audit/web-verified-127.csv', csv(
  ['id', 'sourceRow', 'name', 'result', 'reviewer', 'confirmationSource', 'evidenceCount', 'evidenceUrls', 'notes'],
  webRows
), 'utf8');
fs.writeFileSync('data/audit/audit-unresolved-14.csv', csv(
  ['id', 'sourceRow', 'name', 'city', 'canonicalReviewState', 'canonicalReviewVerdict', 'geocodeDecision', 'decisionOrigin', 'locationGranularity', 'geocodeSource', 'address', 'lat', 'lng', 'note'],
  auditRows
), 'utf8');

console.log(JSON.stringify({
  ok: true,
  webVerified: webVerified.length,
  currentCanonicalUnresolved: currentCanonicalUnresolved.length,
  auditUnresolved: auditUnresolved.length,
  provenanceExceptions: provenanceExceptions.length,
  files: [
    'data/audit/web-verified-and-unresolved.json',
    'data/audit/web-verified-127.csv',
    'data/audit/audit-unresolved-14.csv'
  ]
}, null, 2));
