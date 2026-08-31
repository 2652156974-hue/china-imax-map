import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ADMINISTRATIVE_FIELDS,
  bindAdministrativeRecord,
  buildAdministrativeBindings,
  createAdministrativeBindingContext
} from './admin-cluster-bindings.mjs';

const canonicalFile = new URL('../data/local/private-reviewed-geocodes.json', import.meta.url);
const canonical = JSON.parse(fs.readFileSync(canonicalFile, 'utf8'));

const hierarchy = {
  municipalities: ['北京', '上海', '天津', '重庆'],
  countyLevelDivisions: [
    { name: '昆山', province: '江苏', prefecture: '苏州', level: 'county-level-city' },
    { name: '江阴', province: '江苏', prefecture: '无锡', level: 'county-level-city' },
    { name: '金坛', province: '江苏', prefecture: '常州', level: 'county-level-district' }
  ]
};

function record({ sourceRow, province, city, poiId, lat = 31, lng = 120 }) {
  return {
    sourceRow,
    id: 'fixture-' + sourceRow,
    province,
    city,
    location: {
      providerPoiId: poiId,
      providerLat: lat,
      providerLng: lng,
      providerCrs: 'GCJ-02'
    }
  };
}

function candidate({ id, pname, cityname, adname, adcode, pcode, lat = 31, lng = 120 }) {
  return {
    id,
    pname,
    cityname,
    adname,
    adcode,
    pcode,
    location: String(lng) + ',' + String(lat)
  };
}

function cache(...entries) {
  return {
    requests: entries.map(({ sourceRow, candidates }) => ({
      sourceRows: [sourceRow],
      rawCandidates: candidates
    }))
  };
}

test('exact sourceRow/providerPoiId binding handles county-level cities and emits only admin fields', () => {
  const context = createAdministrativeBindingContext({
    hierarchyDocument: hierarchy,
    cacheDocument: cache({
      sourceRow: 113,
      candidates: [candidate({
        id: 'poi-kunshan',
        pname: '江苏省',
        cityname: '苏州市',
        adname: '昆山市',
        adcode: '320583',
        pcode: '320000'
      })]
    })
  });

  const administrative = bindAdministrativeRecord(
    record({ sourceRow: 113, province: '江苏', city: '昆山', poiId: 'poi-kunshan' }),
    context
  );

  assert.deepEqual(administrative, {
    provinceName: '江苏',
    provinceCode: '320000',
    prefectureName: '苏州',
    prefectureCode: '320500',
    prefectureLevel: 'prefecture',
    countyName: '昆山市',
    countyCode: '320583',
    countyLevel: 'county-city',
    source: 'amap-admin'
  });
  assert.deepEqual(Object.keys(administrative).sort(), [...ADMINISTRATIVE_FIELDS].sort());
  assert.equal(Object.hasOwn(administrative, 'rawCandidates'), false);
  assert.equal(Object.hasOwn(administrative, 'address'), false);
  assert.equal(Object.hasOwn(administrative, 'cache'), false);
});

test('cache unavailable falls back to hierarchy map for Kunshan and Jiangyin', () => {
  const context = createAdministrativeBindingContext({
    hierarchyDocument: hierarchy,
    cacheDocument: {}
  });
  const bindings = buildAdministrativeBindings([
    record({ sourceRow: 113, province: '江苏', city: '昆山', poiId: 'missing-kunshan' }),
    record({ sourceRow: 136, province: '江苏', city: '江阴', poiId: 'missing-jiangyin' })
  ], { context });

  assert.deepEqual(bindings.map((item) => item.administrative.countyName), ['昆山市', '江阴市']);
  assert.deepEqual(bindings.map((item) => item.administrative.prefectureName), ['苏州', '无锡']);
  assert.deepEqual(bindings.map((item) => item.administrative.countyLevel), ['county-city', 'county-city']);
  assert.deepEqual(bindings.map((item) => item.administrative.source), ['hierarchy-map', 'hierarchy-map']);
  assert.deepEqual(bindings.map((item) => item.administrative.countyCode), [null, null]);
});

test('an exact formal 市 adname remains a county-level city even without a hierarchy override', () => {
  const context = createAdministrativeBindingContext({
    hierarchyDocument: hierarchy,
    cacheDocument: cache({
      sourceRow: 59,
      candidates: [candidate({
        id: 'poi-wuchang',
        pname: '黑龙江省',
        cityname: '哈尔滨市',
        adname: '五常市',
        adcode: '230184',
        pcode: '230000'
      })]
    })
  });

  const administrative = bindAdministrativeRecord(
    record({ sourceRow: 59, province: '黑龙江', city: '哈尔滨', poiId: 'poi-wuchang' }),
    context
  );
  assert.equal(administrative.countyName, '五常市');
  assert.equal(administrative.countyLevel, 'county-city');
});

test('municipality goes directly to county only when exact provider evidence exists', () => {
  const context = createAdministrativeBindingContext({
    hierarchyDocument: hierarchy,
    cacheDocument: cache({
      sourceRow: 7,
      candidates: [candidate({
        id: 'poi-shanghai',
        pname: '上海市',
        cityname: '上海市',
        adname: '浦东新区',
        adcode: '310115',
        pcode: '310000'
      })]
    })
  });
  const exact = bindAdministrativeRecord(
    record({ sourceRow: 7, province: '上海', city: '上海', poiId: 'poi-shanghai' }),
    context
  );
  assert.equal(exact.prefectureName, null);
  assert.equal(exact.prefectureLevel, 'municipality');
  assert.equal(exact.countyName, '浦东新区');
  assert.equal(exact.countyCode, '310115');
  assert.equal(exact.countyLevel, 'district');

  const noEvidence = bindAdministrativeRecord(
    record({ sourceRow: 8, province: '上海', city: '上海', poiId: 'missing-shanghai' }),
    context
  );
  assert.equal(noEvidence.prefectureName, null);
  assert.equal(noEvidence.countyName, null);
  assert.equal(noEvidence.source, 'record-fallback');
});

test('sourceRow and exact providerPoiId are mandatory; mismatched coordinates do not become a county guess', () => {
  const context = createAdministrativeBindingContext({
    hierarchyDocument: hierarchy,
    cacheDocument: cache({
      sourceRow: 114,
      candidates: [candidate({
        id: 'poi-kunshan',
        pname: '江苏省',
        cityname: '苏州市',
        adname: '昆山市',
        adcode: '320583',
        pcode: '320000',
        lat: 32,
        lng: 121
      })]
    })
  });
  const administrative = bindAdministrativeRecord(
    record({ sourceRow: 113, province: '江苏', city: '无锡', poiId: 'poi-kunshan' }),
    context
  );
  assert.equal(administrative.countyName, null);
  assert.equal(administrative.countyCode, null);
  assert.equal(administrative.source, 'record-fallback');
});

test('all canonical rows receive a fixed nine-field administrative object', () => {
  assert.equal(canonical.records.length, 901);
  const context = createAdministrativeBindingContext();
  const bindings = buildAdministrativeBindings(canonical.records, { context });
  assert.equal(bindings.length, canonical.records.length);
  assert.ok(bindings.some((item) => item.administrative.source === 'amap-admin'));
  assert.ok(bindings.some((item) => item.administrative.source === 'record-fallback'));
  for (const item of bindings) {
    assert.deepEqual(Object.keys(item.administrative).sort(), [...ADMINISTRATIVE_FIELDS].sort());
    assert.equal(Object.hasOwn(item.administrative, 'rawCandidates'), false);
    assert.equal(Object.hasOwn(item.administrative, 'address'), false);
  }
});
