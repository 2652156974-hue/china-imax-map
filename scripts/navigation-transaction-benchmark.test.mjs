import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const benchmark = JSON.parse(fs.readFileSync('data/audit/navigation-transaction-benchmark.json', 'utf8'));

test('full navigation benchmark captures every requested segment and atomic first renders', () => {
  assert.equal(benchmark.status, 'local-production-path-browser-capture');
  assert.equal(benchmark.application.workingTreeBuild, true);
  assert.equal(benchmark.application.published, false);
  assert.equal(benchmark.application.merged, false);
  assert.equal(benchmark.application.deployed, false);
  assert.equal(benchmark.browser.longTaskSupport, true);
  assert.equal(benchmark.scenarios.length, 2);
  for (const scenario of benchmark.scenarios) {
    assert.equal(scenario.trigger, 'return-button');
    for (const metric of benchmark.metrics) {
      assert.ok(Number.isFinite(scenario[metric]) && scenario[metric] >= 0, `${scenario.name} ${metric}`);
    }
    assert.equal(scenario.firstRender.source, 'navigation');
    assert.equal(scenario.firstRender.visibleRecordCount, scenario.targetVisibleRecordCount);
    assert.equal(scenario.firstRender.inputRecordCount, scenario.targetVisibleRecordCount);
    assert.equal(scenario.firstRender.displayMode, scenario.displayMode);
    assert.equal(scenario.recordListResultCount, scenario.targetVisibleRecordCount);
    assert.equal(scenario.zoomend.displayMode, scenario.displayMode);
    assert.equal(scenario.zoomend.skipped, true);
    assert.equal(scenario.zoomend.markerRemovedCount + scenario.zoomend.markerCreatedCount, 0);
    assert.ok(Array.isArray(scenario.longTasks));
    assert.ok(scenario.mainThreadFreeForNextFrameMs >= scenario.handlerTotalMs);
  }
  const national = benchmark.scenarios.find((scenario) => scenario.toFocus === '全国');
  assert.equal(national.firstRender.focus, null);
  assert.equal(national.firstRender.displayMode, 'province');
});
