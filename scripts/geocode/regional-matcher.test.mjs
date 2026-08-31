import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseRegionalCandidate, scoreRegionalCandidate, regionalCityAliases } from './regional-matcher.mjs';

const taipeiRecord = {
  name: '台北美麗華大直影城',
  city: '台北',
  province: '台湾',
  region: '台湾',
  projection: { system: 'GT Laser', dome: false }
};

test('regional city aliases recognize Chinese and English city names', () => {
  assert.ok(regionalCityAliases('台北').includes('taipei'));
  assert.ok(regionalCityAliases('香港').includes('hong kong'));
  assert.ok(regionalCityAliases('澳门').includes('macau'));
});

test('exact regional cinema requires city, cinema type and strong identity', () => {
  const result = chooseRegionalCandidate(taipeiRecord, [{
    name: '美麗華大直影城',
    display_name: '美麗華大直影城, 中山區, Taipei City, Taiwan',
    type: 'cinema',
    class: 'amenity',
    lat: '25.083',
    lon: '121.557',
    osm_type: 'node',
    osm_id: 123
  }]);
  assert.equal(result.decision, 'accepted-high');
  assert.equal(result.selected.positionType, 'cinema-poi');
  assert.equal(result.selected.locationGranularity, 'cinema');
  assert.equal(result.selected.identityConfidence, 'high');
  assert.equal(result.selected.map.mapCrs, 'WGS84');
  assert.equal(result.selected.map.lat, 25.083);
});

test('institution venue remains location-only and identity-medium', () => {
  const record = {
    name: '香港香港太空館',
    city: '香港',
    province: '香港',
    region: '香港',
    projection: { system: 'Xenon', dome: true }
  };
  const result = chooseRegionalCandidate(record, [{
    name: '香港太空館',
    display_name: '香港太空館, 香港',
    type: 'museum',
    class: 'tourism',
    lat: '22.294',
    lon: '114.171',
    osm_type: 'way',
    osm_id: 456
  }]);
  assert.equal(result.decision, 'review-required-medium');
  assert.equal(result.selected.positionType, 'venue-poi');
  assert.equal(result.selected.locationGranularity, 'venue');
  assert.equal(result.selected.identityConfidence, 'medium');
});

test('non-target business and wrong city are rejected', () => {
  const restaurant = scoreRegionalCandidate(taipeiRecord, {
    name: '美麗華餐廳',
    display_name: '美麗華餐廳, Taipei City, Taiwan',
    type: 'restaurant',
    class: 'amenity',
    lat: '25.083',
    lon: '121.557',
    osm_type: 'node',
    osm_id: 789
  });
  assert.ok(restaurant.hardRejects.includes('non-target-poi-type'));

  const wrongCity = scoreRegionalCandidate(taipeiRecord, {
    name: '美麗華大直影城',
    display_name: '美麗華大直影城, Kaohsiung, Taiwan',
    type: 'cinema',
    class: 'amenity',
    lat: '22.627',
    lon: '120.301',
    osm_type: 'node',
    osm_id: 790
  });
  assert.ok(wrongCity.hardRejects.includes('city-mismatch'));
});

test('two valid close candidates are not auto-promoted to exact high', () => {
  const candidates = [
    {
      name: '美麗華大直影城',
      display_name: '美麗華大直影城, Taipei City, Taiwan',
      type: 'cinema',
      class: 'amenity',
      lat: '25.083',
      lon: '121.557',
      osm_type: 'node',
      osm_id: 801
    },
    {
      name: '美麗華影城大直店',
      display_name: '美麗華影城大直店, Taipei City, Taiwan',
      type: 'cinema',
      class: 'amenity',
      lat: '25.084',
      lon: '121.558',
      osm_type: 'node',
      osm_id: 802
    }
  ];
  const result = chooseRegionalCandidate(taipeiRecord, candidates);
  assert.equal(result.trueAmbiguity, true);
  assert.equal(result.decision, 'review-required-medium');
});
