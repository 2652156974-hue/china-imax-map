import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditoriumFormatCompatibility, chooseCandidate, classifyPoi, scoreCandidate } from './scoring.mjs';
import { amapCoordinate } from './crs.mjs';
import { buildQueries, extractExplicitFormerNames, stripExplicitHistorySegments } from './query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function record(overrides = {}) {
  return {
    sourceRow: 1,
    name: '深圳万达影城（龙岗万达广场店）',
    nameRaw: '深圳万达影城（龙岗万达广场店）',
    formerNames: [],
    city: '深圳',
    province: '广东',
    projection: { raw: 'IMAX Commercial Laser', system: 'Commercial Laser', technology: 'Laser' },
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    id: 'valid',
    name: '万达影城(龙岗万达广场店)',
    type: '体育休闲服务;影剧院;电影院',
    typecode: '080601',
    cityname: '深圳市',
    pname: '广东省',
    adname: '龙岗区',
    address: '深圳龙岗万达广场6层',
    location: '114.130825,22.673271',
    ...overrides
  };
}

test('non-applicable evidence is excluded and an exact candidate can reach high', () => {
  const scored = scoreCandidate(record(), candidate({ address: '华南二道1号' }));
  assert.equal(scored.components.district.applicable, false);
  assert.equal(scored.components.addressCity.applicable, false);
  assert.equal(scored.decision, 'accepted-high');
  assert.ok(scored.score >= 0.9);
});

test('hard-rejected candidates cannot create ambiguity', () => {
  const result = chooseCandidate(record(), [
    candidate(),
    candidate({ id: 'nine-d', name: '飞越中国·裸眼9D球幕悬空飞行影院(龙岗万达店)', location: '114.131238,22.673214' })
  ]);
  assert.equal(result.selected.poiId, 'valid');
  assert.equal(result.selected.decision, 'accepted-high');
  assert.equal(result.ambiguity.trueAmbiguity, false);
  assert.ok(result.ranked.find((item) => item.poiId === 'nine-d').hardRejects.includes('non-target-business-name'));
});

test('AMap typecode is authoritative for cinema classification', () => {
  const food = candidate({ id: 'food', name: 'NANA蛋包饭(西湖文化广场浙影时代影城店)', type: '餐饮服务;快餐厅;快餐厅', typecode: '050300' });
  assert.equal(classifyPoi(record(), food), 'other');
  assert.ok(scoreCandidate(record(), food).hardRejects.includes('non-cinema-poi'));
  assert.equal(classifyPoi(record(), candidate({ typecode: '080601|060000' })), 'cinema');
});

test('mall fallback requires the candidate itself to have an allowed mall typecode', () => {
  const target = record({ name: '贵阳星美国际影城（花果园店）', city: '贵阳', province: '贵州' });
  const merchants = [
    ['Manner Coffee(花果园店)', '050500'], ['北京同仁堂(花果园店)', '090601'], ['美车堂(花果园店)', '070100'],
    ['花果园餐厅', '050100'], ['花果园停车场', '150904'], ['花果园服装店', '061100'], ['花果园游戏厅', '080305']
  ];
  for (const [name, typecode] of merchants) {
    const poi = candidate({ name, typecode, type: '非商场商户', cityname: '贵阳市', pname: '贵州省', address: '花果园购物中心内' });
    assert.equal(classifyPoi(target, poi), 'other', name);
  }
  const mall = candidate({ name: '花果园购物中心', typecode: '060101', type: '购物服务;商场;购物中心', cityname: '贵阳市', pname: '贵州省', address: '花果园' });
  const scored = scoreCandidate(target, mall);
  assert.equal(scored.positionType, 'mall-fallback');
  assert.equal(scored.hardRejects.length, 0);
  assert.equal(scored.decision, 'review-required-medium');
});

