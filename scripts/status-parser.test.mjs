import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStatus } from './status-parser.mjs';

test('close followed by dated reopen resolves to open', () => {
  const parsed = parseStatus('2021年2月10日结束运营\n2024年7月26日重装启幕', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed._latestEvent.signal, '重装启幕');
  assert.equal(parsed._eligibleEvents.length, 2);
});

test('temporary closure followed by reopen resolves to open', () => {
  const parsed = parseStatus('2023年1月1日暂停营业\n2023年6月1日重新开业', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed._latestEvent.signal, '重新开业');
});

test('multiple upgrades without closure preserve open status', () => {
  const parsed = parseStatus('2018年开业\n2020年升级\n2021年换幕\n2022年重装启幕', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed._latestEvent.signal, '重装启幕');
});

test('closure with no later reopen remains closed', () => {
  const parsed = parseStatus('2021年2月10日结束运营\n2021年2月23日更名', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'closed');
  assert.equal(parsed._latestEvent.signal, '结束运营');
});

test('planned or future opening does not establish current open status', () => {
  const parsed = parseStatus('2026年10月1日即将开业', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'unknown');
  assert.equal(parsed._events.length, 1);
  assert.equal(parsed._events[0].eligible, false);
  assert.equal(parsed._events[0].future, true);
  assert.equal(parsed._reason, 'status-future-only-or-no-decisive-event');
});

test('unknown month and day never become January 1 or establish open status', () => {
  const parsed = parseStatus('2026年？月？日（开业）', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'unknown');
  assert.equal(parsed._latestEvent, null);
  assert.equal(parsed._events[0].date, null);
  assert.equal(parsed._events[0].datePrecision, 'unknown');
  assert.equal(parsed._events[0].eligible, false);
  assert.equal(parsed._events[0].exclusionReason, 'date-precision-unknown');
  assert.doesNotMatch(parsed.historySummary, /2026-01-01/);
});

test('partial month preserves month precision without fabricating a day', () => {
  const parsed = parseStatus('2026年6月？日（重新开业）', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed._latestEvent.date, '2026-06');
  assert.equal(parsed._latestEvent.datePrecision, 'month');
  assert.match(parsed.historySummary, /2026-06（月精度）/);
  assert.doesNotMatch(parsed.historySummary, /2026-06-01/);
});

test('partial-date source rows remain unknown and never display fabricated day 01', () => {
  const derived = JSON.parse(fs.readFileSync('data/derived/cinemas.json', 'utf8'));
  const rows = new Set([50, 333, 662, 684, 685, 708, 717, 739]);
  const selected = (derived.records ?? derived).filter((record) => rows.has(Number(record.sourceRow)));
  assert.equal(selected.length, rows.size);
  for (const record of selected) {
    assert.equal(record.status, 'unknown', `sourceRow ${record.sourceRow} must remain unknown`);
    assert.doesNotMatch(record.historySummary, /-01(?:\s|$)/, `sourceRow ${record.sourceRow} has fabricated day precision`);
  }
});

test('undated event cannot silently override dated closure', () => {
  const parsed = parseStatus('2021年2月10日结束运营\n重新开业', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'closed');
  assert.equal(parsed._latestEvent.signal, '结束运营');
  assert.equal(parsed._events[1].eligible, true);
});

test('undated closure cannot silently override a later dated reopen', () => {
  const parsed = parseStatus('2021年2月10日结束运营\n2024年7月26日重新开业\n停止放映', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed._latestEvent.signal, '重新开业');
});

test('future planned reopen does not override a current closure', () => {
  const parsed = parseStatus('2021年2月10日结束运营\n2027年7月26日计划重新开业', { asOfDate: '2026-08-21' });
  assert.equal(parsed.status, 'closed');
  assert.equal(parsed._latestEvent.signal, '结束运营');
  assert.equal(parsed._events.at(-1).eligible, false);
});

test('row 59 哈东万达 regression remains open after the dated reopen', () => {
  const derived = JSON.parse(fs.readFileSync('data/derived/cinemas.json', 'utf8'));
  const record = (derived.records ?? derived).find((item) => Number(item.sourceRow) === 59);
  assert.equal(record?.status, 'open');
  assert.match(record?.historySummary ?? '', /2024|重装启幕|开业|营业/);
});
