import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCoordinateSource, formatLocationInfo } from '../public-location-format.mjs';

test('location detail formatter combines complete source fields into one readable line', () => {
  const cinema = {
    status: 'unknown',
    location: {
      locationGranularity: 'cinema',
      locationConfidence: 'high',
      identityConfidence: 'high',
      provider: 'amap',
      providerCrs: 'GCJ-02',
      positionType: 'cinema-poi'
    }
  };
  assert.equal(
    formatLocationInfo(cinema, { hasCoordinate: true }),
    '待核 · 影院级 · 位置/身份 高/高 · 高德影院 POI（GCJ-02）'
  );
});

test('location detail formatter omits empty fragments without dangling separators', () => {
  const value = formatLocationInfo({
    status: 'open',
    location: { locationGranularity: 'cinema', locationConfidence: 'high' }
  }, { hasCoordinate: true });
  assert.equal(value, '营业 · 影院级 · 位置/身份 高');
  assert.doesNotMatch(value, /undefined|null|··|\/$/);
});

test('location detail formatter uses a single safe fallback when all source fields are empty', () => {
  const value = formatLocationInfo({ status: null, location: {} }, { hasCoordinate: false });
  assert.equal(value, '暂无');
  assert.doesNotMatch(value, /undefined|null|··|\/$/);
});

test('location detail formatter normalizes existing AMap variants and unlocated records', () => {
  assert.equal(
    formatCoordinateSource({ provider: '高德地图', providerCrs: 'gcj 02', positionType: '影院 POI' }, true),
    '高德影院 POI（GCJ-02）'
  );
  assert.equal(
    formatLocationInfo({
      status: 'open',
      location: {
        locationGranularity: 'venue',
        locationConfidence: 'medium',
        identityConfidence: 'unknown',
        provider: 'amap',
        providerCrs: 'GCJ-02',
        positionType: 'venue-poi'
      }
    }, { hasCoordinate: false }),
    '营业 · 场馆级 · 位置/身份 中/待核 · 未定位'
  );
});
