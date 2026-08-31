function normalizeLineBreaks(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function trimCell(value) {
  return normalizeLineBreaks(value).replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanFormerName(value) {
  let cleaned = trimCell(value).trim();
  cleaned = cleaned.replace(/^原\s*/, '').trim();
  if (cleaned.startsWith('（原') && cleaned.endsWith('）')) cleaned = cleaned.slice(2, -1).trim();
  else if (cleaned.startsWith('(原') && cleaned.endsWith(')')) cleaned = cleaned.slice(2, -1).trim();
  return cleaned;
}

export function parseName(rawName) {
  const originalLines = normalizeLineBreaks(rawName).split('\n');
  const lines = originalLines.map(trimCell).filter(Boolean);
  let current = lines[0] || '';
  const formerNames = [];
  const unparsedNameLines = [];
  const addFormer = (value) => {
    const cleaned = cleanFormerName(value);
    if (cleaned) formerNames.push(cleaned);
  };

  current = current.replace(/\s*[（(]\s*原\s*([^（）()]+?)\s*[）)]/g, (_match, former) => {
    addFormer(former);
    return '';
  }).trim();

  const inlineFormer = current.match(/^(.+?)\s*[-—]\s*原\s*(.+)$/);
  if (inlineFormer) {
    current = inlineFormer[1].trim();
    addFormer(inlineFormer[2]);
  }

  for (const line of lines.slice(1)) {
    if (/^\s*[（(]\s*原\s*[^）)]+[）)]\s*$/.test(line) || /^\s*原\s*[:：]?\s*.+$/.test(line)) {
      addFormer(line);
    } else if (/^\s*曾用名\s*[:：]?\s*.+$/i.test(line)) {
      addFormer(line.replace(/^\s*曾用名\s*[:：]?\s*/i, ''));
    } else {
      unparsedNameLines.push(line);
    }
  }

  return {
    name: current,
    nameRaw: normalizeLineBreaks(rawName),
    formerNames: unique(formerNames),
    unparsedNameLines,
  };
}
