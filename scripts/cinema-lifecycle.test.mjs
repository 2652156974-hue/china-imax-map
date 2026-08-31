import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cinemaLifecycle,
  lifecycleCounts,
  lifecycleRelationshipScore,
  relatedLifecycleRecords,
  simplifyLifecycleName
} from '../cinema-lifecycle.mjs';

const currentHanStreet = cinema({
  id: 'imax-cn-0380',
  sourceRow: 380,
  name: '武汉万达影城（汉街万达广场IMAX激光店）',
  reviewVerdict: 'accept-exact',
  status: 'unknown',
  lat: 30.558669,
  lng: 114.332135
});

const formerHanStreet = cinema({
  id: 'imax-cn-0825',
  sourceRow: 825,
  name: '武汉万达影城（汉街万达广场店） 原有商业综合体拆除',
  reviewVerdict: 'accept-historical-location',
  status: 'unknown',
  lat: 30.558907,
  lng: 114.332275
});

test('current and historical records are separated without rewriting source status', () => {
  assert.equal(cinemaLifecycle(currentHanStreet), 'current');
  assert.equal(cinemaLifecycle(formerHanStreet), 'history');
  assert.deepEqual(lifecycleCounts([currentHanStreet, formerHanStreet]), { current: 1, history: 1 });
  assert.equal(formerHanStreet.status, 'unknown');
});

test('Han Street current cinema and demolished predecessor form one two-option history group', () => {
  const unrelated = cinema({
    id: 'other',
    sourceRow: 999,
    name: '武汉其他历史影城 已拆除',
    reviewVerdict: 'accept-historical-location',
    lat: 30.60,
    lng: 114.40
  });
  const related = relatedLifecycleRecords(currentHanStreet, [unrelated, formerHanStreet, currentHanStreet]);

  assert.deepEqual(related.map((record) => record.id), ['imax-cn-0380', 'imax-cn-0825']);
  assert.ok(lifecycleRelationshipScore(currentHanStreet, formerHanStreet) > 0);
  assert.equal(lifecycleRelationshipScore(currentHanStreet, unrelated), 0);
});

test('technology and demolition suffixes do not prevent a venue-name match', () => {
  assert.equal(
    simplifyLifecycleName('武汉万达影城（汉街万达广场IMAX激光店）'),
    simplifyLifecycleName('武汉万达影城（汉街万达广场店） 原有商业综合体拆除')
  );
});

test('a permanent closure is historical even when no review verdict is present', () => {
  assert.equal(cinemaLifecycle({ name: '测试影院', status: 'closed' }), 'history');
  assert.equal(cinemaLifecycle({ name: '测试影院', status: 'temporarily_closed' }), 'current');
});

function cinema({ id, sourceRow, name, reviewVerdict, status = 'unknown', lat, lng }) {
  return {
    id,
    sourceRow,
    name,
    city: '武汉',
    province: '湖北',
    status,
    reviewVerdict,
    location: {
      providerLat: lat,
      providerLng: lng,
      providerCrs: 'GCJ-02',
      reviewVerdict
    }
  };
}
