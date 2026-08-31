import assert from 'node:assert/strict';
import test from 'node:test';

import {
  administrativeDisplayName,
  buildAdministrativeDisplay,
  countSizeClass,
  projectStableCollisionPoint,
  resolveAdminCollisions,
  zoomDisplayMode
} from '../admin-clusters.mjs';

test('zoom display modes follow the administrative-first thresholds', () => {
  assert.equal(zoomDisplayMode(4), 'province');
  assert.equal(zoomDisplayMode(5), 'province');
  assert.equal(zoomDisplayMode(5.01), 'prefecture');
  assert.equal(zoomDisplayMode(7), 'prefecture');
  assert.equal(zoomDisplayMode(7.01), 'county');
  assert.equal(zoomDisplayMode(8.99), 'county');
  assert.equal(zoomDisplayMode(9), 'spread');
  assert.equal(zoomDisplayMode(10), 'spread');
  assert.equal(zoomDisplayMode(10.5), 'cinema-spread');
  assert.equal(zoomDisplayMode(11), 'cinema');
  assert.equal(zoomDisplayMode(18), 'cinema');
});

test('administrative names retain county-level city formal 市 suffix', () => {
  assert.equal(administrativeDisplayName('江苏省', 'province'), '江苏');
  assert.equal(administrativeDisplayName('北京市', 'province'), '北京');
  assert.equal(administrativeDisplayName('广西壮族自治区', 'province'), '广西');
  assert.equal(administrativeDisplayName('昆山', 'county-level-city'), '昆山市');
  assert.equal(administrativeDisplayName('昆山市', 'county-level-city'), '昆山市');
  assert.equal(administrativeDisplayName('梁溪', 'county-level-district'), '梁溪区');
  assert.equal(administrativeDisplayName('浦东新区', 'district'), '浦东新区');
  assert.equal(administrativeDisplayName('五常市', 'district'), '五常市');
  assert.equal(administrativeDisplayName('吉安乡', 'district'), '吉安乡');
  assert.equal(administrativeDisplayName('苏州市', 'prefecture'), '苏州');
  assert.equal(administrativeDisplayName('苏州', 'prefecture'), '苏州');
});

test('count sizes have only four discrete tiers', () => {
  assert.equal(countSizeClass(1), 'small');
  assert.equal(countSizeClass(9), 'small');
  assert.equal(countSizeClass(10), 'medium');
  assert.equal(countSizeClass(29), 'medium');
  assert.equal(countSizeClass(30), 'medium-large');
  assert.equal(countSizeClass(59), 'medium-large');
  assert.equal(countSizeClass(60), 'large');
  assert.equal(countSizeClass(Number.NaN), 'small');
});

test('province mode groups by province and uses a supplied label point', () => {
  const records = [
    cinema('suzhou-1', '江苏', '苏州', 120.60, 31.30, {
      provinceName: '江苏',
      provinceCode: '32',
      prefectureName: '苏州',
      prefectureCode: '3205',
      provinceLabelPoint: [119.50, 32.95]
    }),
    cinema('wuxi-1', '江苏', '无锡', 120.30, 31.57, {
      provinceName: '江苏',
      provinceCode: '32',
      prefectureName: '无锡',
      prefectureCode: '3202',
      provinceLabelPoint: [119.50, 32.95]
    }),
    cinema('guangzhou-1', '广东', '广州', 113.26, 23.13, {
      provinceName: '广东',
      provinceCode: '44',
      prefectureName: '广州',
      prefectureCode: '4401'
    })
  ];

  const items = buildAdministrativeDisplay(records, 4);
  assert.equal(items.length, 2);
  const jiangsu = items.find((item) => item.name === '江苏');
  assert.ok(jiangsu);
  assert.equal(jiangsu.count, 2);
  assert.deepEqual(jiangsu.lnglat, [119.5, 32.95]);
  assert.equal(jiangsu.centerSource, 'label-point');
  assert.equal(jiangsu.level, 'province');
  assert.equal(items.mode, 'province');
});

test('prefecture mode keeps Suzhou and Wuxi separate and folds county cities through explicit parent fields', () => {
  const records = [
    cinema('suzhou-1', '江苏', '苏州', 120.60, 31.30, {
      provinceName: '江苏', provinceCode: '32', prefectureName: '苏州', prefectureCode: '3205'
    }),
    cinema('kunshan-1', '江苏', '昆山', 120.95, 31.38, {
      provinceName: '江苏', provinceCode: '32', prefectureName: '苏州', prefectureCode: '3205',
      prefectureLevel: 'prefecture', countyName: '昆山', countyCode: '320583', countyLevel: 'county-level-city'
    }),
    cinema('wuxi-1', '江苏', '无锡', 120.30, 31.57, {
      provinceName: '江苏', provinceCode: '32', prefectureName: '无锡', prefectureCode: '3202'
    })
  ];

  const items = buildAdministrativeDisplay(records, 6);
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.name === '苏州').count, 2);
  assert.equal(items.find((item) => item.name === '无锡').count, 1);
  assert.equal(items.some((item) => item.name === '昆山市'), false);
  assert.notEqual(items[0].adminKey, items[1].adminKey);
});

