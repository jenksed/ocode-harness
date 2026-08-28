import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAutomatedFailure, classifyPhaseFailure, classifyProvider, createAutomatedEnvironment, createWorktree, parseArgs, safeEnv, summarizeActivity } from '../scripts/qualify-runtime-integration-e2e.mjs';

assert.deepEqual(parseArgs(['--cleanup', '--worktree', '../qualification-worktree']), {
  remote: 'origin/review/runtime-integration-qualification',
  worktree: join(process.cwd(), '..', 'qualification-worktree'),
  cleanup: true,
  deterministicOnly: false,
  skipProvider: false,
  skipOperator: false,
  operatorOnly: false,
});
assert.equal(parseArgs(['--operator-only']).operatorOnly, true);
assert.equal(parseArgs(['--operator-only']).deterministicOnly, false);
assert.throws(() => parseArgs(['--unknown']), /Unknown option/);

assert.equal(classifyProvider({ ok: false, stdout: 'Error: PROVIDER_API_ERROR_401', stderr: '' }), 'PROVIDER_API_ERROR_401');
assert.equal(classifyProvider({ ok: false, stdout: 'M6_2_LIVE_QUALIFIED', stderr: '' }), 'LIVE_MODEL_QUALIFIED');
assert.equal(classifyProvider({ ok: false, stdout: 'TDD_METHOD_FAILURE', stderr: '' }), 'MODEL_FAILURE');
assert.equal(classifyProvider({ ok: false, stdout: '', stderr: 'boom' }), 'RUNTIME_FAILURE');
assert.equal(classifyProvider({ ok: true, stdout: '', stderr: '' }), 'UNPROVEN');
assert.equal(classifyPhaseFailure({ error: 'spawn failed' }), 'INFRASTRUCTURE_FAILURE');
assert.equal(classifyPhaseFailure({ signal: 'SIGTERM' }), 'RUNTIME_FAILURE');
assert.equal(classifyPhaseFailure({ status: 0 }), null);
assert.equal(classifyAutomatedFailure({ status: 128, stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }), 'GIT_CREDENTIALS_REQUIRED_NONINTERACTIVE');

const env = safeEnv({ HOME: '/tmp/owned', PATH: '/bin', FREELLMAPI_API_KEY: 'secret', OTHER: 'omit' });
assert.equal(env.HOME, '/tmp/owned');
assert.equal(env.FREELLMAPI_API_KEY, '<present>');
assert.equal(env.OTHER, undefined);
assert.equal(JSON.stringify(env).includes('secret'), false);
const automated = createAutomatedEnvironment({ HOME: '/tmp/isolated', GITHUB_TOKEN: undefined });
assert.equal(automated.GIT_TERMINAL_PROMPT, '0');
assert.equal(automated.HOME, '/tmp/isolated');
assert.equal(automated.GITHUB_TOKEN, undefined);

const activity = summarizeActivity([
  { event_type: 'EFFECT_REQUESTED', metadata: { operation_class: 'OBSERVE' } },
  { event_type: 'APPROVAL_REQUIRED', metadata: { operation_class: 'UNKNOWN' } },
  { event_type: 'APPROVAL_GRANTED', metadata: { operation_class: 'UNKNOWN' } },
  { event_type: 'EFFECT_DENIED', metadata: { operation_class: 'REMOTE_EFFECT' } },
  { event_type: 'EFFECT_EXECUTED', metadata: {}, agent_role: 'coder' },
  { event_type: 'DELEGATION_CREATED', metadata: {}, agent_role: 'verifier' },
  { event_type: 'AGENT_STARTED', metadata: {}, agent_role: 'reviewer' },
].map(JSON.stringify).join('\n'));
assert.equal(activity.permission_requests, 2);
assert.equal(activity.approvals, 1);
assert.equal(activity.structural_denials, 1);
assert.equal(activity.routine_inspection_requests, 1);
assert.equal(activity.unknown_requests, 1);
assert.equal(activity.delegation_count, 1);
assert.equal(activity.verifier_observed, true);
assert.equal(activity.reviewer_observed, true);

const repo = mkdtempSync(join(tmpdir(), 'ocode-e2e-worktree-test-'));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'qualification@example.invalid'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Qualification'], { cwd: repo });
writeFileSync(join(repo, 'tracked.txt'), 'clean\n');
execFileSync('git', ['add', 'tracked.txt'], { cwd: repo });
execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo });
const worktree = join(repo, 'child');
const state = { source: repo, options: { worktree, remote: 'HEAD' } };
await createWorktree(state);
assert.equal(state.worktreeOwned, true);
assert.equal(state.worktree, worktree);
writeFileSync(join(worktree, 'dirty.txt'), 'must reject\n');
await assert.rejects(() => createWorktree({ source: repo, options: { worktree, remote: 'HEAD' } }), /not clean/);

console.log('RUNTIME_INTEGRATION_E2E_DRIVER_HELPERS_PROVEN');
