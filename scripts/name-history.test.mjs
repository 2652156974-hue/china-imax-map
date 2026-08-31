import test from 'node:test';
import assert from 'node:assert/strict';
import { parseName } from './name-history.mjs';

test('ordinary place name containing 原 is not a former-name marker', () => {
  const parsed = parseName('包头万达影城（九原万达广场店）');
  assert.deepEqual(parsed.formerNames, []);
  assert.equal(parsed.name, '包头万达影城（九原万达广场店）');
});

test('operational prose on a later line remains unparsed metadata', () => {
  const parsed = parseName('某影院\n有商业综合体拆除\n设备升级备注');
  assert.deepEqual(parsed.formerNames, []);
  assert.deepEqual(parsed.unparsedNameLines, ['有商业综合体拆除', '设备升级备注']);
});

test('operational prose after a current name is not a former-name marker', () => {
  const parsed = parseName('武汉万达影城（汉街万达广场店） 原有商业综合体拆除');
  assert.deepEqual(parsed.formerNames, []);
  assert.equal(parsed.name, '武汉万达影城（汉街万达广场店） 原有商业综合体拆除');
});

test('explicit former-name grammar preserves complete names', () => {
  const parsed = parseName('哈尔滨儒意影城（哈东万达广场店）- 原万达影城\n原万达影城（哈东万达IMAXGT双激光店）\n（原哈尔滨泰莱时代影城）');
  assert.equal(parsed.name, '哈尔滨儒意影城（哈东万达广场店）');
  assert.deepEqual(parsed.formerNames, [
    '万达影城',
    '万达影城（哈东万达IMAXGT双激光店）',
    '哈尔滨泰莱时代影城',
  ]);
  assert.deepEqual(parsed.unparsedNameLines, []);
});
