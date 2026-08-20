import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW_PATH = path.join(ROOT, 'data', 'raw', 'arvin-imax.json');
const DERIVED_DIR = path.join(ROOT, 'data', 'derived');
const AUDIT_DIR = path.join(ROOT, 'data', 'audit');
const GEOCODE_CACHE_PATH = path.join(DERIVED_DIR, 'geocode-cache.json');
const GENERATED_AT = process.env.DERIVED_GENERATED_AT || new Date().toISOString();

const SOURCE = {
  maintainer: '@ArvinTingcn',
  document: '全球IMAX及特效影厅分布20260820',
  url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2',
  sheetUrl: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP',
  tabId: 'BB08J2',
  tab: 'IMAX中国',
};

const COLUMNS = [
  '影城名称',
  '放映机型号/声道',
  '开业时间',
  '银幕宽度（米)',
  '银幕高度（米)',
  '银幕面积（平方米)',
  '座位数（个)',
  '备注',
];

const TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['臺', '台'], ['台灣', '台湾'], ['臺灣', '台湾'], ['澳門', '澳门'],
  ['桃園', '桃园'], ['花蓮', '花莲'], ['嘉義', '嘉义'], ['臺中', '台中'],
  ['臺南', '台南'], ['雲林', '云林'], ['屏東', '屏东'], ['宜蘭', '宜兰'],
  ['臺東', '台东'], ['澎湖', '澎湖'], ['金門', '金门'], ['馬祖', '马祖'],
  ['聲道', '声道'], ['音響', '音响'], ['商業', '商业'], ['激光', '激光'],
  ['大慶', '大庆'],
  ['雷射', '激光'], ['氙燈', '氙灯'], ['結業', '结业'], ['結束營運', '结束运营'],
  ['開業', '开业'], ['重新開業', '重新开业'], ['停業', '停业'],
  ['暫停營業', '暂停营业'], ['關閉', '关闭'], ['營業', '营业'],
  ['試營業', '试营业'], ['即將', '即将'], ['升級', '升级'], ['換幕', '换幕'],
  ['更名', '更名'], ['經營', '经营'], ['收購', '收购'], ['戲院', '戏院'],
  ['影院', '影院'], ['館', '馆'], ['國立', '国立'], ['影藝', '影艺'],
]);

function simplify(value) {
  let result = String(value ?? '');
  for (const [traditional, simplified] of TRADITIONAL_TO_SIMPLIFIED) {
    result = result.replaceAll(traditional, simplified);
  }
  return result;
}

function normalizeLineBreaks(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function trimCell(value) {
  return normalizeLineBreaks(value).replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/g, '');
}

