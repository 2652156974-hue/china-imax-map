import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyFocusScope,
  effectiveDisplayZoom,
  focusScopeFromItem,
  focusTargetZoom,
  matchesFocusScope,
  navigationTargetZoom
} from '../focus-navigation.mjs';
import { zoomDisplayMode } from '../admin-clusters.mjs';

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)));
const publicDataset = JSON.parse(await readFile(join(repoRoot, 'data', 'public', 'cinemas.json'), 'utf8'));

const records = [
  { id: 'nj', province: '江苏', city: '南京', administrative: { provinceName: '江苏', prefectureName: '南京', countyName: '建邺区' } },
  { id: 'suzhou', province: '江苏', city: '苏州', administrative: { provinceName: '江苏', prefectureName: '苏州', countyName: '姑苏区' } },
  { id: 'kunshan', province: '江苏', city: '昆山', administrative: { provinceName: '江苏', prefectureName: '苏州', countyName: '昆山市' } },
  { id: 'shanghai', province: '上海', city: '上海', administrative: { provinceName: '上海', countyName: '浦东新区' } }
];

test('focus scope extracts hierarchy and falls back to public province/city fields', () => {
  const county = focusScopeFromItem({
    kind: 'administrative',
    level: 'county',
    name: '昆山市',
    records: [records[2]]
  });
  const provinceFallback = focusScopeFromItem({
    kind: 'administrative',
    level: 'province',
    name: '江苏',
    records: [{ province: '江苏', city: '南京', administrative: null }]
  });

  assert.deepEqual(county, {
    level: 'county',
    provinceName: '江苏',
    prefectureName: '苏州',
    countyName: '昆山市'
  });
  assert.deepEqual(provinceFallback, {
    level: 'province',
    provinceName: '江苏',
    prefectureName: null,
    countyName: null
  });
});

test('focus scope filters records by province, prefecture, and county without spatial inference', () => {
  const province = focusScopeFromItem({ level: 'province', records: [records[0]] });
  const prefecture = focusScopeFromItem({ level: 'prefecture', records: [records[1]] });
  const county = focusScopeFromItem({ level: 'county', records: [records[2]] });

  assert.deepEqual(applyFocusScope(records, province).map((record) => record.id), ['nj', 'suzhou', 'kunshan']);
  assert.deepEqual(applyFocusScope(records, prefecture).map((record) => record.id), ['suzhou', 'kunshan']);
  assert.deepEqual(applyFocusScope(records, county).map((record) => record.id), ['kunshan']);
  assert.equal(matchesFocusScope(records[3], province), false);
  assert.equal(applyFocusScope(records, null), records);
});

test('production public facts scope Jiangsu to its 103 records and exclude every other province', () => {
  const scoped = applyFocusScope(publicDataset.records, {
    level: 'province',
    provinceName: '江苏',
    prefectureName: null,
    countyName: null
  });

  assert.equal(publicDataset.records.length, 901);
  assert.equal(scoped.length, 103);
  assert.equal(scoped.every((record) => record.province === '江苏'), true);
  assert.equal(scoped.some((record) => record.province === '广东'), false);
});

test('focus scope normalizes names and keeps the selected child layer open', () => {
  const focus = { level: 'prefecture', provinceName: ' 江苏 ', prefectureName: '苏 州', countyName: null };
  assert.equal(matchesFocusScope(records[1], focus), true);
  assert.equal(focusTargetZoom('province'), 6.25);
  assert.equal(focusTargetZoom('prefecture'), 8.25);
  assert.equal(focusTargetZoom('county'), 11.2);
  assert.equal(effectiveDisplayZoom(4, { level: 'province' }), 6.01);
  assert.equal(effectiveDisplayZoom(6.5, { level: 'prefecture' }), 8.01);
  assert.equal(effectiveDisplayZoom(15, { level: 'county' }), 15);
  assert.equal(effectiveDisplayZoom(4, null), 4);
});

test('navigation target zoom selects the target LOD instead of stale map zoom', () => {
  const previousZoom = 8.25;
  const nationalTarget = navigationTargetZoom(null);
  assert.equal(nationalTarget, 4);
  assert.equal(zoomDisplayMode(nationalTarget), 'province');
  assert.notEqual(zoomDisplayMode(previousZoom), zoomDisplayMode(nationalTarget));

  const provinceTarget = navigationTargetZoom({ level: 'province' });
  assert.equal(provinceTarget, 6.25);
  assert.equal(zoomDisplayMode(provinceTarget), 'prefecture');
  assert.equal(zoomDisplayMode(navigationTargetZoom({ level: 'prefecture' })), 'county');
});