test('municipalities and Hong Kong/Macau enter county units directly when bindings exist', () => {
  const records = [
    cinema('shanghai-pudong', '上海', '上海', 121.50, 31.22, {
      provinceName: '上海', provinceCode: '31', prefectureName: '上海', prefectureCode: '3100',
      prefectureLevel: 'municipality', countyName: '浦东', countyCode: '310115', countyLevel: 'district'
    }),
    cinema('shanghai-xuhui', '上海', '上海', 121.44, 31.19, {
      provinceName: '上海', provinceCode: '31', prefectureName: '上海', prefectureCode: '3100',
      prefectureLevel: 'municipality', countyName: '徐汇', countyCode: '310104', countyLevel: 'district'
    }),
    cinema('hk-yuen-long', '香港', '香港', 114.04, 22.44, {
      provinceName: '香港', provinceCode: 'HK', prefectureName: '香港', prefectureLevel: 'special-administrative-region',
      countyName: '元朗', countyCode: 'HK-YL', countyLevel: 'district'
    })
  ];

  const items = buildAdministrativeDisplay(records, 6);
  assert.deepEqual(items.map((item) => item.name).sort(), ['浦东区', '徐汇区', '元朗区'].sort());
  assert.equal(items.every((item) => item.level === 'county'), true);
});

test('administrative keys merge coded and uncoded rows by names at every level', () => {
  const shanghai = [
    cinema('shanghai-coded', '上海', '上海', 121.50, 31.22, {
      provinceName: '上海市', provinceCode: '31', prefectureName: '上海市', prefectureCode: '3100',
      prefectureLevel: 'municipality', countyName: '浦东新区', countyCode: '310115', countyLevel: 'district'
    }),
    cinema('shanghai-uncoded', '上海', '上海', 121.51, 31.23, {
      provinceName: '上海', prefectureName: '上海', prefectureLevel: 'municipality',
      countyName: '浦东', countyLevel: 'district'
    })
  ];

  const shanghaiProvince = buildAdministrativeDisplay(shanghai, 5);
  assert.equal(shanghaiProvince.length, 1);
  assert.equal(shanghaiProvince[0].count, 2);

  const shanghaiPrefecture = buildAdministrativeDisplay(shanghai, 6);
  assert.equal(shanghaiPrefecture.length, 1);
  assert.equal(shanghaiPrefecture[0].name, '浦东新区');
  assert.equal(shanghaiPrefecture[0].count, 2);

  const shanghaiCounty = buildAdministrativeDisplay(shanghai, 8);
  assert.equal(shanghaiCounty.length, 1);
  assert.equal(shanghaiCounty[0].name, '浦东新区');
  assert.equal(shanghaiCounty[0].count, 2);

  const suzhou = [
    cinema('suzhou-coded', '江苏', '苏州', 120.60, 31.30, {
      provinceName: '江苏省', provinceCode: '32', prefectureName: '苏州市', prefectureCode: '3205',
      countyName: '姑苏区', countyCode: '320508', countyLevel: 'district'
    }),
    cinema('suzhou-uncoded', '江苏', '苏州', 120.61, 31.31, {
      provinceName: '江苏', prefectureName: '苏州', countyName: '姑苏', countyLevel: 'district'
    })
  ];
  assert.equal(buildAdministrativeDisplay(suzhou, 5).length, 1);
  assert.equal(buildAdministrativeDisplay(suzhou, 6).length, 1);
  assert.equal(buildAdministrativeDisplay(suzhou, 6)[0].name, '苏州');
  assert.equal(buildAdministrativeDisplay(suzhou, 8).length, 1);
  assert.equal(buildAdministrativeDisplay(suzhou, 8)[0].name, '姑苏区');

  const samePrefectureAndCountyNames = [
    cinema('jiangsu-nanjing', '江苏', '南京', 118.80, 32.06, {
      provinceName: '江苏', prefectureName: '南京', prefectureCode: '3201',
      countyName: '鼓楼区', countyCode: '320106', countyLevel: 'district'
    }),
    cinema('anhui-nanjing', '安徽', '南京', 118.80, 32.06, {
      provinceName: '安徽', prefectureName: '南京', prefectureCode: '3401',
      countyName: '鼓楼区', countyCode: '340102', countyLevel: 'district'
    })
  ];
  assert.equal(buildAdministrativeDisplay(samePrefectureAndCountyNames, 6).length, 2);
  assert.equal(buildAdministrativeDisplay(samePrefectureAndCountyNames, 8).length, 2);
  assert.notEqual(
    buildAdministrativeDisplay(samePrefectureAndCountyNames, 8)[0].adminKey,
    buildAdministrativeDisplay(samePrefectureAndCountyNames, 8)[1].adminKey
  );
});

