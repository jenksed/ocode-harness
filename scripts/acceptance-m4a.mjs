#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  ADMISSION_DECISIONS,
  CAPABILITY_SCHEMA_VERSION,
  GOVERNANCE_STATES,
  IDENTITY_STATES,
  fingerprintCapabilityVocabulary,
  validateCapabilityVocabulary,
} from '../packages/harness-runtime/lib/governance.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');

function run(command, args, timeout = 360_000) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error, undefined, `${command} failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return { command: [command, ...args].join(' '), exit_code: result.status };
}

console.log('=== Ocode M4A Acceptance ===\n');

const m3 = run('npm', ['run', 'acceptance:m3'], 900_000);
const deterministicTests = run(process.execPath, ['test/test-governance-contracts.mjs']);
const doctor = run(process.execPath, ['scripts/doctor.mjs'], 60_000);

const vocabulary = validateCapabilityVocabulary();
const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
const roleCapabilityMatrix = Object.fromEntries(
  manifest.roles.map((role) => [role.id, contracts.get(role.id).capabilities.provides]),
);
const committer = contracts.get('committer');

assert.equal(vocabulary.schema_version, CAPABILITY_SCHEMA_VERSION);
assert.equal(contracts.size, manifest.roles.length);
assert.equal(committer.authority.may_stage, false);
assert.equal(committer.authority.may_commit, false);
assert.equal(committer.authority.may_push, false);
assert.equal(committer.capabilities.provides.some((capability) => capability.startsWith('git.')), false);
assert.notEqual(IDENTITY_STATES.DRIFTED, GOVERNANCE_STATES.INVALID);
assert.notEqual(IDENTITY_STATES.DRIFTED, ADMISSION_DECISIONS.DENY);

console.log(JSON.stringify({
  status: 'M4A_PROVEN',
  m3_regression: m3,
  deterministic_tests: deterministicTests,
  doctor,
  capability_vocabulary: {
    schema_version: vocabulary.schema_version,
    fingerprint: fingerprintCapabilityVocabulary(vocabulary),
    identifiers: vocabulary.capabilities.map(({ id }) => id),
  },
  canonical_role_inventory: {
    source: 'agents/manifest.json',
    role_count: manifest.roles.length,
    roles: manifest.roles.map(({ id }) => id),
  },
  role_capability_matrix: roleCapabilityMatrix,
  capability_authority_separation: true,
  permission_compatibility_enforced: false,
  committer_git_mutation_authority: false,
  identity_state: {
    states: Object.values(IDENTITY_STATES),
    drift_can_be_valid_and_allowed: true,
  },
  m4_complete: false,
  m4b_unblocked: true,
}, null, 2));

console.log('\n✓ M4A acceptance passed');
