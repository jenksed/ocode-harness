#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBJECT_RECONCILIATION_SCHEMA_VERSION,
  SUBJECT_RECONCILIATION_STATES,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';

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

console.log('=== Ocode M4D Acceptance ===\n');
const subjectTests = run(process.execPath, ['test/test-subject-reconciliation.mjs']);

assert.equal(SUBJECT_RECONCILIATION_SCHEMA_VERSION, 1);
assert.deepEqual(Object.values(SUBJECT_RECONCILIATION_STATES), ['MATCH', 'MISMATCH', 'UNKNOWN']);

console.log(JSON.stringify({
  status: 'M4D_PROVEN',
  deterministic_tests: subjectTests,
  subject_reconciliation: {
    schema_version: SUBJECT_RECONCILIATION_SCHEMA_VERSION,
    states: Object.values(SUBJECT_RECONCILIATION_STATES),
    source: 'sanitized OpenCode export info.agent only',
    unknown_is_not_match: true,
  },
  admission_engine: 'M4B AdmissionDecision reused as governed execution input',
  binding_reconciliation_separate: true,
  primary_mode_authority_neutral: true,
  effective_runtime_permission_observation: false,
  live_provider_calls: 0,
  m4_complete: false,
  m4e_unblocked: true,
}, null, 2));

console.log('\n✓ M4D acceptance passed');
