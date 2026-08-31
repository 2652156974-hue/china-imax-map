const TRADITIONAL_STATUS_TEXT = new Map([
  ['結業', '结业'], ['結束營運', '结束运营'], ['開業', '开业'], ['重新開業', '重新开业'],
  ['停業', '停业'], ['暫停營業', '暂停营业'], ['關閉', '关闭'], ['營業', '营业'],
  ['試營業', '试营业'], ['啟幕', '启幕'], ['重裝啟幕', '重装启幕'], ['計畫', '计划'],
  ['預計', '预计'], ['即將', '即将'], ['將於', '将于'], ['復業', '复业'],
]);

export const STATUS_SIGNAL_DEFINITIONS = [
  { kind: 'closed', label: 'permanent-closure', patterns: ['正式关闭', '正式结业', '结束运营', '停止放映', '永久关闭', '关门', '闭店', '结业'] },
  { kind: 'temporarily_closed', label: 'temporary-closure', patterns: ['暂停营业', '暂时关闭', '停业'] },
  { kind: 'open', label: 'reopen', patterns: ['重新开业', '重装启幕', '恢复营业', '重新营业', '重开', '复业'] },
  { kind: 'open', label: 'opening', patterns: ['试营业', '开业', '营业', '启幕', '开幕'] },
];

function simplifyStatusText(value) {
  let result = String(value ?? '').replace(/\r\n?/g, '\n');
  for (const [from, to] of TRADITIONAL_STATUS_TEXT) result = result.replaceAll(from, to);
  return result;
}

function dateFromLine(line) {
  const chinese = line.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (chinese) return dateInfo(
    `${chinese[1]}-${String(chinese[2]).padStart(2, '0')}-${String(chinese[3]).padStart(2, '0')}`,
    'day'
  );
  const numeric = line.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (numeric) return dateInfo(
    `${numeric[1]}-${String(numeric[2]).padStart(2, '0')}-${String(numeric[3]).padStart(2, '0')}`,
    'day'
  );
  const month = line.match(/(\d{4})年\s*(\d{1,2})月/);
  if (month) {
    const value = `${month[1]}-${String(month[2]).padStart(2, '0')}`;
    const trailing = line.slice(month.index + month[0].length);
    return dateInfo(value, 'month', /^[\s]*[?？]/.test(trailing));
  }
  const year = line.match(/(\d{4})年/);
  if (year) {
    const trailing = line.slice(year.index + year[0].length);
    return dateInfo(year[1], 'year', /^[\s]*[?？]/.test(trailing));
  }
  return dateInfo(null, null, false);
}

function dateInfo(value, precision, explicitUnknown = false) {
  const unknownYear = explicitUnknown && precision === 'year';
  return {
    value: unknownYear ? null : value,
    sortValue: unknownYear ? null : value,
    precision: unknownYear ? 'unknown' : precision,
    explicitUnknown,
  };
}

function isPlannedOrFuture(line, signalOrder, dateDetails, asOfDate) {
  const prefix = line.slice(0, signalOrder + 1);
  const planned = /(即将|计划|预计|将于|拟于|预定|待开)[^\n]{0,12}$/.test(prefix);
  const comparisonDate = dateDetails.precision === 'month'
    ? String(asOfDate ?? '').slice(0, 7)
    : dateDetails.precision === 'year'
      ? String(asOfDate ?? '').slice(0, 4)
      : asOfDate;
  const future = Boolean(dateDetails.sortValue && comparisonDate && dateDetails.sortValue > comparisonDate);
  const precisionUnknown = dateDetails.explicitUnknown && !dateDetails.sortValue;
  const reason = planned
    ? 'planned-event'
    : future
      ? 'future-dated-event'
      : precisionUnknown
        ? 'date-precision-unknown'
        : null;
  return { planned, future, precisionUnknown, reason };
}

function latestEvent(events) {
  const eligible = events.filter((event) => event.eligible);
  if (!eligible.length) return null;
  const dated = eligible.some((event) => event.dateSortValue);
  const ordered = [...eligible].sort((a, b) => {
    if (a.dateSortValue && b.dateSortValue && a.dateSortValue !== b.dateSortValue) return a.dateSortValue.localeCompare(b.dateSortValue);
    if (a.dateSortValue && !b.dateSortValue) return 1;
    if (!a.dateSortValue && b.dateSortValue) return -1;
    return a.lineIndex - b.lineIndex || a.signalOrder - b.signalOrder;
  });
  return { event: ordered.at(-1), dated };
}

export function parseStatus(rawHistory, options = {}) {
  const normalized = simplifyStatusText(rawHistory);
  const asOfDate = options.asOfDate ?? process.env.STATUS_AS_OF_DATE ?? new Date().toISOString().slice(0, 10);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const events = [];

  lines.forEach((line, lineIndex) => {
    const dateDetails = dateFromLine(line);
    const lineCandidates = [];
    for (const definition of STATUS_SIGNAL_DEFINITIONS) {
      for (const pattern of definition.patterns) {
        let searchFrom = 0;
        while (searchFrom < line.length) {
          const index = line.indexOf(pattern, searchFrom);
          if (index < 0) break;
          lineCandidates.push({
            lineIndex,
            dateDetails,
            kind: definition.kind,
            label: definition.label,
            signal: pattern,
            signalOrder: index,
            signalEnd: index + pattern.length,
          });
          searchFrom = index + pattern.length;
        }
      }
    }
    lineCandidates.sort((a, b) => a.signalOrder - b.signalOrder || b.signal.length - a.signal.length);
    const accepted = [];
    for (const candidate of lineCandidates) {
      if (accepted.some((event) => candidate.signalOrder < event.signalEnd && candidate.signalEnd > event.signalOrder)) continue;
      accepted.push(candidate);
    }
    for (const event of accepted) {
      const timing = isPlannedOrFuture(line, event.signalOrder, event.dateDetails, asOfDate);
      events.push({
        ...event,
        date: event.dateDetails.value,
        dateSortValue: event.dateDetails.sortValue,
        datePrecision: event.dateDetails.precision,
        planned: timing.planned,
        future: timing.future,
        eligible: !timing.planned && !timing.future && !timing.precisionUnknown,
        exclusionReason: timing.reason,
      });
    }
  });

  const decisive = latestEvent(events);
  const latest = decisive?.event ?? null;
  const status = latest?.kind ?? 'unknown';
  const confidence = latest ? (latest.datePrecision === 'day' ? 'high' : 'medium') : 'unknown';
  const hasExcludedOnly = events.length > 0 && !latest;
  const reason = latest ? null : hasExcludedOnly ? 'status-future-only-or-no-decisive-event' : 'status-no-decisive-event';
  const historySummary = latest
    ? `${events.filter((event) => event.eligible).length} 条明确状态信号；最新信号：${formatEventDate(latest)} ${latest.signal}`
    : '未发现可安全判定营业状态的明确信号';

  return {
    status,
    confidence,
    historySummary,
    asOfDate,
    _lines: lines.length,
    _events: events,
    _eligibleEvents: events.filter((event) => event.eligible),
    _latestEvent: latest,
    _reason: reason,
    _datedEvidence: Boolean(decisive?.dated),
  };
}

function formatEventDate(event) {
  if (!event?.date) return '未标日期';
  if (event.datePrecision === 'month') return `${event.date}（月精度）`;
  if (event.datePrecision === 'year') return `${event.date}（年精度）`;
  return event.date;
}
