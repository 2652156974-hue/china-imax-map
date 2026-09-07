const SCREEN_FIELDS = ['width', 'height', 'area'];
const ALL_FIELDS = [...SCREEN_FIELDS, 'seats'];

/** Resolve aligned screen/seat source lines without mutating or rewriting raw data. */
export function resolveScreenPresentation(record = {}) {
  const screen = record.screen && typeof record.screen === 'object' ? record.screen : record;
  const raw = {
    width: rawValue(screen.rawWidth),
    height: rawValue(screen.rawHeight),
    area: rawValue(screen.rawArea),
    seats: rawValue(record.seatsRaw)
  };
  const lines = Object.fromEntries(ALL_FIELDS.map((field) => [field, splitLines(raw[field])]));
  const allBlank = ALL_FIELDS.every((field) => lines[field].every((line) => !line.trim()));
  const count = Math.max(1, ...ALL_FIELDS.map((field) => lines[field].length));
  const configurations = [];
  for (let sourceIndex = 0; sourceIndex < count; sourceIndex += 1) {
    const fields = {};
    let usable = false;
    for (const field of ALL_FIELDS) {
      const line = lines[field][sourceIndex] ?? '';
      const parsed = parseField(field, line);
      fields[field] = { state: parsed.state, raw: line, value: parsed.value };
      if (parsed.state === 'value') usable = true;
    }
    if (usable) {
      configurations.push({
        sourceIndex,
        width: fields.width.value,
        height: fields.height.value,
        area: fields.area.value,
        seats: fields.seats.value,
        completeness: SCREEN_FIELDS.every((field) => fields[field].state === 'value') ? 'complete' : 'partial',
        fields
      });
    }
  }

  const selected = chooseConfiguration(record, configurations);
  const selectedIndex = selected ? configurations.findIndex((config) => config.sourceIndex === selected.sourceIndex) : null;
  let status;
  if (allBlank) status = 'missing';
  else if (!configurations.length) status = 'invalid';
  else if (selected?.selectionReason === 'review-materialized') status = 'reviewed';
  else if (configurations.length > 1) status = 'multiple';
  else status = 'direct';
  const selectedConfig = selected ? stripSelection(selected) : null;
  return {
    status,
    selectedIndex,
    selectionReason: selected?.selectionReason ?? null,
    selected: selectedConfig,
    configurations: configurations.map(stripSelection),
    alternatives: configurations.filter((_, index) => index !== selectedIndex).map(stripSelection),
    raw
  };
}

function chooseConfiguration(record, configurations) {
  if (!configurations.length) return null;
  const review = record.screenSeatReview ?? record.screen?.screenSeatReview;
  if (review?.confidence === 'high') {
    const explicit = Number.isInteger(review.sourceIndex) ? review.sourceIndex : Number.isInteger(review.selectedIndex) ? review.selectedIndex : null;
    if (explicit !== null) {
      const bySource = configurations.find((config) => config.sourceIndex === explicit);
      if (bySource && reviewMatchesCanonical(record, bySource, review)) return { ...bySource, selectionReason: 'review-materialized' };
    }
    const matched = configurations.filter((config) => reviewMatchesCanonical(record, config, review));
    if (matched.length === 1) return { ...matched[0], selectionReason: 'review-materialized' };
  }
  const explicit = Number.isInteger(review?.canonicalSourceIndex) ? review.canonicalSourceIndex : Number.isInteger(record.canonicalSourceIndex) ? record.canonicalSourceIndex : null;
  if (explicit !== null) {
    const canonical = configurations.find((config) => config.sourceIndex === explicit);
    if (canonical) return { ...canonical, selectionReason: 'canonical-selection' };
  }
  const complete = configurations.find((config) => config.completeness === 'complete');
  return complete ? { ...complete, selectionReason: 'default-first-complete' } : { ...configurations[0], selectionReason: 'default-first-usable' };
}

function reviewMatchesCanonical(record, config, review) {
  const fields = Array.isArray(review?.materializedFields) ? review.materializedFields.filter((field) => ALL_FIELDS.includes(field)) : [];
  if (!fields.length) return false;
  return fields.every((field) => {
    const canonical = canonicalValue(record, field);
    return canonical !== null && config.fields[field].state === 'value' && config.fields[field].value === canonical;
  });
}

function canonicalValue(record, field) {
  const source = field === 'seats' ? record : record.screen ?? record;
  const value = Number(source?.[field]);
  return field === 'seats' ? Number.isInteger(value) && value > 0 ? value : null : Number.isFinite(value) && value > 0 ? value : null;
}

function parseField(field, rawLine) {
  const normalized = rawLine.replace(/\u00a0/g, ' ').trim();
  if (!normalized) return { state: 'missing', value: null };
  if (field === 'seats') return /^\d+$/.test(normalized) && Number(normalized) > 0 ? { state: 'value', value: Number(normalized) } : { state: 'invalid', value: null };
  const units = field === 'area' ? '(?:m²|平方米)' : '(?:m|米)';
  const match = normalized.match(new RegExp(`^(\\d+(?:\\.\\d+)?)(?:\\s*${units})?$`, 'i'));
  return match && Number(match[1]) > 0 ? { state: 'value', value: Number(match[1]) } : { state: 'invalid', value: null };
}

function splitLines(value) { return value.replace(/\r\n|\r|\n/g, '\n').split('\n'); }
function rawValue(value) { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function stripSelection(config) {
  if (!config) return null;
  const { selectionReason, ...rest } = config;
  return { ...rest, fields: Object.fromEntries(ALL_FIELDS.map((field) => [field, { state: rest.fields[field].state, raw: rest.fields[field].raw }])) };
}

export function presentationField(record, field, unit = '') {
  const presentation = resolveScreenPresentation(record);
  const selected = presentation.selected?.fields?.[field];
  if (!selected || selected.state === 'missing') return { status: 'missing', html: '暂无数据', raw: presentation.raw[field] || null };
  if (selected.state === 'invalid') return { status: 'unresolved', html: '<span>待核<span class="field-flag">数据说明</span></span>', raw: presentation.raw[field] };
  const digits = field === 'seats' ? 0 : field === 'area' ? 2 : 3;
  const value = Number(Number(presentation.selected[field]).toFixed(digits));
  const status = presentation.status === 'reviewed' ? 'reviewed' : presentation.status === 'multiple' ? 'multiple' : 'direct';
  return { status, html: `${value}${unit ? ` ${unit}` : ''}`, raw: presentation.raw[field] || null };
}

export function presentationMeasure(record) {
  const presentation = resolveScreenPresentation(record);
  const selected = presentation.selected;
  if (!selected) return null;
  if (selected.fields.area?.state === 'value') return { kind: 'area', value: selected.area };
  if (selected.fields.width?.state === 'value') return { kind: 'width', value: selected.width };
  return null;
}
