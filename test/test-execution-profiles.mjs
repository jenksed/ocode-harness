#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  auditAgentInventory,
  loadAgentContracts,
  loadAgentManifest,
} from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  BindingError,
  buildOpenCodeRuntimeOverlay,
  createExecutionResolution,
  fingerprintBindingProfile,
  loadBindingProfile,
  mergeOpenCodeRuntimeOverlay,
  reconcileExecutionBinding,
  selectProfileName,
  validateBindingProfile,
  validateProfileCompleteness,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';
import {
  createExecutionProvenance,
  serializeGovernedExecutionOverlay,
  validateResolutionAvailability,
} from '../packages/harness-runtime/lib/execution.mjs';
import { appendRecord, createLedgerRecord, getRecordByRunId } from '../packages/harness-runtime/lib/ledger.mjs';
import { resolveRuntimeState } from '../packages/harness-runtime/lib/runtime-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const stateHome = mkdtempSync(join(tmpdir(), 'ocode-execution-profile-state-'));
process.env.XDG_STATE_HOME = stateHome;
const fixtureRoot = resolve(repoRoot, 'test', 'fixtures', 'm4-readiness');
const tempRoot = mkdtempSync(join(tmpdir(), 'ocode-m3-unit-'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

try {
  console.log('=== Test M3 Execution Profiles ===\n');
  const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
  const roleIDs = manifest.roles.map((role) => role.id);
  assert.equal(contracts.size, roleIDs.length);
  for (const contract of contracts.values()) {
    assert.equal(contract.agent_settings.model, undefined, `${contract.id} must be provider-neutral`);
    assert.equal(contract.declared_model, null, `${contract.id} must declare no source model policy`);
    assert.match(contract.contract_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(contract.contract_fingerprint, contracts.get(contract.id).contract_fingerprint);
  }
  console.log('✓ Manifest-derived contracts are complete, provider-neutral, and deterministic');

  const profilesDir = resolve(repoRoot, 'profiles');
  const free = loadBindingProfile('free', { profilesDir, manifest }).profile;
  const hybrid = loadBindingProfile('hybrid', { profilesDir, manifest }).profile;
  assert.deepEqual(Object.keys(free.bindings), roleIDs);
  assert.deepEqual(Object.keys(hybrid.bindings), roleIDs);
  assert(Object.values(free.bindings).every((binding) => binding.startsWith('freellmapi/')));
  assert.equal(Object.values(free.bindings).some((binding) => binding.startsWith('openai/')), false);
  assert.equal(hybrid.bindings.planner, 'openai/gpt-5.6-sol');
  assert.equal(hybrid.bindings.reviewer, 'openai/gpt-5.6-sol');
  assert.equal(hybrid.bindings.judge, 'openai/gpt-5.6-sol');
  assert.equal(hybrid.bindings.coder, 'freellmapi/auto:coding');
  console.log('✓ Free and hybrid policies cover every manifest role exactly once');

  const reordered = {
    ...free,
    bindings: Object.fromEntries(Object.entries(free.bindings).reverse()),
  };
  assert.equal(fingerprintBindingProfile(free), fingerprintBindingProfile(reordered));
  assert.notEqual(fingerprintBindingProfile(free), fingerprintBindingProfile(hybrid));
  console.log('✓ Profile fingerprints are key-order stable and policy-sensitive');

  const plannerFree = createExecutionResolution({
    role: 'planner', contract: contracts.get('planner'), profile: free, bindingSource: 'profiles/free.json',
  });
  const plannerHybrid = createExecutionResolution({
    role: 'planner', contract: contracts.get('planner'), profile: hybrid, bindingSource: 'profiles/hybrid.json',
  });
  assert.equal(plannerFree.subject.contract_fingerprint, plannerHybrid.subject.contract_fingerprint);
  assert.notEqual(plannerFree.execution_policy.profile_fingerprint, plannerHybrid.execution_policy.profile_fingerprint);
  assert.equal(plannerFree.execution_policy.fallback, 'deny');
  assert.equal(plannerFree.validation.status, 'PASS');
  console.log('✓ ExecutionResolution separates stable subject identity from execution policy');

  const merged = mergeOpenCodeRuntimeOverlay(free, JSON.stringify({
    theme: 'user-theme',
    agent: { planner: { temperature: 0.25 }, user_agent: { model: 'user/model' } },
  }));
  assert.equal(merged.theme, 'user-theme');
  assert.equal(merged.agent.planner.temperature, 0.25);
  assert.equal(merged.agent.planner.model, free.bindings.planner);
  assert.equal(merged.agent.user_agent.model, 'user/model');
  assert.deepEqual(buildOpenCodeRuntimeOverlay(free).agent.planner, { model: free.bindings.planner });
  const governedOverlay = JSON.parse(serializeGovernedExecutionOverlay(free, 'planner'));
  assert.equal(governedOverlay.agent.planner.mode, 'primary');
  assert.equal(governedOverlay.agent.coder.mode, undefined);
  console.log('✓ Runtime composition preserves unrelated inline configuration and owns only role model keys');

  assert.throws(() => loadBindingProfile('missing', { profilesDir, manifest }), /Unknown profile/);
  assert.throws(() => validateBindingProfile({ ...free, extra: true }), /Unknown binding profile field/);
  assert.throws(() => validateBindingProfile({ ...free, schema_version: 2 }), /schema_version must be 1/);
  assert.throws(() => validateBindingProfile({ ...free, bindings: { planner: 'malformed' } }), /provider\/model/);
  const incomplete = { ...free, bindings: { ...free.bindings } };
  delete incomplete.bindings.reviewer;
  assert.throws(() => validateProfileCompleteness(incomplete, manifest), /missing governed roles: reviewer/);
  const futureManifest = structuredClone(manifest);
  futureManifest.roles.push({ ...structuredClone(manifest.roles[0]), id: 'future_wayfinder', file: 'future-wayfinder.md' });
  assert.throws(() => validateProfileCompleteness(free, futureManifest), /missing governed roles: future_wayfinder/);
  assert.throws(() => validateResolutionAvailability(plannerHybrid, { models: ['openai/not-requested'] }), (error) => (
    error instanceof BindingError && error.details.requested === 'openai/gpt-5.6-sol'
  ));
  console.log('✓ Unknown, malformed, missing, unavailable, and future-role bindings fail closed');

  const requested = plannerHybrid.execution_policy.requested_model;
  const matchingExport = { info: { model: { providerID: 'openai', id: requested.slice('openai/'.length) } } };
  assert.equal(reconcileExecutionBinding(plannerHybrid, matchingExport).state, 'MATCH');
  assert.equal(reconcileExecutionBinding(plannerHybrid, { info: { model: { providerID: 'freellmapi', id: 'auto:planning' } } }).state, 'MISMATCH');
  assert.equal(reconcileExecutionBinding(plannerHybrid, null).state, 'UNKNOWN');
  console.log('✓ Requested/effective reconciliation distinguishes MATCH, MISMATCH, and UNKNOWN');

  for (const fixture of ['edit-authority-contradiction', 'commit-authority-contradiction']) {
    const fixtureDir = resolve(fixtureRoot, fixture);
    const loaded = loadAgentContracts({
      baseDir: repoRoot,
      agentsDir: fixtureDir,
      manifestPath: resolve(fixtureDir, 'manifest.json'),
    });
    assert.equal(loaded.contracts.size, 1);
  }
  const withoutManifestDir = resolve(fixtureRoot, 'agent-without-manifest');
  const withoutManifest = loadAgentManifest(resolve(withoutManifestDir, 'manifest.json'));
  assert.deepEqual(auditAgentInventory({ manifest: withoutManifest, agentsDir: withoutManifestDir }).agents_without_manifest, ['unlisted.md']);
  const withoutAgentDir = resolve(fixtureRoot, 'manifest-without-agent');
  const withoutAgent = loadAgentManifest(resolve(withoutAgentDir, 'manifest.json'));
  assert.deepEqual(auditAgentInventory({ manifest: withoutAgent, agentsDir: withoutAgentDir }).manifest_without_agent, ['missing.md']);
  const unknownProfile = JSON.parse(readFileSync(resolve(fixtureRoot, 'unknown-role-profile.json'), 'utf8'));
  assert.throws(() => validateProfileCompleteness(unknownProfile, manifest), /unknown roles: not_in_manifest/);
  console.log('✓ All five M4 readiness fixture classes parse or audit deterministically');

  const projectDir = resolve(tempRoot, 'project');
  mkdirSync(resolve(projectDir, '.opencode'), { recursive: true });
  const reconciliation = reconcileExecutionBinding(plannerHybrid, matchingExport);
  const provenance = createExecutionProvenance({ resolution: plannerHybrid, reconciliation, success: true });
  const ledgerPath = resolveRuntimeState(projectDir).ledger;
  const record = createLedgerRecord({
    run_id: '22222222-2222-4cba-8def-222222222222',
    project_name: 'fixture',
    project_root: projectDir,
    execution_provenance: provenance,
  });
  appendRecord(ledgerPath, record);
  assert.equal(getRecordByRunId(ledgerPath, record.run_id).execution_provenance.binding_reconciliation, 'MATCH');
  console.log('✓ Existing ledger persists and queries bounded M3 execution provenance');

  const machineConfig = resolve(tempRoot, 'config.json');
  writeFileSync(machineConfig, JSON.stringify({ profile: 'hybrid' }), 'utf8');
  const beforeConfig = sha256(machineConfig);
  const cli = resolve(repoRoot, 'packages', 'harness-runtime', 'bin', 'ocode.mjs');
  const cliEnv = {
    ...process.env,
    OCODE_HARNESS_ROOT: repoRoot,
    OCODE_MACHINE_CONFIG: machineConfig,
  };
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: projectDir, env: cliEnv, encoding: 'utf8' });
  const profileOutput = invoke(['profile']);
  assert.equal(profileOutput.status, 0, profileOutput.stderr);
  assert.match(profileOutput.stdout, /Active profile: hybrid/);
  const overrideOutput = invoke(['--profile', 'free', 'profile']);
  assert.equal(overrideOutput.status, 0, overrideOutput.stderr);
  assert.match(overrideOutput.stdout, /Active profile: free/);
  const explainOutput = invoke(['profile', 'explain', 'reviewer']);
  assert.equal(explainOutput.status, 0, explainOutput.stderr);
  assert.match(explainOutput.stdout, /openai\/gpt-5\.6-sol/);
  const diffOutput = invoke(['profile', 'diff', 'free', 'hybrid']);
  assert.equal(diffOutput.status, 0, diffOutput.stderr);
  assert.match(diffOutput.stdout, /planner\s+freellmapi\/auto:planning\s+openai\/gpt-5\.6-sol/);
  const runOutput = invoke(['explain', '--run', record.run_id]);
  assert.equal(runOutput.status, 0, runOutput.stderr);
  assert.match(runOutput.stdout, /RECONCILIATION\nMATCH/);
  assert.equal(sha256(machineConfig), beforeConfig);
  assert.equal(selectProfileName({ override: 'free', machineConfig: { profile: 'hybrid' } }), 'free');
  console.log('✓ Operator commands share production resolution and overrides never persist');

  console.log('\n✓ All M3 execution profile tests passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(stateHome, { recursive: true, force: true });
}