test('county mode keeps an unbound record individual instead of creating a competing city bubble', () => {
  const records = [
    cinema('wuxi-unknown-district', '江苏', '无锡', 120.30, 31.57, {
      provinceName: '江苏', provinceCode: '32', prefectureName: '无锡', prefectureCode: '3202'
    })
  ];

  const items = buildAdministrativeDisplay(records, 8);
  assert.equal(items.length, 1);
  assert.match(items[0].name, /wuxi-unknown-district/);
  assert.equal(items[0].kind, 'cinema');
  assert.equal(items[0].level, 'cinema');
  assert.equal(items[0].records[0].administrative.countyName, undefined);
});

test('a municipality with no county binding never creates a duplicate municipality bubble', () => {
  const records = [
    cinema('shanghai-unknown-district', '上海', '上海', 121.35, 31.22, {
      provinceName: '上海', prefectureLevel: 'municipality'
    })
  ];

  const items = buildAdministrativeDisplay(records, 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'cinema');
  assert.equal(items.some((item) => item.kind === 'administrative' && item.name === '上海'), false);
});

test('administrative center falls back to a member medoid, never an arithmetic centroid', () => {
  const records = [
    cinema('a', '四川', '成都', 104.00, 30.00, { provinceName: '四川', prefectureName: '成都' }),
    cinema('b', '四川', '成都', 104.10, 30.10, { provinceName: '四川', prefectureName: '成都' }),
    cinema('c', '四川', '成都', 104.20, 30.20, { provinceName: '四川', prefectureName: '成都' })
  ];

  const items = buildAdministrativeDisplay(records, 6);
  assert.deepEqual(items[0].lnglat, [104.1, 30.1]);
  assert.equal(items[0].centerSource, 'medoid');
});

test('administrative visual center is preferred over cinema medoid when supplied', () => {
  const records = [
    cinema('a', '四川', '成都', 104.00, 30.00, {
      provinceName: '四川', prefectureName: '成都', prefectureVisualCenter: [104.07, 30.67]
    }),
    cinema('b', '四川', '成都', 104.20, 30.20, {
      provinceName: '四川', prefectureName: '成都', prefectureVisualCenter: [104.07, 30.67]
    })
  ];

  const items = buildAdministrativeDisplay(records, 6);
  assert.deepEqual(items[0].lnglat, [104.07, 30.67]);
  assert.equal(items[0].centerSource, 'visual-center');
});

test('9-11 progressively releases individual cinemas, then merges only same-site points', () => {
  const records = [
    cinema('same-1', '上海', '上海', 121.5, 31.2, { provinceName: '上海', prefectureName: '上海', countyName: '浦东', countyLevel: 'district' }),
    cinema('same-2', '上海', '上海', 121.5, 31.2, { provinceName: '上海', prefectureName: '上海', countyName: '浦东', countyLevel: 'district' }),
    cinema('nearby-1', '上海', '上海', 121.500001, 31.200001, { provinceName: '上海', prefectureName: '上海', countyName: '浦东', countyLevel: 'district' })
  ];

  assert.equal(buildAdministrativeDisplay(records, 9).length, 1);
  assert.equal(buildAdministrativeDisplay(records, 9)[0].count, 3);
  assert.equal(buildAdministrativeDisplay(records, 10.5).length, 3);
  const highZoom = buildAdministrativeDisplay(records, 11);
  assert.equal(highZoom.length, 2);
  assert.equal(highZoom.find((item) => item.count === 2)?.kind, 'same-site');
});

