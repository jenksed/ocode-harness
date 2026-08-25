#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { ADMISSION_DECISIONS } from '../packages/harness-runtime/lib/governance.mjs';
import { evaluateContractAdmission } from '../packages/harness-runtime/lib/admission.mjs';
import {
  PERMISSION_OPERATIONS,
  PERMISSION_PROJECTION_SCHEMA_VERSION,
  PERMISSION_PROJECTION_STATES,
  projectPermissions,
} from '../packages/harness-runtime/lib/permission-projection.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, timeout = 60_000) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error, undefined, `${command} failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return { command: [command, ...args].join(' '), exit_code: result.status };
}

console.log('=== Ocode M4C Acceptance ===\n');

const projectionTests = run(process.execPath, ['test/test-permission-governance.mjs']);
const affectedAdmissionTests = run(process.execPath, ['test/test-admission.mjs']);
const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
const workforce = manifest.roles.map(({ id }) => {
  const contract = contracts.get(id);
  const projection = projectPermissions(contract.permissions);
  const baseline = evaluateContractAdmission(contract);
  assert.equal(baseline.decision, ADMISSION_DECISIONS.ALLOW, `${id} baseline contract admission must allow`);
  return {
    role: id,
    projection: Object.fromEntries(PERMISSION_OPERATIONS.map((operation) => [operation, projection.operations[operation].state])),
    authority: contract.authority,
    governance_state: baseline.governance_state,
    baseline_admission: baseline.decision,
    reason_codes: baseline.reason_codes,
  };
});

assert.equal(contracts.size, manifest.roles.length);
assert.equal(PERMISSION_PROJECTION_SCHEMA_VERSION, 1);
assert.deepEqual(PERMISSION_OPERATIONS, ['edit', 'test', 'stage', 'commit', 'push', 'web']);
assert.equal(PERMISSION_PROJECTION_STATES.NOT_PROJECTED, 'NOT_PROJECTED');

console.log(JSON.stringify({
  status: 'M4C_PROVEN',
  deterministic_tests: { projectionTests, affectedAdmissionTests },
  permission_projection: {
    schema_version: PERMISSION_PROJECTION_SCHEMA_VERSION,
    operations: PERMISSION_OPERATIONS,
    states: [
      PERMISSION_PROJECTION_STATES.ALLOW,
      PERMISSION_PROJECTION_STATES.DENY,
      PERMISSION_PROJECTION_STATES.UNKNOWN,
    ],
    generic_command_execute: PERMISSION_PROJECTION_STATES.NOT_PROJECTED,
    configured_not_effective_runtime: true,
  },
  current_workforce_diagnostic: {
    source: 'agents/manifest.json',
    role_count: workforce.length,
    roles: workforce,
  },
  admission_engine: 'M4B AdmissionDecision extended in place',
  m4_complete: false,
  m4d_unblocked: true,
}, null, 2));

console.log('\n✓ M4C acceptance passed');
