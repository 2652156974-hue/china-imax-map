import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createNavigationRenderHarness } from './navigation-render-harness.mjs';
import { cinemaLifecycle } from '../cinema-lifecycle.mjs';
import { displayRenderSignature } from '../render-signature.mjs';
import { markerClickTarget, markerRenderDescriptor } from '../marker-render-descriptor.mjs';
import { buildAdministrativeDisplay } from '../admin-clusters.mjs';

const publicData = JSON.parse(fs.readFileSync('data/public/cinemas.json', 'utf8'));
const markerLayer = JSON.parse(fs.readFileSync('data/local/public-amap-reviewed-geocodes.json', 'utf8'));
const markerByRow = new Map(markerLayer.records.map((record) => [record.sourceRow, record]));
const records = publicData.records.map((record) => {
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

const provinceJiangsu = { level: 'province', provinceName: '江苏', prefectureName: null, countyName: null };
const prefectureYangzhou = { level: 'prefecture', provinceName: '江苏', prefectureName: '扬州', countyName: null };
const prefectureNanjing = { level: 'prefecture', provinceName: '江苏', prefectureName: '南京', countyName: null };
const currentNationalCount = records.filter((record) => cinemaLifecycle(record) === 'current').length;
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
  const adminBase = { kind: 'administrative', level: 'province', name: 'A', count: 1, lnglat: [1, 2], records: [{ id: 'a', sourceRow: 1, name: 'A', province: '江苏' }] };
  assert.notEqual(
    displayRenderSignature({ lifecycle: 'current', mode: 'province', items: [adminBase] }),
    displayRenderSignature({ lifecycle: 'current', mode: 'province', items: [{ ...adminBase, administrative: { provinceName: '浙江' } }] })
  );
});

test('national signature is compact and excludes raw/full record payloads', () => {
  const items = buildAdministrativeDisplay(records, 4);
  const signature = displayRenderSignature({ lifecycle: 'current', mode: 'province', items });
  assert.ok(signature.length < 100_000);
  assert.doesNotMatch(signature, /rawWidth|providerLat|"projection"/);
  assert.equal(Object.hasOwn(markerRenderDescriptor(items[0]), 'markerInput'), false);
  assert.equal(Object.hasOwn(markerRenderDescriptor(items[0]), 'firstRecord'), false);
});

test('shared click target follows the new same-coordinate record and lifecycle changes identity', () => {
  const first = records.find((record) => record.id === 'imax-cn-0294');
  const next = records.find((record) => record.id === 'imax-cn-0809');
  const firstItem = buildAdministrativeDisplay([first], 11)[0];
  const nextItem = buildAdministrativeDisplay([next], 11)[0];
  assert.equal(markerClickTarget(firstItem).recordId, 'imax-cn-0294');
  assert.equal(markerClickTarget(nextItem).recordId, 'imax-cn-0809');
  assert.notEqual(
    displayRenderSignature({ lifecycle: 'current', mode: 'cinema', items: [nextItem] }),
    displayRenderSignature({ lifecycle: 'history', mode: 'cinema', items: [nextItem] })
  );
});

test('current to history is a marker rebuild, not a skipped render', () => {
  const current = records.find((record) => cinemaLifecycle(record) === 'current');
  const history = records.find((record) => cinemaLifecycle(record) === 'history');
  const harness = createNavigationRenderHarness([current, history], { lifecycle: 'current' });
  const now = harness.render({ requestedZoom: 11 });
  harness.setLifecycle('history');
  const former = harness.render({ requestedZoom: 11 });
  assert.equal(now.skipped, false);
  assert.equal(former.skipped, false);
  assert.equal(former.removedCount, 1);
  assert.equal(former.createdCount, 1);
});

test('navigation harness uses target LOD and skips identical zoomend without marker churn', () => {
  const harness = createNavigationRenderHarness(records);
  const national = harness.navigateTo(null);
  assert.equal(national.first.focus, null);
  assert.equal(national.first.visibleRecordCount, currentNationalCount);
  assert.equal(national.first.inputRecordCount, currentNationalCount);
  assert.equal(national.first.mode, 'province');
  assert.equal(national.first.source, 'navigation');
  assert.equal(national.zoomend.source, 'zoomend');
  assert.equal(national.first.effectiveZoom, 4);
  assert.equal(national.zoomend.skipped, true);
  assert.equal(national.zoomend.removedCount + national.zoomend.createdCount, 0);
  assert.equal(harness.transitions.at(-1).zoom, 4);

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

  harness.navigateTo(prefectureNanjing);
  const nanjingBackToJiangsu = harness.navigateTo(provinceJiangsu);
  assert.equal(nanjingBackToJiangsu.first.focus.provinceName, '江苏');
  assert.equal(nanjingBackToJiangsu.first.focus.prefectureName, null);
  assert.equal(nanjingBackToJiangsu.first.visibleRecordCount, currentJiangsuCount);
  assert.equal(nanjingBackToJiangsu.first.inputRecordCount, currentJiangsuCount);
  assert.equal(nanjingBackToJiangsu.first.mode, 'prefecture');
});

test('stale zoom 8.25 cannot force the first national render above province mode', () => {
  const harness = createNavigationRenderHarness(records, { mapZoom: 8.25 });
  const national = harness.navigateTo(null);
  assert.equal(national.first.effectiveZoom, 4);
  assert.equal(national.first.mode, 'province');
  assert.equal(national.first.mode === 'spread' || national.first.mode === 'cinema', false);
});
