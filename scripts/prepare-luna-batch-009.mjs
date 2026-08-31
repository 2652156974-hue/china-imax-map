import fs from 'node:fs';

const file = 'data/local/luna-geocode-review-323.json';
const cacheFile = 'data/geocode/provider-cache/amap.json';
const evidence = {
  569: [
    'https://www.wanda.cn/2015/2015latest_0616/31538.html',
    'https://www.ruyifilm.com/gywm/yclb/hddq/zjs/0df313b3965d11e982dc005056835733.html'
  ],
  581: [
    'https://www.zjdj.com.cn/zjcf/zx/202309/t20230918_26231495.shtml',
    'https://map.baidu.com/mobile/webapp/search/search/qt%3Ds%26wd%3D%E6%B5%99%E6%B1%9F%E7%9C%81%E6%B9%96%E5%B7%9E%E5%B8%82%E5%90%B4%E5%85%B4%E5%8C%BA%E6%B9%96%E4%B8%9C%E8%A1%97%E9%81%93%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA%E4%B8%89%E6%A5%BC3F-C%E5%8F%B7%E5%95%86%E9%93%BA/'
  ],
  606: [
    'https://pic.bankofchina.com/bocappd/appform_1/201412/P020141231511419593148.pdf',
    'https://m.city8.com/huhehaote/movie/83fw7b82i2b7b7388d'
  ],
  634: [
    'https://czt.fujian.gov.cn/zwgk/czzj/202509/P020250905412926999950.pdf',
    'https://www.maigoo.com/citiao/1084606.html'
  ],
  649: [
    'https://www.wanda.cn/2012/headlines_1215/5986.html',
    'https://www.amap.com/place/B02520N9TY',
    'https://www.zjfae.com/html/yx.pdf'
  ],
  650: [
    'https://www.ruyifilm.com/gywm/yclb/hddq/fjs/0d7fc348965d11e982dc005056835733.html',
    'https://touch.go.qunar.com/poi/10477643'
  ],
  657: [
    'https://www.ruyifilm.com/gywm/yclb/hddq/fjs/0d94f80d965d11e982dc005056835733.html',
    'https://www.wanda.cn/2012/2012_1026/21824.html',
    'https://www.zjfae.com/html/yx.pdf'
  ],
  659: [
    'https://czt.fujian.gov.cn/zwgk/czzj/202509/P020250905412926999950.pdf',
    'https://longyan.city8.com/movie/890ljg731brfb3d86a_address'
  ],
  670: [
    'https://pic.bankofchina.com/bocappd/appform_1/201412/P020141231511419593148.pdf',
    'https://www.sohu.com/a/858331753_121124602'
  ],
  694: [
    'https://www.bonafilm.cn/cinema_del/57.html',
    'https://www.zhencaiamr.com/ZHENCAIAMR-HALL.html'
  ]
};
const acceptedPoiIds = {
  569: 'B0FFG3EJP0',
  581: 'B0FFHHPUTY',
  606: 'B01D70OW9O',
  634: 'B0FFHUNIJE',
  649: 'B02520N9TY',
  650: 'B02530QXZO',
  657: 'B0FFHMID7A',
  659: 'B0FFFD51P9',
  670: 'B017B02KCR',
  694: 'B0FFKKM5G5'
};

const administrativeBindings = {
  569: {
    status: 'confirmed-by-independent-evidence',
    sourceRow: 569,
    sourceCity: '嘉兴',
    candidateCity: '嘉兴',
    candidateAdministrativeUnit: '南湖',
    evidenceUrls: evidence[569]
  },
  581: {
    status: 'confirmed-by-independent-evidence',
    sourceRow: 581,
    sourceCity: '湖州',
    candidateCity: '湖州',
    candidateAdministrativeUnit: '吴兴',
    evidenceUrls: evidence[581]
  },
  649: {
    status: 'confirmed-by-independent-evidence',
    sourceRow: 649,
    sourceCity: '莆田',
    candidateCity: '莆田',
    candidateAdministrativeUnit: '城厢',
    evidenceUrls: evidence[649]
  }
};