test('ordinary place names containing 原 are never parsed as former names', () => {
  for (const name of ['包头万达影城（九原万达广场店）', '太原万达影城', '原平电影院', '中原影城', '平原电影院']) {
    assert.deepEqual(extractExplicitFormerNames(name), [], name);
    assert.equal(stripExplicitHistorySegments(name), name, name);
  }
  const explicit = '当前影院（原旧影院）\n曾用名：更旧影院\n- 原最旧影院';
  assert.deepEqual(extractExplicitFormerNames(explicit), ['旧影院', '最旧影院', '更旧影院']);
  assert.deepEqual(extractExplicitFormerNames('原旧影院'), ['旧影院']);
  assert.ok(!stripExplicitHistorySegments(explicit).includes('旧影院'));
  assert.equal(buildQueries(record({ name: '包头万达影城（九原万达广场店)', nameRaw: '包头万达影城（九原万达广场店)', city: '包头' })).some((item) => item.query === '包头万达影城（九 包头'), false);
});

test('institution IMAX can select a qualified cinema or venue, but not a 4D substitute', () => {
  const museum = record({ name: '北京中国电影博物馆', city: '北京', province: '北京', projection: { raw: 'IMAX Laser GT 3D', system: 'GT Laser' } });
  const gt = candidate({ name: '中国电影博物馆-IMAX GT巨幕影厅', cityname: '北京市', pname: '北京市', address: '南影路5号', location: '116.520564,39.995864' });
  const exactGt = scoreCandidate(museum, gt);
  assert.equal(exactGt.decision, 'accepted-high');
  assert.equal(exactGt.locationGranularity, 'auditorium');
  assert.equal(exactGt.locationConfidence, 'high');
  assert.equal(exactGt.identityConfidence, 'high');

  const science = record({ name: '哈尔滨黑龙江省科学技术馆', city: '哈尔滨', province: '黑龙江', projection: { raw: 'IMAX SR Dome', system: 'SR', dome: true } });
  const venue = candidate({ name: '黑龙江省科学技术馆', type: '科教文化服务;文化宫;文化宫', typecode: '140800', cityname: '哈尔滨市', pname: '黑龙江省', address: '太阳大道1458号', location: '126.575982,45.776439' });
  const fourD = candidate({ name: '黑龙江省科学技术馆4D影院', cityname: '哈尔滨市', pname: '黑龙江省', location: '126.576767,45.776701' });
  const parentVenue = scoreCandidate(science, venue);
  assert.equal(parentVenue.positionType, 'venue-poi');
  assert.equal(parentVenue.locationGranularity, 'venue');
  assert.equal(parentVenue.locationConfidence, 'high');
  assert.equal(parentVenue.identityConfidence, 'medium');
  assert.equal(parentVenue.decision, 'review-required-medium');
  assert.ok(scoreCandidate(science, fourD).hardRejects.includes('auditorium-format-conflict'));
});

test('GT Laser non-Dome source rejects a sibling Dome auditorium but may use the parent venue honestly', () => {
  const science = record({
    name: '济南山东省科技馆（新馆）',
    nameRaw: '济南山东省科技馆（新馆）',
    city: '济南',
    province: '山东',
    projection: { raw: 'IMAX Laser GT 3D\n12声道音响系统', system: 'GT Laser', technology: 'laser', geometry: 'GT', dome: false }
  });
  const domeSibling = candidate({
    id: 'dome-sibling',
    name: '山东省科技馆新馆球幕影院',
    cityname: '济南市',
    pname: '山东省',
    adname: '槐荫区',
    address: '山东省科技馆新馆',
    location: '116.908223,36.665923'
  });
  const parent = candidate({
    id: 'parent-venue',
    name: '山东省科技馆',
    type: '科教文化服务;科技馆;科技馆',
    typecode: '140600',
    cityname: '济南市',
    pname: '山东省',
    adname: '槐荫区',
    address: '日照路2286号',
    location: '116.908071,36.665867'
  });

  const incompatible = scoreCandidate(science, domeSibling);
  assert.equal(incompatible.locationGranularity, 'auditorium');
  assert.equal(incompatible.identityConfidence, 'low');
  assert.ok(incompatible.formatCompatibility.conflicts.includes('non-dome-vs-dome-auditorium'));
  assert.ok(incompatible.hardRejects.includes('auditorium-format-conflict'));
  assert.notEqual(incompatible.decision, 'accepted-high');

  const fallback = scoreCandidate(science, parent);
  assert.equal(fallback.positionType, 'venue-poi');
  assert.equal(fallback.locationGranularity, 'venue');
  assert.equal(fallback.locationConfidence, 'high');
  assert.equal(fallback.identityConfidence, 'medium');
  assert.equal(fallback.decision, 'review-required-medium');

  const chosen = chooseCandidate(science, [domeSibling, parent]);
  assert.equal(chosen.selected.poiId, 'parent-venue');
  assert.equal(chosen.selected.decision, 'review-required-medium');
});

