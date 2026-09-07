import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { deriveVisibleState } from '../visible-state.mjs';

const publicData = JSON.parse(fs.readFileSync('data/public/cinemas.json', 'utf8'));
const markerLayer = JSON.parse(fs.readFileSync('data/local/public-amap-reviewed-geocodes.json', 'utf8'));
const markerByRow = new Map(markerLayer.records.map((record) => [record.sourceRow, record]));
const cinemas = publicData.records.map((record) => {
  const marker = markerByRow.get(record.sourceRow);
  return marker ? {
    ...record,
    administrative: marker.administrative,
    location: {
      ...record.location,
      provider: 'amap',
      providerLat: marker.providerLat,
      providerLng: marker.providerLng,
      providerCrs: 'GCJ-02',
      mapCrs: 'GCJ-02'
    }
  } : record;
});

test('shared view derivation expands Jiangsu to national from the full cinema state', () => {
  const national = deriveVisibleState({ cinemas, focus: null, lifecycle: 'current' });
  const jiangsu = deriveVisibleState({
    cinemas,
    focus: { level: 'province', provinceName: '江苏', prefectureName: null, countyName: null },
    lifecycle: 'current'
  });
  assert.ok(national.visibleRecords.length > jiangsu.visibleRecords.length);
  assert.equal(national.visibleRecords.length, national.scopedLifecycleRecords.length);
  assert.equal(national.locatedRecords.length, national.visibleRecords.length);
  assert.ok(jiangsu.visibleRecords.every((record) => record.administrative?.provinceName === '江苏'));
});

test('shared view derivation expands Nanjing to all Jiangsu records before rendering', () => {
  const nanjing = deriveVisibleState({
    cinemas,
    focus: { level: 'prefecture', provinceName: '江苏', prefectureName: '南京', countyName: null },
    lifecycle: 'current'
  });
  const jiangsu = deriveVisibleState({
    cinemas,
    focus: { level: 'province', provinceName: '江苏', prefectureName: null, countyName: null },
    lifecycle: 'current'
  });
  assert.ok(jiangsu.visibleRecords.length > nanjing.visibleRecords.length);
  assert.ok(jiangsu.visibleRecords.some((record) => record.administrative?.prefectureName !== '南京'));
  assert.equal(jiangsu.locatedRecords.length, jiangsu.visibleRecords.length);
});