// These are compact, sourceRow-bound cache alternates. They intentionally
// carry only the fields needed by the strict review-context validator; raw
// provider candidates remain in the private cache and are not copied here.
const contextAlternates = {
  569: {
    poiId: 'B0FFG3EJP0',
    name: '万达影城(南湖IMAX店)',
    address: '广益路万达广场4层',
    pname: '浙江',
    cityname: '嘉兴',
    adname: '南湖',
    typecode: '080601',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    adminMatch: {
      compatible: true,
      targetProvince: '浙江',
      targetPrefecture: '嘉兴',
      targetCounty: null,
      providerProvince: '浙江',
      providerPrefecture: '嘉兴',
      providerCounty: '南湖'
    },
    formatCompatibility: { compatible: true, exactFormatMatch: false, conflicts: [] },
    providerCoordinate: { crs: 'GCJ-02', lat: 30.736111, lng: 120.803473 }
  },
  649: {
    poiId: 'B02520N9TY',
    name: '万达影城(莆田万达广场店)',
    address: '荔华东大道8号万达广场(莆田城厢店)4F层(3号门进入直行50m,扶梯上到4F可见)',
    pname: '福建',
    cityname: '莆田',
    adname: '城厢',
    typecode: '080601',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    adminMatch: {
      compatible: true,
      targetProvince: '福建',
      targetPrefecture: '莆田',
      targetCounty: null,
      providerProvince: '福建',
      providerPrefecture: '莆田',
      providerCounty: '城厢'
    },
    formatCompatibility: { compatible: true, exactFormatMatch: false, conflicts: [] },
    providerCoordinate: { crs: 'GCJ-02', lat: 25.418019, lng: 118.995473 }
  },
  657: {
    poiId: 'B0FFHMID7A',
    name: '万达影城(碧湖万达广场IMAX店)',
    address: '建元东路2号漳州碧湖万达广场4层',
    pname: '福建',
    cityname: '漳州',
    adname: '龙文',
    typecode: '080601',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    adminMatch: {
      compatible: true,
      targetProvince: '福建',
      targetPrefecture: '漳州',
      targetCounty: null,
      providerProvince: '福建',
      providerPrefecture: '漳州',
      providerCounty: '龙文'
    },
    formatCompatibility: { compatible: true, exactFormatMatch: false, conflicts: [] },
    providerCoordinate: { crs: 'GCJ-02', lat: 24.497202, lng: 117.677191 }
  }
};

const disallowedPoiIds = {
  569: ['B0FFIE39NK'],
  649: ['B0I1ASB4XI'],
  657: ['B0J3BDXISR']
};

const providerCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

function assertSourceRowBoundCacheAlternate(sourceRow, alternate) {
  const matches = providerCache.requests
    .filter((request) => Array.isArray(request.sourceRows) && request.sourceRows.some((value) => Number(value) === sourceRow))
    .flatMap((request) => Array.isArray(request.rawCandidates) ? request.rawCandidates : [])
    .filter((candidate) => candidate?.id === alternate.poiId);
  const cached = matches[0];
  if (!cached) {
    throw new Error(`Missing sourceRow-bound cached alternate ${alternate.poiId} for row ${sourceRow}.`);
  }
  const [cachedLng, cachedLat] = String(cached.location ?? '').split(',').map(Number);
  if (cached.name !== alternate.name || cached.address !== alternate.address || cached.typecode !== alternate.typecode ||
      cachedLat !== alternate.providerCoordinate.lat || cachedLng !== alternate.providerCoordinate.lng) {
    throw new Error(`Cached alternate ${alternate.poiId} does not match the compact row-${sourceRow} binding.`);
  }
}

