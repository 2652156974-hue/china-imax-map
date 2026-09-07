import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCanonicalDisplay } from './canonical-display-diagnostic.mjs';

test('canonical display diagnostic separates reviewed, direct, unresolved, and missing states', () => {
  const records = [
    { screen: { width: 28, rawWidth: '28 / 26', selectionConfidence: 'high' }, seats: 426, seatsRaw: '453\n445\n426', screenSeatReview: { confidence: 'high', materializedFields: ['width', 'seats'] } },
    { screen: { width: 22, rawWidth: '22', selectionConfidence: 'high' }, seats: null, seatsRaw: '' },
    { screen: { width: null, rawWidth: '28 / 26', selectionConfidence: 'unknown' }, seats: 100, seatsRaw: '100' }
  ];
  const before = summarizeCanonicalDisplay(records, { before: true });
  const after = summarizeCanonicalDisplay(records);
  assert.equal(before.fields.width.reviewedButCurrentlyShownPending, 1);
  assert.equal(before.fields.seats.reviewedButCurrentlyShownPending, 1);
  assert.deepEqual(after.fields.width, { displayedCanonicalReviewed: 1, displayedCanonicalDirect: 1, unresolved: 1, missing: 0 });
  assert.deepEqual(after.fields.seats, { displayedCanonicalReviewed: 1, displayedCanonicalDirect: 1, unresolved: 0, missing: 1 });
});
