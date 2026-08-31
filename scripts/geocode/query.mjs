import { isGenericOnlyQuery, normalizeText, sourceBrand, sourceProjectTokens } from './scoring.mjs';

function clean(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractExplicitFormerNames(value) {
  const text = String(value ?? '');
  const names = [];
  const add = (name) => {
    const cleaned = clean(name).replace(/[）)]$/, '').trim();
    if (cleaned && !names.some((item) => normalizeText(item) === normalizeText(cleaned))) names.push(cleaned);
  };
  for (const line of text.split(/\r?\n/)) {
    const start = line.match(/^\s*原\s*[:：]?\s*(.+?)\s*$/);
    if (start && !/^\s*原平/.test(line)) add(start[1]);
  }
  for (const match of text.matchAll(/[（(]\s*原\s*([^）)]+)[）)]/g)) add(match[1]);
  for (const match of text.matchAll(/(?:^|\s|[—–-])[-—–]\s*原\s*([^，,。；;\n]+)/g)) add(match[1]);
  for (const match of text.matchAll(/曾用名\s*[:：]?\s*([^，,。；;\n）)]+)/g)) add(match[1]);
  return names;
}

export function stripExplicitHistorySegments(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .filter((line) => !(/^\s*原\s*[:：]?\s*.+/.test(line) && !/^\s*原平/.test(line)))
    .join(' ')
    .replace(/[（(]\s*原\s*[^）)]+[）)]/g, '')
    .replace(/(?:^|\s|[—–-])[-—–]\s*原\s*[^，,。；;\n]+/g, ' ')
    .replace(/曾用名\s*[:：]?\s*[^，,。；;\n）)]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildQueries(record) {
  const city = record.city;
  const name = clean(record.name);
  const queries = [];
  const add = (kind, value) => {
    const query = clean(value);
    if (!query || isGenericOnlyQuery(query) || queries.some((item) => normalizeText(item.query) === normalizeText(query))) return;
    queries.push({ kind, query });
  };
  add('current-name-city', `${name} ${city}`);
  const strippedDeviceDescription = name
    .replace(/[（(][^）)]*(?:imax|激光|氙灯|氙燈|声道|聲道|3d|dome|gt|xt|sr)[^）)]*[）)]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (strippedDeviceDescription && normalizeText(strippedDeviceDescription) !== normalizeText(name)) {
    add('device-description-removed', `${strippedDeviceDescription} ${city}`);
  }
  const formerNames = [...(record.formerNames ?? []), ...extractExplicitFormerNames(record.nameRaw ?? record.name)];
  for (const formerName of formerNames) add('former-name', `${formerName} ${city}`);
  const brand = sourceBrand(record);
  const projects = sourceProjectTokens(record).slice(0, 2);
  if (brand && projects.length) add('project-brand', `${projects.join(' ')} ${brand} ${city}`);
  const historyStripped = stripExplicitHistorySegments(name);
  if (historyStripped && normalizeText(historyStripped) !== normalizeText(name)) add('explicit-history-removed', `${historyStripped} ${city}`);
  return queries.slice(0, 4);
}
