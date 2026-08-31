import fs from 'node:fs';

const WEB_INPUT = 'C:/Users/wuhan/Downloads/web-verified-127-audited.csv';
const RESOLUTION_INPUT = 'C:/Users/wuhan/Downloads/audit-unresolved-14-resolved.csv';
const CANONICAL_INPUT = 'data/local/private-reviewed-geocodes.json';
const APP_INPUT = 'app.mjs';
const WEB_OUTPUT = 'data/audit/web-verified-127-audited-final.csv';
const REPORT_OUTPUT = 'data/audit/luna-handoff-reconciliation.json';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  const [headers, ...data] = rows;
  if (headers?.length) headers[0] = headers[0].replace(/^\ufeff/, '');
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`;
}

function writeCsv(file, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  fs.writeFileSync(file, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

function key(record) {
  return `${record.id}|${Number(record.sourceRow)}`;
}

const webRows = parseCsv(fs.readFileSync(WEB_INPUT, 'utf8'));
const resolutionRows = parseCsv(fs.readFileSync(RESOLUTION_INPUT, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(CANONICAL_INPUT, 'utf8'));
const canonicalByKey = new Map(canonical.records.map((record) => [key(record), record]));

const missingCanonical = [];
const nameMismatches = [];
const blankNamesBefore = webRows.filter((row) => !row.name.trim()).length;
const correctedWebRows = webRows.map((row) => {
  const source = canonicalByKey.get(`${row.id}|${Number(row.sourceRow)}`);
  if (!source) {
    missingCanonical.push({ id: row.id, sourceRow: row.sourceRow });
    return row;
  }
  if (row.name.trim() && row.name !== source.name) {
    nameMismatches.push({ id: row.id, sourceRow: row.sourceRow, auditName: row.name, canonicalName: source.name });
  }
  return row.name.trim() ? row : { ...row, name: source.name };
});

const resolutionMissingCanonical = resolutionRows
  .filter((row) => !canonicalByKey.has(`${row.id}|${Number(row.sourceRow)}`))
  .map((row) => ({ id: row.id, sourceRow: row.sourceRow }));

const appText = fs.readFileSync(APP_INPUT, 'utf8');
const currentFrontend = {
  renderer: appText.match(/renderer:\s*'([^']+)'/)?.[1] ?? null,
  mapCrs: appText.match(/mapCrs:\s*'([^']+)'/)?.[1] ?? null,
  coordinateGuard: appText.includes("config.coordinateSystem !== 'GCJ-02'") ? 'GCJ-02' : null,
  markerGuard: appText.includes("document.coordinateSystem !== 'GCJ-02'") ? 'GCJ-02' : null,
  source: APP_INPUT
};

const directGcjToWgs84 = resolutionRows
  .filter((row) => row.sourceCrs === 'GCJ-02' && row.targetCrs === 'WGS84')
  .map((row) => ({ id: row.id, sourceRow: Number(row.sourceRow), resolvedLat: row.resolvedLat, resolvedLng: row.resolvedLng }));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: missingCanonical.length || resolutionMissingCanonical.length
    ? 'blocked-input-reconciliation'
    : directGcjToWgs84.length && currentFrontend.mapCrs === 'GCJ-02'
      ? 'safe-name-reconciled-crs-choice-required'
      : 'reconciled',
  inputs: {
    webAudit: WEB_INPUT,
    resolution: RESOLUTION_INPUT,
    canonical: CANONICAL_INPUT,
    frontend: APP_INPUT
  },
  nameBackfill: {
    rows: webRows.length,
    blankNamesBefore,
    blankNamesAfter: correctedWebRows.filter((row) => !row.name.trim()).length,
    filledFromCanonical: correctedWebRows.filter((row, index) => !webRows[index].name.trim() && row.name.trim()).length,
    missingCanonical,
    nameMismatches
  },
  resolutionInput: {
    rows: resolutionRows.length,
    canonicalMatches: resolutionRows.length - resolutionMissingCanonical.length,
    resolutionMissingCanonical,
    decisionMapping: {
      acceptExact: 'same entity',
      acceptLocationOnly: 'same mall/venue only',
      acceptHistoricalLocation: 'acceptedHistoricalLocation'
    },
    directGcjToWgs84
  },
  currentFrontend,
  crsDecision: directGcjToWgs84.length && currentFrontend.mapCrs === 'GCJ-02'
    ? 'BLOCKED_CONFLICT: handoff requests WGS84 rendering, but current app/marker guards require AMap GCJ-02. Do not rewrite canonical or markers until frontend target is chosen.'
    : 'NO_CONFLICT_DETECTED'
};

writeCsv(WEB_OUTPUT, Object.keys(correctedWebRows[0] ?? {}), correctedWebRows);
fs.writeFileSync(REPORT_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: report.status !== 'blocked-input-reconciliation',
  status: report.status,
  webRows: webRows.length,
  blankNamesBefore,
  blankNamesAfter: report.nameBackfill.blankNamesAfter,
  resolutionRows: resolutionRows.length,
  directGcjToWgs84,
  currentFrontend,
  outputs: [WEB_OUTPUT, REPORT_OUTPUT]
}, null, 2));
