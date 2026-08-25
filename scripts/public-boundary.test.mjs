import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = process.cwd();

test('public boundary passes for static facts and uses the clean public branch scope', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-public-boundary.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/public-boundary.json'), 'utf8'));
  assert.match(report.status, /^public-boundary-check-passed/);
  assert.equal(report.security.cacheTracked, false);
  assert.equal(report.security.rawTracked, false);
  assert.equal(report.security.staticBulkCoordinateArtifacts, 0);
  assert.equal(report.security.amapPublicationGate, 'removed-from-development-route');
  assert.equal(report.cleanBranch.publicReleaseBranch, 'codex/public-release');
  assert.equal(report.cleanBranch.publicReleaseBranchExists, true);
  assert.equal(report.cleanBranch.noMergePerformed, true);
  assert.equal(report.cleanBranch.noDeployPerformed, report.deployment?.status !== 'deployed');
  if (report.deployment?.status === 'deployed') {
    assert.match(report.deployment.url, /^https:\/\/china-imax-map\./);
    assert.equal(report.deployment.onlineVerification?.rootStatus, 200);
    assert.equal(report.deployment.onlineVerification?.appStatus, 200);
    assert.equal(report.deployment.onlineVerification?.formatterStatus, 200);
    assert.equal(report.deployment.onlineVerification?.stylesStatus, 200);
    assert.equal(report.deployment.onlineVerification?.runtimeConfigStatus, 200);
    assert.equal(report.deployment.onlineVerification?.markerRecords, 901);
    assert.equal(report.deployment.onlineVerification?.markerUniqueSourceRows, 901);
    assert.equal(report.deployment.onlineVerification?.forbiddenFields, false);
    assert.equal(report.deployment.onlineVerification?.appContainsLocationInfo, true);
    assert.equal(report.deployment.onlineVerification?.appContainsOldRows, false);
    assert.equal(report.deployment.onlineVerification?.stylesSharedSurfacesAndWrap, true);
  }
  assert.equal(report.warnings.some((warning) => /raw Tencent mirror/i.test(warning)), false);
});

test('public static boundary excludes provider fields and exposes no credential literal', () => {
  const publicData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/public/cinemas.json'), 'utf8'));
  const serialized = JSON.stringify(publicData);
  assert.equal(serialized.includes('providerLat'), false);
  assert.equal(serialized.includes('providerLng'), false);
  assert.equal(serialized.includes('rawCandidates'), false);
  assert.equal(serialized.includes('AMAP_JS_SECURITY_CODE'), false);
  assert.equal(/\b[a-f0-9]{32}\b/i.test(serialized), false);
});
