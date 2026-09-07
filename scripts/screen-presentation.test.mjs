import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScreenPresentation } from '../screen-presentation.mjs';

const record = (values, extra = {}) => ({ screen: { rawWidth: values[0] ?? '', rawHeight: values[1] ?? '', rawArea: values[2] ?? '', ...(extra.screen ?? {}) }, seatsRaw: values[3] ?? '', ...(extra.record ?? {}) });

test('direct, multiple, review override, unequal counts, missing and invalid', () => {
  assert.equal(resolveScreenPresentation(record(['20', '10', '200', '300'])).status, 'direct');
  const multiple = resolveScreenPresentation(record(['20\n21', '10\n11', '200\n231', '300\n310']));
  assert.equal(multiple.status, 'multiple');
  assert.equal(multiple.alternatives.length, 1);
  assert.equal(multiple.selected.width, 20);
  assert.equal(resolveScreenPresentation(record(['20\n21', '10\n11', '200\n231', '300\n310'], { screen: { width: 21, height: 11, area: 231 }, record: { screenSeatReview: { confidence: 'high', materializedFields: ['width', 'height', 'area', 'seats'] }, seats: 310 } })).status, 'reviewed');
  const unequal = resolveScreenPresentation(record(['20\n21', '10', '200', '300']));
  assert.equal(unequal.configurations.length, 2);
  assert.equal(unequal.configurations[1].fields.seats.state, 'missing');
  assert.equal(resolveScreenPresentation(record(['', '', '', ''])).status, 'missing');
  assert.equal(resolveScreenPresentation(record(['?（约20）', '说明', '+3', '3 + 2'])).status, 'invalid');
  assert.equal(resolveScreenPresentation(record(['20平方米', '', '', '1'])).configurations[0].fields.width.state, 'invalid');
  assert.equal(resolveScreenPresentation(record(['20', '', '200米', '1'])).configurations[0].fields.area.state, 'invalid');
});

test('selected area stays same source row and resolution is deterministic', () => {
  const input = record(['20\n21', '10\n11', '200\n231', '300\n310']);
  const first = resolveScreenPresentation(input);
  const second = resolveScreenPresentation(input);
  assert.deepEqual(first, second);
  assert.equal(first.selected.area, first.selected.width * 10);
  assert.equal(first.selected.sourceIndex, 0);
});

test('real reviewed regressions select source index 0 and 2', async () => {
  const fs = await import('node:fs');
  const data = JSON.parse(fs.readFileSync(new URL('../data/derived/cinemas.json', import.meta.url), 'utf8'));
  const one = data.records.find((item) => item.id === 'imax-cn-0019');
  const two = data.records.find((item) => item.id === 'imax-cn-0048');
  const ordinary = data.records.find((item) => item.id === 'imax-cn-0002');
  const partial = data.records.find((item) => item.id === 'imax-cn-0414');
  const malformed = data.records.find((item) => item.id === 'imax-cn-0051');
  assert.equal(resolveScreenPresentation(one).status, 'reviewed');
  assert.equal(resolveScreenPresentation(one).selected.sourceIndex, 0);
  assert.equal(resolveScreenPresentation(two).status, 'reviewed');
  assert.equal(resolveScreenPresentation(two).selected.sourceIndex, 2);
  assert.equal(resolveScreenPresentation(ordinary).status, 'multiple');
  assert.equal(resolveScreenPresentation(ordinary).selected.width, 20.14);
  assert.equal(resolveScreenPresentation(ordinary).alternatives.length, 1);
  assert.equal(resolveScreenPresentation(partial).selected.sourceIndex, 1);
  assert.equal(resolveScreenPresentation(partial).selectedIndex, 1);
  assert.equal(resolveScreenPresentation(partial).selected.fields.seats.state, 'missing');
  assert.equal(resolveScreenPresentation(malformed).selected.fields.height.state, 'invalid');
  assert.equal(resolveScreenPresentation(malformed).status, 'direct');
});
