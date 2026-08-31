import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createNavigationRenderHarness } from './navigation-render-harness.mjs';
import { cinemaLifecycle } from '../cinema-lifecycle.mjs';
import { displayRenderSignature } from '../render-signature.mjs';

const publicData = JSON.parse(fs.readFileSync('data/public/cinemas.json', 'utf8'));
const markerLayer = JSON.parse(fs.readFileSync('data/local/public-amap-reviewed-geocodes.json', 'utf8'));
const markerByRow = new Map(markerLayer.records.map((record) => [record.sourceRow, record]));
const records = publicData.records.map((record) => {
  const marker = markerByRow.get(record.sourceRow);
  return marker ? {
    ...record,
    administrative: marker.administrative,
    location: { ...record.location, providerLat: marker.providerLat, providerLng: marker.providerLng, providerCrs: 'GCJ-02' }
  } : record;
});

const provinceJiangsu = { level: 'province', provinceName: '江苏', prefectureName: null, countyName: null };
const prefectureYangzhou = { level: 'prefecture', provinceName: '江苏', prefectureName: '扬州', countyName: null };
const currentJiangsuCount = records.filter((record) => record.administrative?.provinceName === '江苏' && cinemaLifecycle(record) === 'current').length;

test('same-coordinate 0294 to 0809 changes signature, rebuilds marker, and clicks the new record', () => {
  const firstRecord = records.find((record) => record.id === 'imax-cn-0294');
  const nextRecord = records.find((record) => record.id === 'imax-cn-0809');
  assert.deepEqual(
    [firstRecord.location.providerLng, firstRecord.location.providerLat],
    [nextRecord.location.providerLng, nextRecord.location.providerLat]
  );
  const harness = createNavigationRenderHarness([firstRecord]);
  const first = harness.render({ requestedZoom: 11 });
  harness.setRecords([nextRecord]);
  const next = harness.render({ requestedZoom: 11 });
  assert.equal(first.skipped, false);
  assert.equal(next.skipped, false);
  assert.equal(next.removedCount, 1);
  assert.equal(next.createdCount, 1);
  assert.equal(harness.click(), 'imax-cn-0809');
});

test('member order or lifecycle changes invalidate the render signature; identical input skips with zero churn', () => {
  const a = records.find((record) => record.id === 'imax-cn-0294');
  const b = records.find((record) => record.id === 'imax-cn-0809');
  const harness = createNavigationRenderHarness([a, b], { lifecycle: 'current' });
  const initial = harness.render({ requestedZoom: 11 });
  const identical = harness.render({ requestedZoom: 11 });
  assert.equal(initial.skipped, false);
  assert.equal(identical.skipped, true);
  assert.equal(identical.removedCount + identical.createdCount, 0);
  harness.setRecords([b, a]);
  assert.equal(harness.render({ requestedZoom: 11 }).skipped, false);
  const lifecycleHarness = createNavigationRenderHarness([a], { lifecycle: 'current' });
  lifecycleHarness.render({ requestedZoom: 11 });
  const historyHarness = createNavigationRenderHarness([a], { lifecycle: 'history' });
  assert.equal(historyHarness.render({ requestedZoom: 11 }).skipped, false);
});

test('marker HTML and placement inputs are part of the display signature', () => {
  const base = {
    lifecycle: 'current',
    mode: 'cinema',
    items: [{
      kind: 'cinema', name: 'A', count: 1, lnglat: [1, 2], offsetX: 0, offsetY: 0,
      records: [{ id: 'a', sourceRow: 1, name: 'A', projection: { system: 'Xenon' } }]
    }]
  };
  const same = displayRenderSignature(base);
  assert.notEqual(same, displayRenderSignature({ ...base, items: [{ ...base.items[0], name: 'B' }] }));
  assert.notEqual(same, displayRenderSignature({ ...base, items: [{ ...base.items[0], offsetX: 8 }] }));
  assert.notEqual(same, displayRenderSignature({ ...base, items: [{ ...base.items[0], records: [{ ...base.items[0].records[0], projection: { system: 'GT Laser' } }] }] }));
  assert.notEqual(same, displayRenderSignature({ ...base, items: [{ ...base.items[0], administrative: { provinceName: '江苏' } }] }));
});

test('navigation harness uses target LOD and skips identical zoomend without marker churn', () => {
  const harness = createNavigationRenderHarness(records);
  const national = harness.navigateTo(null);
  assert.equal(national.first.mode, 'province');
  assert.equal(national.first.effectiveZoom, 4);
  assert.equal(national.zoomend.skipped, true);
  assert.equal(national.zoomend.removedCount + national.zoomend.createdCount, 0);

  const jiangsu = harness.navigateTo(provinceJiangsu);
  assert.equal(jiangsu.first.mode, 'prefecture');
  assert.equal(jiangsu.first.inputRecordCount, currentJiangsuCount);
  assert.equal(jiangsu.zoomend.skipped, true);

  const yangzhou = harness.navigateTo(prefectureYangzhou);
  assert.equal(yangzhou.first.mode, 'county');
  assert.equal(yangzhou.first.inputRecordCount > 0, true);

  const backToJiangsu = harness.navigateTo(provinceJiangsu);
  assert.equal(backToJiangsu.first.mode, 'prefecture');
  assert.equal(backToJiangsu.first.inputRecordCount, currentJiangsuCount);
  assert.notEqual(backToJiangsu.first.mode, 'spread');
  assert.notEqual(backToJiangsu.first.mode, 'cinema');
});

test('stale zoom 8.25 cannot force the first national render above province mode', () => {
  const harness = createNavigationRenderHarness(records, { mapZoom: 8.25 });
  const national = harness.navigateTo(null);
  assert.equal(national.first.effectiveZoom, 4);
  assert.equal(national.first.mode, 'province');
  assert.equal(national.first.mode === 'spread' || national.first.mode === 'cinema', false);
});