const notes = {
  569: 'Source history fingerprint 2015-06-12, 373 seats, and 20.410×11.144 matches the older 嘉兴南湖万达 branch. The cached 嘉兴龙鼎 branch is a different same-city project; accept only sourceRow-bound B0FFG3EJP0. No new AMap request.',
  581: 'Independent Zhejiang cinema-list evidence binds 湖州万达广场店 to 吴兴区大升路899号万达广场四楼; the competing cached branch is explicitly the county-level Changxing branch. Cache candidate is sourceRow-bound; accept exact. No new AMap request.',
  606: 'Independent historical Wanda-cinema directory and current directory evidence both bind the source branch to 新华大街26号万达广场4层; other cached Hohhot branches are different districts/projects. Cache candidate is sourceRow-bound; accept exact. No new AMap request.',
  634: 'Independent Fujian cinema subsidy record names 福清市万达影城清昌大道店, and mall evidence confirms 清昌大道105号; the competing cached 福和 branch is a different project. Cache candidate is sourceRow-bound; accept exact. No new AMap request.',
  649: 'Source history fingerprint beginning 2012-12-15, 348 seats, and 21.510/21.710×11.306/11.332 matches the older 莆田城厢万达 branch; 秀屿 is a later separate project. Accept only sourceRow-bound B02520N9TY. No new AMap request.',
  650: 'Independent operator and venue evidence bind 泉州万达影城 to 宝洲路679号万达广场4层; the competing cache candidates are other counties/projects. Cache candidate is sourceRow-bound; accept exact. No new AMap request.',
  657: 'Source history fingerprint beginning 2012-11-28, 347 seats, and 21.710/21.980/20.323×11.332/11.446/11.327 matches the older 漳州碧湖万达 branch; 芗城 is a different project. Accept only sourceRow-bound B0FFHMID7A. No new AMap request.',
  659: 'Independent Fujian cinema record names the 龙岩新罗万达影城, and directory evidence binds it to 双龙路1号万达广场A1号楼4层; other cached candidates are separate 万阳城/紫金山/县域 projects. Cache candidate is sourceRow-bound; accept exact. No new AMap request.',
  670: 'Independent historical Wanda directory and local public listing bind 洛阳万达影城 to 辽宁路168号万达广场4层, matching the source IMAX project and cache candidate; accept exact. No new AMap request.',
  694: 'Bona official material and an independent cinema-format directory both bind the成都大悦城 cinema to 大悦路518号大悦城4F-001; former-name context also matches the source. Cache candidate is sourceRow-bound; accept exact. No new AMap request.'
};

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const record of data.records) {
  const row = Number(record.sourceRow);
  if (!evidence[row]) continue;
  const candidate = contextAlternates[row] ?? record.candidate;
  const poiId = acceptedPoiIds[row] ?? null;
  if (poiId) {
    if (contextAlternates[row]) assertSourceRowBoundCacheAlternate(row, contextAlternates[row]);
    if (!candidate || candidate.poiId !== poiId) {
      throw new Error(`Unexpected sourceRow-bound cache candidate at row ${row}: expected ${poiId}.`);
    }
    const coordinate = candidate.providerCoordinate;
    if (contextAlternates[row]) {
      record.reviewContext = {
        ...(record.reviewContext ?? {}),
        alternateCandidates: [contextAlternates[row]],
        disallowedPoiIds: disallowedPoiIds[row] ?? []
      };
    }
    record.review = {
      verdict: 'accept-exact',
      acceptedPoiId: poiId,
      reviewedCandidate: {
        provider: 'amap',
        poiId,
        name: candidate.name,
        address: candidate.address,
        providerCrs: coordinate.crs,
        providerLat: coordinate.lat,
        providerLng: coordinate.lng
      },
      positionType: candidate.positionType,
      locationGranularity: candidate.locationGranularity,
      locationConfidence: 'high',
      identityConfidence: 'high',
      evidenceUrls: evidence[row],
      ...(administrativeBindings[row] ? { administrativeBinding: administrativeBindings[row] } : {}),
      reviewer: 'Codex batch-009 cache-only review',
      reviewedAt: '2026-08-24T00:00:00.000Z',
      notes: notes[row],
      explicitVerdict: true,
      reviewSource: 'explicit-row-review',
      validationErrors: []
    };
  } else {
    record.review = {
      verdict: 'needs-more-evidence',
      acceptedPoiId: null,
      reviewedCandidate: {
        provider: null,
        poiId: null,
        name: null,
        address: null,
        providerCrs: null,
        providerLat: null,
        providerLng: null
      },
      positionType: null,
      locationGranularity: null,
      locationConfidence: null,
      identityConfidence: null,
      evidenceUrls: evidence[row],
      reviewer: 'Codex batch-009 cache-only review',
      reviewedAt: '2026-08-24T00:00:00.000Z',
      notes: notes[row],
      explicitVerdict: true,
      reviewSource: 'explicit-row-review',
      validationErrors: []
    };
  }
}

const tmp = `${file}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
fs.renameSync(tmp, file);