function cellDisplay(row, colIndex) {
  return String(row.cells?.[colIndex]?.displayValue ?? '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseSource() {
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  const rows = raw.rows.filter((row) => row.rowType === 'data');
  if (rows.length !== 901) {
    throw new Error(`Expected 901 data rows, got ${rows.length}`);
  }
  if (!rows.every((row) => row.cells?.length === 8)) {
    throw new Error('At least one source row does not contain exactly 8 cells');
  }
  return { raw, rows };
}

function parseName(rawName) {
  const originalLines = normalizeLineBreaks(rawName).split('\n');
  const lines = originalLines.map(trimCell).filter(Boolean);
  let current = lines[0] || '';
  const formerNames = [];
  const unparsedLines = [];

  const addFormer = (value) => {
    const cleaned = trimCell(value)
      .replace(/^[（(]\s*原\s*/, '')
      .replace(/^原\s*/, '')
      .replace(/[）)]\s*$/, '')
      .trim();
    if (cleaned) formerNames.push(cleaned);
  };

  // Explicit parenthetical former-name marker in the first line, e.g. 拉萨...（原天海万达影城）.
  current = current.replace(/\s*[（(]\s*原\s*([^（）()]+?)\s*[）)]/g, (_match, former) => {
    addFormer(former);
    return '';
  }).trim();

  // Explicit inline marker in the current name, e.g. "...店）- 原万达影城" or "...店）原万达影城".
  const inlineFormer = current.match(/^(.+?)(?:\s*[-—]\s*|[）)]\s*)原\s*(.+)$/);
  if (inlineFormer) {
    current = inlineFormer[1].trim();
    addFormer(inlineFormer[2]);
  }

  for (const line of lines.slice(1)) {
    if (/^[（(]?\s*原\s*/.test(line)) {
      addFormer(line);
    } else {
      unparsedLines.push(line);
    }
  }

  return {
    name: current,
    nameRaw: normalizeLineBreaks(rawName),
    formerNames: unique(formerNames),
    unparsedNameLines: unparsedLines,
  };
}

const MAINLAND_CITIES = {
  北京: ['北京'],
  上海: ['上海'],
  天津: ['天津'],
  重庆: ['重庆'],
  黑龙江: ['哈尔滨', '齐齐哈尔', '大庆', '佳木斯', '鸡西', '牡丹江', '绥化'],
  吉林: ['长春', '吉林', '四平', '延吉', '松原', '通化', '白城'],
  辽宁: ['沈阳', '大连', '盘锦', '抚顺', '丹东', '朝阳', '辽阳', '锦州', '本溪', '鞍山', '阜新', '营口', '葫芦岛'],
  内蒙古: ['呼和浩特', '包头', '赤峰', '乌海', '通辽', '鄂尔多斯', '呼伦贝尔', '满洲里'],
  山西: ['太原', '大同', '晋中', '长治', '运城', '临汾', '阳泉', '朔州', '晋城', '吕梁'],
  河北: ['石家庄', '廊坊', '唐山', '邯郸', '邢台', '秦皇岛', '张家口', '承德', '保定', '沧州', '衡水'],
  山东: ['济南', '青岛', '潍坊', '东营', '泰安', '济宁', '烟台', '德州', '滨州', '枣庄', '菏泽', '临沂', '日照', '淄博', '威海', '聊城'],
  江苏: ['南京', '苏州', '太仓', '昆山', '张家港', '常熟', '金坛', '宜兴', '江阴', '镇江', '丹阳', '南通', '海门', '盐城', '东台', '扬州', '连云港', '宿迁', '沭阳', '淮安', '泰州', '靖江', '徐州', '无锡', '常州', '启东', '如皋'],
  浙江: ['杭州', '宁波', '温州', '绍兴', '台州', '湖州', '嘉兴', '金华', '衢州', '舟山', '丽水', '余姚', '慈溪', '诸暨', '嵊州', '义乌', '桐乡', '海宁', '乐清', '温岭', '东阳'],
  安徽: ['合肥', '芜湖', '铜陵', '阜阳', '蚌埠', '马鞍山', '亳州', '宿州', '安庆', '淮北', '六安', '黄山', '宣城', '淮南', '滁州', '巢湖'],
  福建: ['福州', '厦门', '莆田', '泉州', '石狮', '安溪', '晋江', '漳州', '宁德', '龙岩', '三明', '南平', '福清'],
  江西: ['南昌', '赣州', '宜春', '新余', '上饶', '抚州', '九江', '吉安', '景德镇', '萍乡'],
  河南: ['郑州', '洛阳', '安阳', '三门峡', '焦作', '南阳', '平顶山', '新乡', '鹤壁', '商丘', '开封', '许昌', '信阳', '驻马店', '周口', '漯河'],
  湖北: ['武汉', '襄阳', '宜昌', '荆州', '黄石', '荆门', '十堰', '孝感', '黄冈', '武穴', '仙桃', '咸宁', '随州', '鄂州'],
  湖南: ['长沙', '宁乡', '郴州', '湘潭', '常德', '益阳', '衡阳', '岳阳', '邵阳', '株洲', '永州', '娄底', '怀化'],
  广东: ['广州', '深圳', '东莞', '惠州', '江门', '湛江', '珠海', '汕头', '梅州', '清远', '茂名', '高州', '肇庆', '韶关', '揭阳', '佛山', '中山', '阳江', '云浮', '汕尾'],
  广西: ['南宁', '桂林', '柳州', '贵港', '玉林', '北海', '梧州', '钦州', '百色', '河池'],
  海南: ['海口', '三亚', '儋州'],
  四川: ['成都', '绵阳', '广元', '内江', '自贡', '泸州', '资阳', '德阳', '乐山', '遂宁', '眉山', '达州', '雅安', '宜宾', '攀枝花', '南充', '广安', '巴中'],
  云南: ['昆明', '西双版纳', '大理', '曲靖', '玉溪', '丽江', '普洱', '保山', '红河'],
  贵州: ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁'],
  陕西: ['西安', '渭南', '榆林', '宝鸡', '咸阳', '汉中', '延安', '安康', '商洛'],
  宁夏: ['银川', '吴忠', '石嘴山', '固原', '中卫'],
  甘肃: ['兰州', '酒泉', '武威', '天水', '张掖', '庆阳', '平凉', '白银', '定西'],
  青海: ['西宁', '海东'],
  新疆: ['乌鲁木齐', '克拉玛依', '喀什', '伊宁', '库尔勒', '阿克苏', '昌吉'],
  西藏: ['拉萨', '日喀则'],
};

const TAIWAN_CITIES = [
  ['台北', ['台北', '臺北']], ['新北', ['新北']], ['桃园', ['桃园', '桃園']],
  ['台中', ['台中', '臺中']], ['台南', ['台南', '臺南']], ['高雄', ['高雄']],
  ['基隆', ['基隆']], ['新竹', ['新竹']], ['嘉义', ['嘉义', '嘉義']],
  ['彰化', ['彰化']], ['云林', ['云林', '雲林']], ['南投', ['南投']],
  ['屏东', ['屏东', '屏東']], ['宜兰', ['宜兰', '宜蘭']], ['花莲', ['花莲', '花蓮']],
  ['台东', ['台东', '臺東', '台東']], ['澎湖', ['澎湖']], ['金门', ['金门', '金門']],
  ['马祖', ['马祖', '馬祖']],
];

const CITY_PREFIXES = [
  { region: '香港', province: '香港', city: '香港', aliases: ['香港'] },
  { region: '澳门', province: '澳门', city: '澳门', aliases: ['澳门', '澳門'] },
  ...TAIWAN_CITIES.map(([city, aliases]) => ({ region: '台湾', province: '台湾', city, aliases })),
  ...Object.entries(MAINLAND_CITIES).flatMap(([province, cities]) => cities.map((city) => ({
    region: '中国大陆', province, city, aliases: [city],
  }))),
];

const CITY_PREFIX_LOOKUP = CITY_PREFIXES
  .flatMap((entry) => entry.aliases.map((alias) => ({ ...entry, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

function deriveLocation(name) {
  const candidate = trimCell(name);
  const simplified = simplify(candidate);
  const found = CITY_PREFIX_LOOKUP.find(({ alias }) => simplified.startsWith(simplify(alias)));
  if (found) {
    return {
      region: found.region,
      province: found.province,
      city: found.city,
      confidence: 'high',
      rule: `current-name-prefix:${found.alias}`,
    };
  }
  // The tab is explicitly IMAX中国, so a name that is not prefixed by the three
  // separately handled regions may still be assigned the dataset region. Province
  // and city remain unknown until a name-specific rule or geocoder confirms them.
  return {
    region: '中国大陆',
    province: null,
    city: null,
    confidence: 'unknown',
    rule: 'no-safe-city-prefix',
  };
}

function parseProjection(rawProjection) {
  const raw = normalizeLineBreaks(rawProjection);
  const normalized = simplify(raw).replace(/[ \t\u00a0]+/g, ' ').trim();
  const currentNormalized = normalized
    .split('\n')
    .map((line) => line.replace(/即将.*$/i, '').trim())
    .filter(Boolean)
    .join('\n');
  const hasCommercialLaser = /commercial\s+laser|商业激光/i.test(currentNormalized);
  const hasXt = /(?:^|[^A-Z])XT(?:$|[^A-Z])/i.test(currentNormalized);
  const hasGt = /(?:^|[^A-Z])GT(?:$|[^A-Z])/i.test(currentNormalized);
  const hasXenon = /氙灯|xenon/i.test(currentNormalized);
  const hasLaser = /laser|激光/i.test(currentNormalized);
  const dome = /dome|穹顶|球幕/i.test(currentNormalized);
  const geometry = hasGt ? 'GT' : /(?:^|[^A-Z])SR(?:$|[^A-Z])/i.test(currentNormalized) ? 'SR' : null;
  const is3D = /(?:^|[^A-Z0-9])3D(?:$|[^A-Z0-9])/i.test(currentNormalized) ? true : null;
  const film1570 = /15\s*[/／]?\s*70|胶片|film/i.test(currentNormalized) ? true : null;
  const channelMatches = [...normalized.matchAll(/(?:^|[^0-9])(6|12)\s*声道/g)].map((match) => Number(match[1]));
  const channelValues = unique(channelMatches.map(String)).map(Number);
  const audioChannels = channelValues.length === 1 ? channelValues[0] : null;
  const plannedSystem = /即将[^\n]*?(?:laser\s+xt|激光\s*xt)/i.test(normalized) ? 'Laser XT' : null;

  let technology = 'unknown';
  if (hasXenon && hasLaser) technology = 'mixed';
  else if (hasXenon) technology = 'xenon';
  else if (hasLaser) technology = 'laser';

  let system = 'unknown';
  if (hasCommercialLaser) system = 'Commercial Laser';
  else if (hasLaser && hasGt) system = 'GT Laser';
  else if (hasLaser && hasXt) system = 'Laser XT';
  else if (hasXenon) system = 'Xenon';

  const generationMatch = normalized.match(/gen(?:eration)?\s*([0-9]+)/i);
  const generation = generationMatch ? `Gen ${generationMatch[1]}` : null;
  const unrecognizedTokens = [];
  if (!normalized) unrecognizedTokens.push('empty projection text');
  if (/待定/.test(normalized)) unrecognizedTokens.push('待定');
  if (system === 'unknown' && geometry) unrecognizedTokens.push(`未能确定${geometry}的投影技术`);
  if (system === 'unknown' && !geometry && normalized) unrecognizedTokens.push('未匹配标准系统');

  return {
    raw,
    normalized,
    technology,
    system,
    geometry,
    is3D,
    audioChannels,
    dome,
    film1570,
    generation,
    plannedSystem,
    recognitionStatus: system === 'unknown' ? 'unrecognized' : (plannedSystem ? 'recognized-with-planned-change' : 'recognized'),
    unrecognizedTokens,
  };
}

function parseSingleNumeric(rawValue) {
  const normalized = normalizeLineBreaks(rawValue).replace(/\u00a0/g, ' ');
  if (!normalized.trim()) return { value: null, class: 'blank' };
  const lines = normalized.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length !== 1) return { value: null, class: 'multi-value', lines };
  const line = lines[0].replace(/(?:米|m|平方米|个)\s*$/i, '').trim();
  if (/^\d+(?:\.\d+)?$/.test(line)) {
    const value = Number(line);
    if (Number.isFinite(value)) return { value, class: 'single-value' };
  }
  const numericTokens = line.match(/\d+(?:\.\d+)?/g) || [];
  if (numericTokens.length > 1) return { value: null, class: 'multi-value-inline', lines };
  return { value: null, class: 'invalid-text', lines };
}

function parseScreen(widthRaw, heightRaw, areaRaw) {
  const fields = {
    width: parseSingleNumeric(widthRaw),
    height: parseSingleNumeric(heightRaw),
    area: parseSingleNumeric(areaRaw),
  };
  const numericFields = Object.values(fields).filter((field) => field.class === 'single-value').length;
  const allNumeric = numericFields === 3;
  let areaMismatch = false;
  let areaRelativeDifference = null;
  if (allNumeric) {
    const expectedArea = fields.width.value * fields.height.value;
    areaRelativeDifference = Math.abs(expectedArea - fields.area.value) / Math.max(Math.abs(fields.area.value), 0.0001);
    areaMismatch = areaRelativeDifference > 0.05;
  }
  let selectionConfidence = 'unknown';
  if (allNumeric && !areaMismatch) selectionConfidence = 'high';
  else if (allNumeric) selectionConfidence = 'medium';
  else if (numericFields > 0) selectionConfidence = 'low';

  return {
    width: fields.width.value,
    height: fields.height.value,
    area: fields.area.value,
    selectionConfidence,
    _fields: fields,
    _areaMismatch: areaMismatch,
    _areaRelativeDifference: areaRelativeDifference,
  };
}

function parseSeats(rawSeats) {
  const normalized = normalizeLineBreaks(rawSeats).replace(/\u00a0/g, ' ').trim();
  if (!normalized) return { value: null, class: 'blank' };
  if (/^\d+$/.test(normalized)) return { value: Number(normalized), class: 'single-value' };
  if (/\d/.test(normalized) && /\n|\+|轮椅|輪椅|位置|座/.test(normalized)) return { value: null, class: 'multi-value' };
  return { value: null, class: 'invalid-text' };
}

const STATUS_SIGNAL_DEFINITIONS = [
  { kind: 'closed', label: 'permanent-closure', patterns: ['正式关闭', '正式结业', '结束运营', '停止放映', '永久关闭', '关门', '闭店', '结业'] },
  { kind: 'temporarily_closed', label: 'temporary-closure', patterns: ['停业', '暂停营业', '暂时关闭'] },
  { kind: 'open', label: 'reopen', patterns: ['重新开业'] },
  { kind: 'open', label: 'opening', patterns: ['试营业', '开业', '营业', '开幕'] },
];

function dateFromLine(line) {
  const full = line.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2, '0')}-${String(full[3]).padStart(2, '0')}`;
  const month = line.match(/(\d{4})年\s*(\d{1,2})月/);
  if (month) return `${month[1]}-${String(month[2]).padStart(2, '0')}-01`;
  const year = line.match(/(\d{4})年/);
  return year ? `${year[1]}-01-01` : null;
}

function parseStatus(rawHistory) {
  const normalized = simplify(normalizeLineBreaks(rawHistory));
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const events = [];
  lines.forEach((line, lineIndex) => {
    const date = dateFromLine(line);
    const lineCandidates = [];
    for (const definition of STATUS_SIGNAL_DEFINITIONS) {
      for (const pattern of definition.patterns) {
        const index = line.indexOf(pattern);
        if (index >= 0) {
          lineCandidates.push({
            lineIndex,
            date,
            kind: definition.kind,
            label: definition.label,
            signal: pattern,
            signalOrder: index,
            signalEnd: index + pattern.length,
          });
        }
      }
    }
    // Prefer the longest marker when markers overlap (e.g. 正式结业/结业 and
    // 重新开业/开业), while retaining separate non-overlapping markers.
    lineCandidates.sort((a, b) => a.signalOrder - b.signalOrder || b.signal.length - a.signal.length);
    const accepted = [];
    for (const candidate of lineCandidates) {
      const overlaps = accepted.some((event) => candidate.signalOrder < event.signalEnd && candidate.signalEnd > event.signalOrder);
      if (!overlaps) accepted.push(candidate);
    }
    events.push(...accepted);
  });

  // Prefer dates when both events have dates. If one event has no date, retain
  // the spreadsheet's historical line order rather than treating it as year 0.
  events.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    return a.lineIndex - b.lineIndex || a.signalOrder - b.signalOrder;
  });
  const latest = events.at(-1) || null;
  const status = latest?.kind || 'unknown';
  const confidence = latest ? (latest.date ? 'high' : 'medium') : 'unknown';
  let reason = null;
  if (!latest) reason = /即将|计划|预计/.test(normalized) ? 'status-future-only-or-no-decisive-event' : 'status-no-decisive-event';
  const historySummary = latest
    ? `${events.length} 条明确状态信号；最新信号：${latest.date || '未标日期'} ${latest.signal}`
    : '未发现可安全判定营业状态的明确信号';

  return {
    status,
    confidence,
    historySummary,
    _lines: lines.length,
    _events: events,
    _reason: reason,
  };
}

function loadGeocodeCache() {
  if (!fs.existsSync(GEOCODE_CACHE_PATH)) return {};
  try {
    const cache = JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf8'));
    return cache.results || {};
  } catch (error) {
    console.warn(`Ignoring invalid geocode cache: ${error.message}`);
    return {};
  }
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function applyGeocode(location, id, cache) {
  const entry = cache[id];
  if (!entry) return { ...location, lat: null, lng: null, address: '', geocodeConfidence: 'unknown', geocodeSource: '' };
  const lat = Number(entry.lat);
  const lng = Number(entry.lng);
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) {
    return { ...location, lat: null, lng: null, address: '', geocodeConfidence: 'unknown', geocodeSource: '' };
  }
  return {
    ...location,
    lat,
    lng,
    address: String(entry.address || ''),
    geocodeConfidence: ['high', 'medium', 'low'].includes(entry.confidence) ? entry.confidence : 'unknown',
    geocodeSource: String(entry.source || ''),
  };
}

function buildRecord(row, geocodeCache) {
  const sourceRow = row.rowIndex;
  const id = `imax-cn-${String(sourceRow).padStart(4, '0')}`;
  const name = parseName(cellDisplay(row, 0));
  const projection = parseProjection(cellDisplay(row, 1));
  const location = deriveLocation(name.name);
  const screenRaw = {
    width: cellDisplay(row, 3),
    height: cellDisplay(row, 4),
    area: cellDisplay(row, 5),
  };
  const screenParsed = parseScreen(screenRaw.width, screenRaw.height, screenRaw.area);
  const seatsRaw = cellDisplay(row, 6);
  const seatsParsed = parseSeats(seatsRaw);
  const statusParsed = parseStatus(cellDisplay(row, 2));
  const reasons = [];
  const details = [];
  const addReview = (code, detail) => {
    if (!reasons.includes(code)) reasons.push(code);
    if (detail && !details.includes(detail)) details.push(detail);
  };

  if (!name.name) addReview('name-empty', '影城名称没有可用的第一行名称候选');
  if (name.unparsedNameLines.length) addReview('name-history-ambiguous', `名称存在未能按“原”规则解释的附加行：${name.unparsedNameLines.length} 行`);
  if (projection.recognitionStatus === 'unrecognized') addReview('projection-unrecognized', projection.unrecognizedTokens.join('；'));
  if (projection.plannedSystem) addReview('projection-planned-upgrade', `源文本包含即将升级为 ${projection.plannedSystem} 的计划描述`);
  if (location.city === null) addReview('city-unknown', '未使用短字符截取；当前名称没有命中安全的城市前缀词表');

  for (const [field, parsed] of Object.entries(screenParsed._fields)) {
    if (parsed.class === 'multi-value' || parsed.class === 'multi-value-inline') addReview('screen-multivalue', `${field} 存在多组值，未选择第一/最后/最大/最小值`);
    if (parsed.class === 'invalid-text') addReview('screen-abnormal-text', `${field} 不是安全的单一数值文本`);
    if (parsed.class === 'blank') addReview('screen-missing', `${field} 为空或仅含空白字符`);
  }
  if (screenParsed._areaMismatch) addReview('screen-area-mismatch', `width×height 与 area 相对差异 ${((screenParsed._areaRelativeDifference || 0) * 100).toFixed(2)}% > 5%`);
  if (seatsParsed.class === 'blank') addReview('seats-missing', '座位数为空或仅含空白字符');
  if (seatsParsed.class === 'multi-value') addReview('seats-multivalue', '座位数包含多组值或附加座位说明，未强行取值');
  if (seatsParsed.class === 'invalid-text') addReview('seats-invalid', '座位数不是安全的单一整数');
  if (statusParsed.status === 'unknown') addReview('status-unknown', statusParsed._reason);

  const locationWithGeocode = applyGeocode({
    region: location.region,
    province: location.province,
    city: location.city,
    lat: null,
    lng: null,
    address: '',
    geocodeConfidence: 'unknown',
    geocodeSource: '',
  }, id, geocodeCache);
  if (!validCoordinate(locationWithGeocode.lat, -90, 90) || !validCoordinate(locationWithGeocode.lng, -180, 180)) {
    addReview('geocode-pending', '没有经过影院名称与城市双重匹配的可靠经纬度；保留 null');
  }

  const record = {
    id,
    sourceRow,
    sheetRow: row.sheetRow,
    name: name.name,
    nameRaw: name.nameRaw,
    formerNames: name.formerNames,
    region: locationWithGeocode.region,
    province: locationWithGeocode.province,
    city: locationWithGeocode.city,
    projection: {
      raw: projection.raw,
      technology: projection.technology,
      system: projection.system,
      geometry: projection.geometry,
      is3D: projection.is3D,
      audioChannels: projection.audioChannels,
      dome: projection.dome,
      film1570: projection.film1570,
      generation: projection.generation,
      plannedSystem: projection.plannedSystem,
    },
    screen: {
      width: screenParsed.width,
      height: screenParsed.height,
      area: screenParsed.area,
      rawWidth: screenRaw.width,
      rawHeight: screenRaw.height,
      rawArea: screenRaw.area,
      selectionConfidence: screenParsed.selectionConfidence,
    },
    seats: seatsParsed.value,
    seatsRaw,
    status: statusParsed.status,
    historySummary: statusParsed.historySummary,
    location: {
      lat: locationWithGeocode.lat,
      lng: locationWithGeocode.lng,
      address: locationWithGeocode.address,
      geocodeConfidence: locationWithGeocode.geocodeConfidence,
      geocodeSource: locationWithGeocode.geocodeSource,
    },
    source: { ...SOURCE },
  };

  return {
    record,
    review: reasons.length ? {
      id,
      sourceRow,
      name: name.name,
      reasonCodes: reasons,
      details,
      location: {
        region: locationWithGeocode.region,
        province: locationWithGeocode.province,
        city: locationWithGeocode.city,
        lat: locationWithGeocode.lat,
        lng: locationWithGeocode.lng,
      },
      projection: {
        raw: projection.raw,
        system: projection.system,
        technology: projection.technology,
        plannedSystem: projection.plannedSystem,
      },
      screen: {
        rawWidth: screenRaw.width,
        rawHeight: screenRaw.height,
        rawArea: screenRaw.area,
        selectionConfidence: screenParsed.selectionConfidence,
      },
      status: statusParsed.status,
    } : null,
    _meta: {
      sourceRow,
      name,
      projection,
      location,
      screenRaw,
      screenParsed,
      seatsParsed,
      statusParsed,
      reasons,
    },
  };
}

function countBy(records, getter) {
  return records.reduce((counts, record) => {
    const key = getter(record);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function addSample(samples, record, kind) {
  if (!record) return;
  const existing = samples.find((sample) => sample.id === record.id);
  if (existing) {
    existing.kinds = unique([...(existing.kinds || [existing.kind]), kind]);
    return;
  }
  samples.push({
    kind,
    kinds: [kind],
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    region: record.region,
    province: record.province,
    city: record.city,
    system: record.projection.system,
    dome: record.projection.dome,
    audioChannels: record.projection.audioChannels,
    status: record.status,
    screenSelectionConfidence: record.screen.selectionConfidence,
    lat: record.location.lat,
    lng: record.location.lng,
  });
}

function buildSamples(records) {
  const samples = [];
  records.slice(0, 10).forEach((record) => addSample(samples, record, 'first-10'));
  records.slice(-10).forEach((record) => addSample(samples, record, 'last-10'));
  for (let index = 0; index < records.length; index += 50) addSample(samples, records[index], 'every-50th');

  const strata = [
    ['上海', (r) => r.city === '上海', 1], ['北京', (r) => r.city === '北京', 1],
    ['广州/深圳', (r) => r.city === '广州' || r.city === '深圳', 1], ['西安', (r) => r.city === '西安', 1],
    ['成都', (r) => r.city === '成都', 1], ['香港', (r) => r.region === '香港', 3],
    ['澳门', (r) => r.region === '澳门', 1], ['台湾', (r) => r.region === '台湾', 5],
    ['GT Laser', (r) => r.projection.system === 'GT Laser', 1], ['Laser XT', (r) => r.projection.system === 'Laser XT', 1],
    ['Xenon', (r) => r.projection.system === 'Xenon', 1], ['Dome', (r) => r.projection.dome, 1],
    ['GT Dome', (r) => r.projection.raw.includes('GT Dome'), 1], ['SR Dome', (r) => r.projection.raw.includes('SR Dome'), 1],
    ['GT Laser 3D', (r) => r.projection.raw.includes('Laser GT 3D'), 1], ['12声道/12聲道', (r) => r.projection.audioChannels === 12, 1],
    ['closed', (r) => r.status === 'closed', 1],
  ];
  for (const [kind, predicate, count] of strata) records.filter(predicate).slice(0, count).forEach((record) => addSample(samples, record, kind));

  const pseudoRandom = [...records].sort((a, b) => {
    const score = (record) => Math.abs(Math.sin(record.sourceRow * 12.9898) * 43758.5453) % 1;
    return score(a) - score(b);
  });
  pseudoRandom.slice(0, 20).forEach((record) => addSample(samples, record, 'seeded-random'));
  return samples;
}

function buildProjectionVocabulary(rows) {
  const byRaw = new Map();
  for (const row of rows) {
    const raw = cellDisplay(row, 1);
    const current = byRaw.get(raw) || { raw, count: 0, sourceRows: [] };
    current.count += 1;
    if (current.sourceRows.length < 5) current.sourceRows.push(row.rowIndex);
    byRaw.set(raw, current);
  }
  const entries = [...byRaw.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  const unrecognized = [];
  const values = entries.map((entry) => {
    const parsed = parseProjection(entry.raw);
    const result = {
      raw: entry.raw,
      normalized: parsed.normalized,
      count: entry.count,
      exampleSourceRows: entry.sourceRows,
      standardized: {
        technology: parsed.technology,
        system: parsed.system,
        geometry: parsed.geometry,
        is3D: parsed.is3D,
        audioChannels: parsed.audioChannels,
        dome: parsed.dome,
        film1570: parsed.film1570,
        generation: parsed.generation,
        plannedSystem: parsed.plannedSystem,
      },
      recognitionStatus: parsed.recognitionStatus,
      unrecognizedItems: parsed.unrecognizedTokens,
    };
    if (parsed.recognitionStatus === 'unrecognized') unrecognized.push(result);
    return result;
  });
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    source: { ...SOURCE },
    rules: {
      primarySystem: 'Commercial Laser takes precedence; then GT Laser, Laser XT, Xenon; GT/SR without a stated technology remain unknown.',
      dimensions: 'Projection raw text is preserved. GT, Laser, Dome, audio channels, 3D and film1570 are separate dimensions.',
      traditionalNormalization: 'Traditional variants are normalized only for matching; projection.raw is not rewritten.',
    },
    entries: values,
    unrecognized,
  };
}

function buildStatusAudit(recordsWithMeta) {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    source: { ...SOURCE },
    rules: {
      permanentClosure: STATUS_SIGNAL_DEFINITIONS[0].patterns,
      temporaryClosure: STATUS_SIGNAL_DEFINITIONS[1].patterns,
      reopening: STATUS_SIGNAL_DEFINITIONS.slice(2).flatMap((definition) => definition.patterns),
      decision: 'Events are sorted by explicit date, then source line order. A later reopen/open event supersedes an earlier closure; no explicit signal remains unknown.',
      plannedEvents: '即将/计划/预计 without a completed opening event do not establish current open status.',
    },
    summary: {
      statusCounts: countBy(recordsWithMeta, (item) => item.record.status),
      eventRows: recordsWithMeta.filter((item) => item._meta.statusParsed._events.length > 0).length,
    },
    records: recordsWithMeta.map(({ record, _meta }) => ({
      id: record.id,
      sourceRow: record.sourceRow,
      name: record.name,
      status: record.status,
      confidence: _meta.statusParsed.confidence,
      historyLineCount: _meta.statusParsed._lines,
      events: _meta.statusParsed._events.map((event) => ({
        lineIndex: event.lineIndex,
        date: event.date,
        kind: event.kind,
        label: event.label,
        signal: event.signal,
      })),
      latestEvent: _meta.statusParsed._events.at(-1) ? {
        date: _meta.statusParsed._events.at(-1).date,
        kind: _meta.statusParsed._events.at(-1).kind,
        signal: _meta.statusParsed._events.at(-1).signal,
      } : null,
      reason: _meta.statusParsed._reason,
    })),
  };
}

function buildQualityAudit(records, recordsWithMeta, reviews, raw) {
  const reviewReasonCounts = {};
  for (const review of reviews) {
    for (const reason of review.reasonCodes) reviewReasonCounts[reason] = (reviewReasonCounts[reason] || 0) + 1;
  }
  const screenMeta = recordsWithMeta.map((item) => item._meta.screenParsed);
  const allDimensionsSingle = screenMeta.filter((screen) => Object.values(screen._fields).every((field) => field.class === 'single-value')).length;
  const multiValueRecords = screenMeta.filter((screen) => Object.values(screen._fields).some((field) => field.class === 'multi-value' || field.class === 'multi-value-inline'));
  const abnormalRecords = screenMeta.filter((screen) => Object.values(screen._fields).some((field) => field.class === 'invalid-text'));
  const fieldClasses = {};
  for (const field of ['width', 'height', 'area']) fieldClasses[field] = countBy(recordsWithMeta, (item) => item._meta.screenParsed._fields[field].class);
  const validation = {
    recordCount: records.length,
    sourceDataRowCount: raw.rows.filter((row) => row.rowType === 'data').length,
    uniqueIds: new Set(records.map((record) => record.id)).size,
    continuousSourceRows: records.every((record, index) => record.sourceRow === index + 2),
    invalidLatLng: records.filter((record) => {
      const { lat, lng } = record.location;
      return (lat !== null && !validCoordinate(lat, -90, 90)) || (lng !== null && !validCoordinate(lng, -180, 180));
    }).length,
    nullValues: records.reduce((count, record) => count + (JSON.stringify(record).match(/:null/g) || []).length, 0),
    nanValues: JSON.stringify(records).includes('NaN') ? 1 : 0,
  };
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    source: { ...SOURCE },
    counts: {
      generatedRecords: records.length,
      status: countBy(records, (record) => record.status),
      projectionPrimarySystem: countBy(records, (record) => record.projection.system),
      dome: records.filter((record) => record.projection.dome).length,
      twelveChannel: records.filter((record) => record.projection.audioChannels === 12).length,
      geography: {
        cityPresent: records.filter((record) => record.city !== null && record.city !== '').length,
        reliableLatLng: records.filter((record) => ['high', 'medium'].includes(record.location.geocodeConfidence) && validCoordinate(record.location.lat, -90, 90) && validCoordinate(record.location.lng, -180, 180)).length,
        locatedAnyConfidence: records.filter((record) => validCoordinate(record.location.lat, -90, 90) && validCoordinate(record.location.lng, -180, 180)).length,
        unlocated: records.filter((record) => !validCoordinate(record.location.lat, -90, 90) || !validCoordinate(record.location.lng, -180, 180)).length,
        regions: countBy(records, (record) => record.region),
      },
      screen: {
        allThreeSingleValueDirect: allDimensionsSingle,
        multiValueSuccessful: 0,
        multiValueNeedsReview: multiValueRecords.length,
        abnormalData: abnormalRecords.length,
        anyScreenReview: recordsWithMeta.filter((item) => item._meta.reasons.some((reason) => reason.startsWith('screen-'))).length,
        fieldClasses,
      },
      seats: countBy(recordsWithMeta, (item) => item._meta.seatsParsed.class),
      reviewNeeded: reviews.length,
      reviewReasonCounts,
    },
    validation,
    manualSamples: buildSamples(records),
  };
}

function main() {
  const { raw, rows } = parseSource();
  const geocodeCache = loadGeocodeCache();
  const built = rows.map((row) => buildRecord(row, geocodeCache));
  const records = built.map((item) => item.record);
  const reviews = built.flatMap((item) => item.review ? [item.review] : []);
  const derived = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    dataset: 'arvin-imax-derived-cinemas',
    source: { ...SOURCE },
    columns: COLUMNS,
    derivation: {
      script: 'scripts/derive-cinemas.mjs',
      rawInput: 'data/raw/arvin-imax.json',
      notes: [
        'Raw source display text is retained in projection.raw, nameRaw, screen.rawWidth/rawHeight/rawArea and seatsRaw.',
        'Multi-value dimensions are not reduced by first/last/max/min rules; unresolved values remain null and are reviewed.',
        'Coordinates are populated only from data/derived/geocode-cache.json entries with an explicit provider and confidence.',
      ],
    },
    records,
  };
  const reviewDataset = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    dataset: 'arvin-imax-review-needed',
    source: { ...SOURCE },
    reasonDefinitions: {
      'name-empty': 'No safe current name candidate.',
      'name-history-ambiguous': 'Name has an extra line not explicitly marked as a former name.',
      'projection-unrecognized': 'Projection text could not be mapped to a primary technology/system.',
      'projection-planned-upgrade': 'Projection text includes a planned upgrade; current system remains the explicit current line.',
      'city-unknown': 'No safe city prefix match; no substring guessing was used.',
      'screen-multivalue': 'Multiple screen values were retained as raw text and not selected.',
      'screen-abnormal-text': 'Screen field contains non-numeric source text.',
      'screen-missing': 'Screen field is empty or whitespace-only.',
      'screen-area-mismatch': 'Parsed width × height differs materially from source area; no correction applied.',
      'seats-missing': 'Seats field is empty or whitespace-only.',
      'seats-multivalue': 'Seats field contains multiple values or a seat-note suffix.',
      'seats-invalid': 'Seats field is not a single integer.',
      'status-unknown': 'No decisive dated/ordered current status event was found.',
      'geocode-pending': 'No reliable, name-and-city-matched coordinate is cached.',
    },
    records: reviews,
  };

  writeJson(path.join(DERIVED_DIR, 'cinemas.json'), derived);
  writeJson(path.join(DERIVED_DIR, 'review-needed.json'), reviewDataset);
  writeJson(path.join(AUDIT_DIR, 'projection-vocabulary.json'), buildProjectionVocabulary(rows));
  writeJson(path.join(AUDIT_DIR, 'status-parsing.json'), buildStatusAudit(built));
  writeJson(path.join(AUDIT_DIR, 'derived-quality.json'), buildQualityAudit(records, built, reviews, raw));

  console.log(JSON.stringify({
    generatedAt: GENERATED_AT,
    records: records.length,
    reviews: reviews.length,
    status: countBy(records, (record) => record.status),
    systems: countBy(records, (record) => record.projection.system),
    dome: records.filter((record) => record.projection.dome).length,
    twelveChannel: records.filter((record) => record.projection.audioChannels === 12).length,
    cityPresent: records.filter((record) => record.city).length,
    located: records.filter((record) => validCoordinate(record.location.lat, -90, 90) && validCoordinate(record.location.lng, -180, 180)).length,
  }, null, 2));
}

main();
