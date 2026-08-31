import test from 'node:test';
import assert from 'node:assert/strict';
import { adminCompatibility, adminHierarchyAudit, countyDivisionFor, isCountyLevelTarget } from './admin-divisions.mjs';

function source(city, province) {
  return { city, province };
}

function candidate({ province, prefecture, county }) {
  return { pname: `${province}省`, cityname: `${prefecture}市`, adname: `${county}市`, name: '测试影院', address: '测试地址' };
}

const positiveCases = [
  ['乐清', '浙江', '温州'],
  ['余姚', '浙江', '宁波'],
  ['昆山', '江苏', '苏州'],
  ['江阴', '江苏', '无锡'],
  ['义乌', '浙江', '金华'],
  ['晋江', '福建', '泉州']
];

test('county-level city requires exact province, parent prefecture, and adname', () => {
  for (const [city, province, prefecture] of positiveCases) {
    const result = adminCompatibility(source(city, province), candidate({ province, prefecture, county: city }));
    assert.equal(result.provinceMatch, true, city);
    assert.equal(result.prefectureMatch, true, city);
    assert.equal(result.countyMatch, true, city);
    assert.equal(result.targetLevel, 'county-level-city', city);
    assert.equal(result.compatible, true, city);
  }
});

test('same province or same prefecture never permits a sibling county-level division', () => {
  const negatives = [
    ['昆山', '江苏', '苏州', '张家港'],
    ['余姚', '浙江', '宁波', '慈溪'],
    ['乐清', '浙江', '温州', '瑞安']
  ];
  for (const [city, province, prefecture, wrongCounty] of negatives) {
    const result = adminCompatibility(source(city, province), candidate({ province, prefecture, county: wrongCounty }));
    assert.equal(result.provinceMatch, true, city);
    assert.equal(result.prefectureMatch, true, city);
    assert.equal(result.countyMatch, false, city);
    assert.equal(result.compatible, false, city);
  }
});

test('wrong parent prefecture or province remains incompatible even when adname matches', () => {
  const wrongPrefecture = adminCompatibility(source('昆山', '江苏'), candidate({ province: '江苏', prefecture: '无锡', county: '昆山' }));
  assert.equal(wrongPrefecture.countyMatch, true);
  assert.equal(wrongPrefecture.prefectureMatch, false);
  assert.equal(wrongPrefecture.compatible, false);

  const wrongProvince = adminCompatibility(source('余姚', '浙江'), candidate({ province: '江苏', prefecture: '宁波', county: '余姚' }));
  assert.equal(wrongProvince.provinceMatch, false);
  assert.equal(wrongProvince.compatible, false);
});

test('prefecture-level and municipality rules remain strict', () => {
  const prefecture = adminCompatibility(source('广州', '广东'), candidate({ province: '广东', prefecture: '广州', county: '天河' }));
  assert.equal(prefecture.targetLevel, 'prefecture');
  assert.equal(prefecture.compatible, true);

  const siblingPrefecture = adminCompatibility(source('广州', '广东'), candidate({ province: '广东', prefecture: '深圳', county: '南山' }));
  assert.equal(siblingPrefecture.compatible, false);

  const municipality = adminCompatibility(source('上海', '上海'), { pname: '上海市', cityname: '上海市', adname: '浦东新区' });
  assert.equal(municipality.targetLevel, 'municipality');
  assert.equal(municipality.compatible, true);
});

test('requested county-level audit set is present in the versioned hierarchy', () => {
  const required = ['太仓', '昆山', '张家港', '常熟', '江阴', '宜兴', '余姚', '慈溪', '义乌', '桐乡', '海宁', '乐清', '温岭', '晋江', '石狮', '福清'];
  for (const city of required) {
    assert.equal(isCountyLevelTarget(city), true, city);
    assert.ok(countyDivisionFor(city), city);
  }
  assert.ok(adminHierarchyAudit().countyLevelDivisionCount >= required.length);
});
