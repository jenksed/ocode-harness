import assert from 'node:assert/strict';
import { validateProgram } from '../scripts/validate-program.mjs';

const result = validateProgram();
assert.deepEqual(result.errors, [], `program validation errors:\n${result.errors.join('\n')}`);
assert.ok(result.counts.nodes >= 1);
assert.equal(result.counts.active, 1);
assert.ok(result.counts.release_checkpoints >= 1);
assert.ok(result.counts.evidence_entries >= 1);

console.log(JSON.stringify({
  status: 'PROGRAM_TEST_PASS',
  counts: result.counts,
  warnings: result.warnings
}));
