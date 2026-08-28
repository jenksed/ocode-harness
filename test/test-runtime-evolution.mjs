import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyCommand, createNativeBashPermissionRules, createValidationRegistry, createValidationWrapperEnvironment, decideCommandAdmission, evaluateValidationRegistryFreshness } from '../packages/harness-runtime/lib/command-admission.mjs';
import { createStagingAuthorization, executeDeterministicStaging, fingerprintWorktreeDiff } from '../packages/harness-runtime/lib/deterministic-staging.mjs';
import { createTaskCapsule, createTaskCapsuleRevision, assertTaskCapsuleHandoff, validateAcceptanceEvidence } from '../packages/harness-runtime/lib/task-capsule.mjs';
import { createRepositorySnapshot } from '../packages/harness-runtime/lib/repository-snapshot.mjs';
import { createModelTelemetry, classifyExecutionFailure } from '../packages/harness-runtime/lib/model-telemetry.mjs';
import { deriveModelQualification, isQualificationCurrent, qualificationIdentity } from '../packages/harness-runtime/lib/model-qualification.mjs';
import { createBehavioralAdapter, selectBehavioralAdapter } from '../packages/harness-runtime/lib/behavioral-adapters.mjs';
import { resolveCapabilityExecution } from '../packages/harness-runtime/lib/capability-resolution.mjs';
import { evaluateToolLoop } from '../packages/harness-runtime/lib/tool-loop-control.mjs';
import { assertTaskCapsuleProjectRoot, bindTaskCapsuleToExecution } from '../packages/harness-runtime/lib/execution.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-runtime-evolution-'));
const hex = (char) => char.repeat(64);
const init = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
try {
  const packageSource = JSON.stringify({ scripts: { test: 'node test.mjs', 'test:unit': 'node test.mjs', build: 'node build.mjs', deploy: 'node deploy.mjs' } });
  writeFileSync(join(root, 'package.json'), packageSource, 'utf8');
  writeFileSync(join(root, 'feature.txt'), 'before\n', 'utf8');
  init(['init']); init(['config', 'user.email', 'test@example.test']); init(['config', 'user.name', 'Test']); init(['add', '--', 'package.json', 'feature.txt']); init(['commit', '-m', 'initial']);

  assert.equal(classifyCommand('rg task src').risk_class, 'OBSERVE');
  assert.equal(classifyCommand('git push origin main').risk_class, 'REMOTE_EFFECT');
  assert.equal(classifyCommand('rm -rf build').risk_class, 'DESTRUCTIVE');
  for (const command of ['git show --output=marker.txt HEAD', 'git diff --output=marker.txt', 'git log --output=marker.txt', 'find . -delete', 'find . -exec touch marker.txt', 'tree -o marker.txt']) {
    assert.equal(classifyCommand(command).risk_class, 'WORKSPACE_EFFECT', command);
  }
  assert.equal(classifyCommand('rg x; rm -rf /').risk_class, 'UNKNOWN');
  assert.equal(decideCommandAdmission({ command: 'unknown-command', role: 'coder' }).decision, 'ASK');
  assert.equal(decideCommandAdmission({ command: 'git push origin main', role: 'coder' }).decision, 'DENY');
  const registry = createValidationRegistry({ projectDir: root, commands: ['npm test', 'npm run test:unit'] });
  assert.equal(createValidationRegistry({ projectDir: root }).commands.includes('npm run deploy'), false);
  const nativeRules = createNativeBashPermissionRules({ baseRules: { '*': 'ask', 'rg *': 'allow' }, validationRegistry: registry, roleCapabilities: ['test.execute'] });
  assert.equal(nativeRules['npm test'], 'allow'); assert.equal(Object.keys(nativeRules).at(-1), '*<*'); assert.equal(nativeRules['*>*'], 'deny');
  assert.equal(decideCommandAdmission({ command: 'npm test', role: 'coder', roleCapabilities: ['test.execute'], validationRegistry: registry, projectDir: root }).decision, 'ALLOW');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'changed' } }), 'utf8');
  assert.equal(evaluateValidationRegistryFreshness(registry, { projectDir: root }).status, 'STALE');
  assert.equal(decideCommandAdmission({ command: 'npm test', role: 'coder', roleCapabilities: ['test.execute'], validationRegistry: registry, projectDir: root }).decision, 'ASK');
  writeFileSync(join(root, 'package.json'), packageSource, 'utf8');
  const wrapperEnv = createValidationWrapperEnvironment({ baseDir: resolve('.'), projectDir: root, registry, environment: process.env, realNpm: '/usr/bin/true' });
  const wrapper = resolve('packages/harness-runtime/bin/validation/npm');
  assert.equal(spawnSync(wrapper, ['test'], { cwd: root, env: wrapperEnv }).status, 0);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'changed' } }), 'utf8');
  assert.equal(spawnSync(wrapper, ['test'], { cwd: root, env: wrapperEnv }).status, 125);
  writeFileSync(join(root, 'package.json'), packageSource, 'utf8');
  console.log('✓ deterministic observation/validation classification preserves unknown ASK and stale-registry invalidation');

  const capsule = createTaskCapsule({ task_id: 'feature-task', revision: 1, parent_fingerprint: null, objective: 'Update feature behavior', authoritative_inputs: [{ id: 'spec', kind: 'PATH', reference: 'feature.txt', fingerprint: hex('a'), description: 'Current feature source' }], scope: { include_paths: ['feature.txt'], exclude_paths: ['.env'] }, non_goals: ['Do not alter configuration'], constraints: ['Keep public API stable'], acceptance: [{ id: 'feature-updated', requirement: 'Feature text changes', required_evidence: ['validation'] }], stop_conditions: ['Stop on unexpected path'], context: { path_refs: ['feature.txt'], evidence_refs: [], max_supplied_chars: 4096, max_expansions: 1 }, assumptions: ['No migration is needed'], provenance: { workflow_id: 'wf', run_id: 'run', session_id: 'session', role: 'coder' } });
  assertTaskCapsuleHandoff(capsule, capsule.fingerprint);
  assert.equal(bindTaskCapsuleToExecution({ taskCapsule: capsule, expectedTaskCapsuleFingerprint: capsule.fingerprint, role: 'coder', required: true }).fingerprint, capsule.fingerprint);
  assert.equal(bindTaskCapsuleToExecution({ taskCapsule: capsule, role: 'reviewer', required: true }).fingerprint, capsule.fingerprint);
  const rootedCapsule = createTaskCapsule({ ...capsule, context: { ...capsule.context, max_supplied_chars: 100000 }, repository_context: { snapshot: createRepositorySnapshot({ repositoryRoot: root }).snapshot, observations: [], unknowns: [] } });
  assert.equal(assertTaskCapsuleProjectRoot(rootedCapsule, root).fingerprint, rootedCapsule.fingerprint);
  const otherRoot = mkdtempSync(join(tmpdir(), 'ocode-runtime-other-root-'));
  try {
    writeFileSync(join(otherRoot, 'package.json'), '{"name":"other"}\n', 'utf8');
    execFileSync('git', ['init'], { cwd: otherRoot, encoding: 'utf8' });
    execFileSync('git', ['config', 'user.email', 'other@example.test'], { cwd: otherRoot, encoding: 'utf8' });
    execFileSync('git', ['config', 'user.name', 'Other'], { cwd: otherRoot, encoding: 'utf8' });
    execFileSync('git', ['add', '--', 'package.json'], { cwd: otherRoot, encoding: 'utf8' });
    execFileSync('git', ['commit', '-m', 'other'], { cwd: otherRoot, encoding: 'utf8' });
    assert.throws(() => assertTaskCapsuleProjectRoot(rootedCapsule, otherRoot), /OCODE_PROJECT_ROOT_MISMATCH/);
  } finally { rmSync(otherRoot, { recursive: true, force: true }); }
  assert.throws(() => createTaskCapsule({ ...capsule, scope: { include_paths: ['../escape'], exclude_paths: [] } }), /repository-relative/);
  assert.throws(() => createTaskCapsule({ ...capsule, acceptance: [capsule.acceptance[0], capsule.acceptance[0]] }), /unique/);
  const revision = createTaskCapsuleRevision(capsule, { ...capsule, objective: 'Updated objective', authoritative_inputs: capsule.authoritative_inputs, scope: capsule.scope, non_goals: capsule.non_goals, constraints: capsule.constraints, acceptance: capsule.acceptance, stop_conditions: capsule.stop_conditions, context: capsule.context, assumptions: capsule.assumptions, provenance: capsule.provenance });
  assert.equal(revision.parent_fingerprint, capsule.fingerprint); assert.notEqual(revision.fingerprint, capsule.fingerprint);
  validateAcceptanceEvidence(capsule, [{ acceptance_id: 'feature-updated', state: 'SATISFIED', evidence_refs: ['validation'] }]);
  console.log('✓ immutable/versioned TaskCapsule preserves acceptance evidence across handoff and repair revisions');

  writeFileSync(join(root, 'feature.txt'), 'after\n', 'utf8');
  const reviewed = fingerprintWorktreeDiff(root);
  const authorization = createStagingAuthorization({ projectRoot: root, accepted_paths: ['feature.txt'], reviewer_verdict: 'ACCEPT', lifecycle_state: 'CLOSEOUT_READY', validation_status: 'PASS', task_capsule_fingerprint: capsule.fingerprint, reviewer_diff_fingerprint: reviewed });
  const staged = executeDeterministicStaging({ projectRoot: root, authorization });
  assert.deepEqual(staged.staged_paths, ['feature.txt']);
  init(['reset', 'HEAD', '--', 'feature.txt']);
  const stale = createStagingAuthorization({ projectRoot: root, accepted_paths: ['feature.txt'], reviewer_verdict: 'ACCEPT', lifecycle_state: 'CLOSEOUT_READY', validation_status: 'PASS', task_capsule_fingerprint: capsule.fingerprint });
  writeFileSync(join(root, 'extra.txt'), 'unexpected\n', 'utf8');
  assert.throws(() => executeDeterministicStaging({ projectRoot: root, authorization: stale }), /STALE_WORKTREE_DIFF/);
  console.log('✓ deterministic staging stages only exact accepted paths and rejects stale review/diff state');

  const identity = { model_reference: 'freellmapi/model-a', effective_model_status: 'UNKNOWN', capability: 'implementation.change', adapter_fingerprint: null, role_contract_fingerprint: hex('b'), protocol_fingerprint: hex('c'), fixture_fingerprint: hex('d'), opencode_version: '1.18.21', qualification_protocol_version: '1' };
  const telemetryInput = { run_id: 'run-1', task_capsule_fingerprint: capsule.fingerprint, role: 'coder', capability: 'implementation.change', requested_model: 'freellmapi/model-a', effective_model: null, effective_model_status: 'UNKNOWN', adapter_fingerprint: null, qualification_identity_fingerprint: qualificationIdentity(identity).fingerprint, execution_profile: 'free', outcome: 'SUCCESS', acceptance_result: 'ACCEPTED', reviewer_verdict: 'ACCEPT', repair_cycles: 0, validation_results: ['npm test:PASS'], failure_classification: null, failure_attribution: 'UNATTRIBUTED', elapsed_ms: 12, token_count: null, cost: null };
  const first = createModelTelemetry(telemetryInput); const second = createModelTelemetry({ ...telemetryInput, run_id: 'run-2' });
  assert.deepEqual(classifyExecutionFailure({ runtime_failure: 'PROVIDER' }), { classification: 'PROVIDER_FAILURE', attribution: 'NON_MODEL' });
  const qualification = deriveModelQualification({ identity, telemetry: [first, second] });
  assert.equal(qualification.status, 'QUALIFIED'); assert.equal(isQualificationCurrent(qualification, identity), 'QUALIFIED');
  assert.equal(isQualificationCurrent(qualification, { ...identity, protocol_fingerprint: hex('e') }), 'STALE');
  console.log('✓ telemetry distinguishes non-model infrastructure/provider failures and qualification requires repeated accepted evidence');

  const family = createBehavioralAdapter({ id: 'family-validation-reminder', version: '1', state: 'QUALIFIED', target: { kind: 'MODEL_FAMILY', model_reference: 'family-a' }, mitigation: 'Run admitted validation before reporting completion.', triggering_failure_class: 'PREMATURE_COMPLETION', evidence_refs: ['run-1', 'run-2'], evaluation_protocol_fingerprint: hex('f'), before_qualification_fingerprint: hex('1'), after_qualification_fingerprint: hex('2') });
  const exact = createBehavioralAdapter({ ...family, id: 'exact-validation-reminder', target: { kind: 'EXACT_MODEL', model_reference: 'freellmapi/model-a' } });
  assert.equal(selectBehavioralAdapter({ model_reference: 'freellmapi/model-a', family_reference: 'family-a', adapters: [family, exact] }).id, exact.id);
  const profile = { schema_version: 1, name: 'test', policy_version: 1, bindings: { coder: 'freellmapi/model-a' } };
  const resolution = resolveCapabilityExecution({ profile, role: 'coder', required_capability: 'implementation.change', candidates: [{ model_reference: 'freellmapi/model-a', capabilities: ['implementation.change'], qualification_status: 'QUALIFIED', available: true, family_reference: 'family-a', effective_model_status: 'UNKNOWN' }], adapters: [family, exact] });
  assert.equal(resolution.status, 'QUALIFIED_SELECTION'); assert.equal(resolution.adapter.fingerprint, exact.fingerprint); assert.equal(resolution.effective_model_status, 'UNKNOWN');
  assert.equal(evaluateToolLoop([{ command: 'rg x', state_progress: false }, { command: 'rg x', state_progress: false }, { command: 'rg x', state_progress: false }]).status, 'NO_PROGRESS_DETECTED');
  console.log('✓ adapters remain separate from role authority; exact evidence wins; opaque routes retain UNKNOWN effective identity');
  console.log('RUNTIME_EVOLUTION_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