test('Dome source rejects a same-venue non-Dome GT or ordinary IMAX auditorium', () => {
  const domeSource = record({
    name: '某科技馆',
    nameRaw: '某科技馆',
    city: '南京',
    province: '江苏',
    projection: { raw: 'IMAX SR Dome', system: 'SR', dome: true }
  });
  const candidates = [
    candidate({ name: '某科技馆IMAX GT巨幕影厅', cityname: '南京市', pname: '江苏省' }),
    candidate({ name: '某科技馆普通IMAX影厅', cityname: '南京市', pname: '江苏省' })
  ];
  for (const item of candidates) {
    const compatibility = auditoriumFormatCompatibility(domeSource, item);
    const scored = scoreCandidate(domeSource, item);
    assert.equal(compatibility.compatible, false, item.name);
    assert.ok(scored.hardRejects.includes('auditorium-format-conflict'), item.name);
    assert.notEqual(scored.decision, 'accepted-high', item.name);
  }
});

test('4D and XD sibling auditoriums cannot replace an IMAX source', () => {
  const imaxSource = record({ projection: { raw: 'IMAX Commercial Laser', system: 'Commercial Laser', dome: false } });
  for (const name of ['深圳万达影城4D影院', '深圳万达影城XD影厅']) {
    const scored = scoreCandidate(imaxSource, candidate({ name }));
    assert.ok(scored.formatCompatibility.conflicts.includes('imax-vs-4d-xd-sibling'), name);
    assert.ok(scored.hardRejects.includes('auditorium-format-conflict'), name);
    assert.notEqual(scored.decision, 'accepted-high', name);
  }
});

test('AMap coordinates preserve GCJ-02 and provide converted WGS84 values', () => {
  const converted = amapCoordinate(candidate());
  assert.equal(converted.providerCrs, 'GCJ-02');
  assert.equal(converted.mapCrs, 'WGS84');
  assert.equal(converted.providerLat, 22.673271);
  assert.equal(converted.providerLng, 114.130825);
  assert.notEqual(converted.lat, converted.providerLat);
  assert.notEqual(converted.lng, converted.providerLng);
});

test('cache-only audit cleared matcher regressions and made no requests', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-test-20.json'), 'utf8'));
  assert.equal(audit.requestPolicy.currentRunNetworkRequests, 0);
  assert.equal(audit.requestPolicy.cacheEntriesUsed, 42);
  assert.equal(audit.regression.invalidMallFallbackCount, 0);
  assert.equal(audit.regression.nonCinemaTypePromotedToCinemaCount, 0);
  assert.equal(audit.regression.jiuyuanMalformedHistoryQueryCount, 0);
  assert.equal(audit.regression.longgangTrueAmbiguity, false);
  assert.equal(audit.regression.crsFieldsCompleteForSelected, true);
  assert.equal(audit.regression.convertedCoordinatesWithinRange, true);
  assert.equal(audit.regression.providerCoordinatesPreservedSeparately, true);
});

test('--full and --apply remain disabled', () => {
  for (const flag of ['--full', '--apply']) {
    const result = spawnSync(process.execPath, ['scripts/geocode-poi.mjs', '--cache-only', flag], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /disabled|unavailable|cannot be written/i, flag);
  }
});