test('progressive release expands only small county groups and never merges neighboring administrations', () => {
  const records = [
    ...Array.from({ length: 2 }, (_, index) => cinema(`small-${index}`, '江苏', '苏州', 120.6 + index * 0.001, 31.3, {
      provinceName: '江苏', prefectureName: '苏州', countyName: '姑苏', countyLevel: 'district'
    })),
    ...Array.from({ length: 3 }, (_, index) => cinema(`large-a-${index}`, '江苏', '苏州', 120.6, 31.3, {
      provinceName: '江苏', prefectureName: '苏州', countyName: '吴中', countyLevel: 'district'
    })),
    ...Array.from({ length: 3 }, (_, index) => cinema(`large-b-${index}`, '江苏', '无锡', 120.6, 31.3, {
      provinceName: '江苏', prefectureName: '无锡', countyName: '滨湖', countyLevel: 'district'
    }))
  ];

  const zoom9 = buildAdministrativeDisplay(records, 9);
  assert.equal(zoom9.filter((item) => item.kind === 'cinema').length, 2);
  assert.equal(zoom9.filter((item) => item.level === 'county').length, 2);
  assert.equal(new Set(zoom9.filter((item) => item.level === 'county').map((item) => item.adminKey)).size, 2);

  const zoom10 = buildAdministrativeDisplay(records, 10);
  assert.equal(zoom10.filter((item) => item.kind === 'cinema').length, 2);
  assert.equal(zoom10.filter((item) => item.level === 'county').length, 2);

  const six = [...records, cinema('large-c-3', '江苏', '苏州', 120.6, 31.3, {
    provinceName: '江苏', prefectureName: '苏州', countyName: '吴中', countyLevel: 'district'
  }), cinema('large-c-4', '江苏', '苏州', 120.6, 31.3, {
    provinceName: '江苏', prefectureName: '苏州', countyName: '吴中', countyLevel: 'district'
  }), cinema('large-c-5', '江苏', '苏州', 120.6, 31.3, {
    provinceName: '江苏', prefectureName: '苏州', countyName: '吴中', countyLevel: 'district'
  })];
  const zoom10_5 = buildAdministrativeDisplay(six, 10.5);
  assert.equal(zoom10_5.filter((item) => item.kind === 'cinema').length, 5);
  assert.equal(zoom10_5.filter((item) => item.level === 'county').length, 1);
});

test('collision offsets are bounded visual-only values and preserve administrative identity', () => {
  const items = [
    { adminKey: 'province:jiangsu', lnglat: [120, 31], sizeClass: 'small', radiusPx: 8 },
    { adminKey: 'province:zhejiang', lnglat: [120, 31], sizeClass: 'small', radiusPx: 8 },
    { adminKey: 'province:anhui', lnglat: [120, 31], sizeClass: 'small', radiusPx: 8 }
  ];
  const output = resolveAdminCollisions(items, () => ({ x: 100, y: 100 }), { maxOffsetPx: 32 });

  assert.equal(output.length, items.length);
  assert.deepEqual(output.map((item) => item.adminKey), items.map((item) => item.adminKey));
  assert.deepEqual(output.map((item) => item.lnglat), items.map((item) => item.lnglat));
  assert.ok(output.some((item) => item.offset.x !== 0 || item.offset.y !== 0));
  for (const item of output) {
    assert.ok(Math.hypot(item.offset.x, item.offset.y) <= 32.001);
    assert.equal(item.adminKey.startsWith('province:'), true);
    assert.equal(typeof item.collisionFree, 'boolean');
    assert.equal(typeof item.compactRecommended, 'boolean');
  }
});

test('province collision offsets stay fixed throughout the province zoom band', () => {
  const items = [
    { adminKey: 'province:guangdong', lnglat: [113.27, 23.13], count: 117, sizeClass: 'large' },
    { adminKey: 'province:hong-kong', lnglat: [114.17, 22.32], count: 4, sizeClass: 'small' },
    { adminKey: 'province:macau', lnglat: [113.55, 22.20], count: 1, sizeClass: 'small' }
  ];
  const layout = () => resolveAdminCollisions(
    items,
    (lnglat) => projectStableCollisionPoint(lnglat, 'province'),
    { maxOffsetPx: 32, stepPx: 8, paddingPx: 4 }
  );
  const atZoom4 = layout();
  const atZoom5 = layout();

  assert.deepEqual(
    atZoom4.map(({ adminKey, offsetX, offsetY }) => ({ adminKey, offsetX, offsetY })),
    atZoom5.map(({ adminKey, offsetX, offsetY }) => ({ adminKey, offsetX, offsetY }))
  );
  assert.ok(atZoom4.every((item) => Number.isFinite(item.offsetX) && Number.isFinite(item.offsetY)));
});

test('large administrative nodes are placed first while returned order remains stable', () => {
  const items = [
    { adminKey: 'small', count: 1, lnglat: [120, 31], radiusPx: 8 },
    { adminKey: 'large', count: 99, lnglat: [120, 31], radiusPx: 8 }
  ];
  const output = resolveAdminCollisions(items, () => ({ x: 0, y: 0 }), { maxOffsetPx: 0 });
  assert.deepEqual(output.map((item) => item.adminKey), ['small', 'large']);
  assert.equal(output[0].collisionFree, false);
  assert.equal(output[0].compactRecommended, true);
  assert.equal(output[1].collisionFree, true);
});

function cinema(id, province, city, lng, lat, administrative) {
  return {
    id,
    name: `${city}${id}`,
    province,
    city,
    location: {
      providerLng: lng,
      providerLat: lat,
      providerCrs: 'GCJ-02'
    },
    administrative
  };
}
