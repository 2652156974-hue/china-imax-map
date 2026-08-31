import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePriorDeterministicAcceptedEvidence } from './recover-final-canonical.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

test('prior deterministic accepted set closes the final canonical recovery union', () => {
  const validation = validatePriorDeterministicAcceptedEvidence({
    report: readJson('data/audit/web-verified-and-unresolved.json'),
    current: readJson('data/local/private-reviewed-geocodes.json'),
    historicalFull: readJson('dist-private/data/cinemas.json'),
    derived: readJson('data/derived/cinemas.json'),
    unresolvedReconciliation: readJson('data/audit/unresolved-reconciliation.json'),
    followupQueries: readJson('data/audit/amap-web-followup-queries.json'),
    materializationScript: fs.readFileSync(path.join(ROOT, 'scripts/materialize-unresolved-final-verdict.mjs'), 'utf8')
  });
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.equal(validation.recordsChecked, 13);
  assert.equal(validation.coordinateMismatches, 0);
  assert.equal(validation.requiredFieldMismatches, 0);
  assert.deepEqual(validation.baseline, {
    startingLocated: 659,
    startingUnresolved: 242,
    acceptedRows: 13,
    locatedAfter: 672,
    unresolvedAfter: 229,
    locatedIncrement: 13,
    locatedPlusUnresolved: 901,
    invariant: true
  });
  assert.deepEqual(validation.sourceRows, [50, 76, 326, 792, 793, 801, 804, 815, 816, 829, 832, 869, 885]);
  assert.equal(Object.values(validation.strictGates).every(Boolean), true);

  const recovery = readJson('data/audit/final-canonical-recovery.json');
  assert.equal(recovery.reliableEvidenceSets.unionLocated, 901);
  assert.equal(recovery.reliableEvidenceSets.unionOverlap, 0);
  assert.equal(recovery.gap.count, 0);
});
