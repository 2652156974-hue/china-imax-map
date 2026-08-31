import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, 'data', 'raw', 'arvin-imax.json');
const OUTPUT_FILE = path.join(ROOT, 'data', 'derived', 'screen-seat-columns.csv');

const OUTPUT_COLUMNS = [
  '影城名称',
  '银幕宽度（米)',
  '银幕高度（米)',
  '银幕面积（平方米)',
  '座位数（个)',
];

const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
const rows = (raw.rows ?? []).filter((row) => row.rowType === 'data');

if (rows.length !== 901) {
  throw new Error(`Expected 901 Tencent data rows, got ${rows.length}`);
}
if (!rows.every((row) => row.cells?.length === 8)) {
  throw new Error('Every Tencent data row must contain exactly 8 cells');
}

const cell = (row, index) => String(row.cells[index]?.displayValue ?? '');
const records = rows.map((row) => [
  cell(row, 0),
  cell(row, 3),
  cell(row, 4),
  cell(row, 5),
  cell(row, 6),
]);

const csv = [OUTPUT_COLUMNS, ...records]
  .map((record) => record.map(csvCell).join(','))
  .join('\r\n') + '\r\n';

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, csv, 'utf8');

console.log(JSON.stringify({
  ok: true,
  output: path.relative(ROOT, OUTPUT_FILE).replaceAll(path.sep, '/'),
  records: records.length,
  columns: OUTPUT_COLUMNS,
  nonEmpty: Object.fromEntries(OUTPUT_COLUMNS.slice(1).map((column, index) => [
    column,
    records.filter((record) => record[index + 1].trim() !== '').length,
  ])),
}, null, 2));

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
