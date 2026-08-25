#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  ADMISSION_DECISIONS,
  GOVERNANCE_STATES,
  IDENTITY_STATES,
} from '../packages/harness-runtime/lib/governance.mjs';
import {
  ADMISSION_KINDS,
  ADMISSION_REASON_CODES,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  PERMISSION_EVALUATION_STATES,
  evaluateAdmission,
} from '../packages/harness-runtime/lib/admission.mjs';

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

function request(role, capabilities, requestedAuthority, referenceContractFingerprint) {
  return {
    schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
    kind: ADMISSION_KINDS.ASSIGNMENT,
    subject: { role },
    requirements: { capabilities },
    requested_authority: { edit: false, stage: false, commit: false, push: false, ...requestedAuthority },
    ...(referenceContractFingerprint === undefined ? {} : { reference_contract_fingerprint: referenceContractFingerprint }),
  };
}

console.log('=== Ocode M4B Acceptance ===\n');

const deterministicTests = run(process.execPath, ['test/test-admission.mjs']);
const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });

const coder = contracts.get('coder');
const reviewer = contracts.get('reviewer');
const committer = contracts.get('committer');
const coderAllow = evaluateAdmission({
  request: request('coder', ['implementation.change'], { edit: true }),
  contract: coder,
});
const reviewerEdit = evaluateAdmission({
  request: request('reviewer', ['review.evaluate'], { edit: true }),
  contract: reviewer,
});
const committerCommit = evaluateAdmission({
  request: request('committer', ['closeout.evaluate'], { commit: true }),
  contract: committer,
});
const driftedAllow = evaluateAdmission({
  request: request('coder', ['implementation.change'], { edit: true }, '0'.repeat(64)),
  contract: coder,
});

assert.equal(contracts.size, manifest.roles.length);
assert.equal(coderAllow.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(reviewerEdit.decision, ADMISSION_DECISIONS.DENY);
assert.ok(reviewerEdit.reason_codes.includes(ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT));
assert.equal(committerCommit.decision, ADMISSION_DECISIONS.DENY);
assert.ok(committerCommit.reason_codes.includes(ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT));
assert.equal(driftedAllow.identity_state, IDENTITY_STATES.DRIFTED);
assert.equal(driftedAllow.governance_state, GOVERNANCE_STATES.VALID);
assert.equal(driftedAllow.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(coderAllow.permission_evaluation.status, PERMISSION_EVALUATION_STATES.NOT_EVALUATED);

console.log(JSON.stringify({
  status: 'M4B_PROVEN',
  deterministic_tests: deterministicTests,
  canonical_role_inventory: {
    source: 'agents/manifest.json',
    role_count: manifest.roles.length,
    roles: manifest.roles.map(({ id }) => id),
  },
  admission: {
    provider_independent: true,
    capability_authority_separation: true,
    role_name_authority_bypass: false,
    permission_evaluation: PERMISSION_EVALUATION_STATES.NOT_EVALUATED,
  },
  canonical_cases: {
    coder_implementation_edit: coderAllow.decision,
    reviewer_edit: reviewerEdit.decision,
    committer_commit: committerCommit.decision,
    drifted_valid_request: driftedAllow.decision,
  },
  identity_governance_admission_separate: true,
  m4_complete: false,
  m4c_unblocked: true,
}, null, 2));

console.log('\n✓ M4B acceptance passed');
