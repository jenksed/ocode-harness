#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { executeGovernedRole } from '../packages/harness-runtime/lib/execution.mjs';
import { readRecords } from '../packages/harness-runtime/lib/ledger.mjs';
import {
  BindingError,
  fingerprintBindingProfile,
  loadBindingProfile,
  reconcileExecutionBinding,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const temporaryProject = mkdtempSync(join(tmpdir(), 'ocode-m3-acceptance-'));
const catalogCache = new Map();
let infrastructureRetries = 0;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotFiles(paths) {
  return Object.fromEntries(paths.map((path) => [path, existsSync(path) ? sha256File(path) : null]));
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 240_000,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: [command, ...args].join(' '),
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    duration_ms: Date.now() - started,
    spawn_error: result.error?.message || null,
  };
}

function requireSuccess(result, label) {
  assert.equal(result.spawn_error, null, `${label} failed to spawn: ${result.spawn_error}`);
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}`);
  assert.equal(result.exit_code, 0, `${label} failed\n${result.stdout}\n${result.stderr}`);
}

function summarizeExecution(result) {
  return {
    role: result.resolution.subject.role,
    semantic_contract_fingerprint: result.resolution.subject.contract_fingerprint,
    requested: result.reconciliation.requested,
    effective: result.reconciliation.effective,
    reconciliation: result.reconciliation.state,
    result: result.success ? 'PASS' : 'FAIL',
    failure_classification: result.failure_classification,
    session_id: result.session_id,
    openai_requested: result.reconciliation.requested.startsWith('openai/'),
    files_changed: result.exported?.info?.summary?.files || 0,
    run_id: result.ledger_record.run_id,
  };
}

function qualify(role, profileName, profiles, options = {}) {
  const execute = () => executeGovernedRole({
    baseDir: repoRoot,
    projectDir: temporaryProject,
    profileName,
    role,
    prompt: `This is bounded Ocode M3 execution qualification for ${role}. Do not call tools, delegate, or modify files. Return a concise acknowledgement.`,
    pure: true,
    timeout: 120_000,
    catalogCache,
    ...options,
  });
  let result = execute();
  if (!result.success && result.failure_classification === 'INFRASTRUCTURE_FAILURE' && options.retry !== false) {
    infrastructureRetries += 1;
    result = execute();
  }
  const summary = summarizeExecution(result);
  assert.equal(summary.result, 'PASS', `${profileName}/${role} qualification failed: ${JSON.stringify(summary)}`);
  assert.equal(summary.reconciliation, 'MATCH');
  assert.equal(summary.files_changed, 0, `${profileName}/${role} changed files`);
  assert.equal(summary.requested, profiles[profileName].bindings[role]);
  return summary;
}

let failed = false;
try {
  console.log('=== Ocode M3 Acceptance ===\n');
  const m2 = run('npm', ['run', 'acceptance:m2'], { timeout: 240_000 });
  requireSuccess(m2, 'M2 regression');

  const unit = run(process.execPath, ['test/test-execution-profiles.mjs']);
  requireSuccess(unit, 'M3 deterministic tests');

  const doctor = run(process.execPath, ['scripts/doctor.mjs'], { timeout: 60_000 });
  requireSuccess(doctor, 'M3 doctor');

  const installedAgents = resolve(temporaryProject, '.opencode', 'agents');
  mkdirSync(installedAgents, { recursive: true });
  const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
  for (const role of manifest.roles) {
    copyFileSync(resolve(repoRoot, 'agents', role.file), resolve(installedAgents, role.file));
  }
  const gitInit = run('git', ['init', '-q'], { cwd: temporaryProject });
  requireSuccess(gitInit, 'Temporary project Git initialization');

  const profileMap = Object.fromEntries(['free', 'hybrid'].map((name) => [
    name,
    loadBindingProfile(name, { profilesDir: resolve(repoRoot, 'profiles'), manifest }).profile,
  ]));
  assert(Object.values(profileMap.free.bindings).every((binding) => binding.startsWith('freellmapi/')));
  assert.equal(Object.values(profileMap.free.bindings).some((binding) => binding.startsWith('openai/')), false);

  const sourceAgentPaths = manifest.roles.map((role) => resolve(repoRoot, 'agents', role.file));
  const semanticFilesBefore = snapshotFiles(sourceAgentPaths);
  const semanticFingerprintsBefore = Object.fromEntries(
    [...contracts].map(([role, contract]) => [role, contract.contract_fingerprint]),
  );
  const persistentPaths = [
    resolve(homedir(), '.config', 'opencode', 'config.json'),
    resolve(homedir(), '.config', 'opencode', 'opencode.json'),
    resolve(homedir(), '.config', 'opencode', 'opencode.jsonc'),
    resolve(homedir(), '.config', 'ocode', 'config.json'),
  ];
  const persistentBefore = snapshotFiles(persistentPaths);

  const freeQualification = manifest.roles.map((role) => qualify(role.id, 'free', profileMap));
  assert(freeQualification.every((entry) => entry.openai_requested === false));

  const hybridQualification = manifest.roles.map((role) => qualify(role.id, 'hybrid', profileMap));
  assert(hybridQualification.some((entry) => entry.requested.startsWith('openai/')));
  assert(hybridQualification.some((entry) => entry.requested.startsWith('freellmapi/')));

  const finalFree = qualify('planner', 'free', profileMap);
  const switchProof = {
    sequence: ['free', 'hybrid', 'free'],
    profile_fingerprints: [
      fingerprintBindingProfile(profileMap.free),
      fingerprintBindingProfile(profileMap.hybrid),
      fingerprintBindingProfile(profileMap.free),
    ],
    final_free: finalFree,
  };
  assert.equal(switchProof.profile_fingerprints[0], switchProof.profile_fingerprints[2]);
  assert.notEqual(switchProof.profile_fingerprints[0], switchProof.profile_fingerprints[1]);

  const incomplete = { ...profileMap.free, bindings: { ...profileMap.free.bindings } };
  delete incomplete.bindings.reviewer;
  let missingBinding;
  try {
    executeGovernedRole({
      baseDir: repoRoot,
      projectDir: temporaryProject,
      profile: incomplete,
      bindingSource: 'isolated/missing-binding.json',
      role: 'reviewer',
      prompt: 'MUST_NOT_EXECUTE',
      opencode: 'must-not-be-invoked',
      models: [],
    });
  } catch (error) {
    missingBinding = { code: error.code, message: error.message, pre_inference: true, fallback: 'deny' };
  }
  assert.equal(missingBinding.code, 'BINDING_ERROR');
  assert.match(missingBinding.message, /missing governed roles: reviewer/);

  const invalid = { ...profileMap.free, bindings: { ...profileMap.free.bindings, reviewer: 'freellmapi/not-a-real-model' } };
  let invalidModel;
  try {
    executeGovernedRole({
      baseDir: repoRoot,
      projectDir: temporaryProject,
      profile: invalid,
      bindingSource: 'isolated/invalid-model.json',
      role: 'reviewer',
      prompt: 'MUST_NOT_EXECUTE',
      opencode: 'must-not-be-invoked',
      models: catalogCache.get('freellmapi'),
    });
  } catch (error) {
    invalidModel = { code: error.code, message: error.message, details: error.details, pre_inference: true };
  }
  assert.equal(invalidModel.code, 'BINDING_ERROR');
  assert.equal(invalidModel.details.requested, 'freellmapi/not-a-real-model');
  assert.equal(invalidModel.details.fallback, 'deny');

  const badEndpointConfig = JSON.stringify({
    provider: { freellmapi: { options: { baseURL: 'http://127.0.0.1:9/v1' } } },
  });
  const badEndpoint = executeGovernedRole({
    baseDir: repoRoot,
    projectDir: temporaryProject,
    profileName: 'free',
    role: 'committer',
    prompt: 'Return a bounded acknowledgement without tools.',
    pure: true,
    timeout: 30_000,
    retry: false,
    models: catalogCache.get('freellmapi'),
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: badEndpointConfig },
  });
  assert.equal(badEndpoint.success, false);
  assert.equal(badEndpoint.failure_classification, 'INFRASTRUCTURE_FAILURE');
  assert.equal(badEndpoint.resolution.execution_policy.fallback, 'deny');
  assert(badEndpoint.resolution.execution_policy.requested_model.startsWith('freellmapi/'));

  const mismatchFixture = reconcileExecutionBinding(
    {
      execution_policy: { requested_model: 'openai/gpt-5.6-sol' },
    },
    { info: { model: { providerID: 'freellmapi', id: 'auto:review' } } },
  );
  assert.deepEqual(mismatchFixture, {
    requested: 'openai/gpt-5.6-sol',
    effective: 'freellmapi/auto:review',
    state: 'MISMATCH',
  });

  const semanticFilesAfter = snapshotFiles(sourceAgentPaths);
  const semanticFingerprintsAfter = Object.fromEntries(
    [...loadAgentContracts({ baseDir: repoRoot }).contracts].map(([role, contract]) => [role, contract.contract_fingerprint]),
  );
  const persistentAfter = snapshotFiles(persistentPaths);
  assert.deepEqual(semanticFilesAfter, semanticFilesBefore);
  assert.deepEqual(semanticFingerprintsAfter, semanticFingerprintsBefore);
  assert.deepEqual(persistentAfter, persistentBefore);

  const machineFixture = resolve(temporaryProject, 'machine-config.json');
  writeFileSync(machineFixture, JSON.stringify({ profile: 'hybrid' }), 'utf8');
  const cli = resolve(repoRoot, 'packages', 'harness-runtime', 'bin', 'ocode.mjs');
  const cliEnv = {
    ...process.env,
    OCODE_HARNESS_ROOT: repoRoot,
    OCODE_MACHINE_CONFIG: machineFixture,
  };
  const operatorCommands = [
    ['profile'],
    ['profile', 'explain', 'planner'],
    ['profile', 'explain', 'reviewer'],
    ['profile', 'diff', 'free', 'hybrid'],
    ['--profile', 'free', 'profile'],
    ['--profile', 'hybrid', 'profile'],
  ].map((args) => {
    const result = run(process.execPath, [cli, ...args], { cwd: temporaryProject, env: cliEnv });
    requireSuccess(result, `ocode ${args.join(' ')}`);
    return { command: `ocode ${args.join(' ')}`, exit_code: result.exit_code };
  });
  const explainRecord = freeQualification[0];
  const explainRun = run(process.execPath, [cli, 'explain', '--run', explainRecord.run_id], {
    cwd: temporaryProject,
    env: cliEnv,
  });
  requireSuccess(explainRun, `ocode explain --run ${explainRecord.run_id}`);
  assert.match(explainRun.stdout, /RECONCILIATION\nMATCH/);
  operatorCommands.push({ command: 'ocode explain --run <run-id>', exit_code: explainRun.exit_code });

  const normalLaunch = run(process.execPath, [cli, '--profile', 'free', '--help'], {
    cwd: temporaryProject,
    env: cliEnv,
    timeout: 60_000,
  });
  requireSuccess(normalLaunch, 'Normal ocode interactive launch smoke');
  assert.match(normalLaunch.stdout, /EXECUTION PROFILE: free/);

  const ledgerRecords = readRecords(resolve(temporaryProject, '.opencode', 'run-ledger.jsonl'));
  assert(ledgerRecords.length >= freeQualification.length + hybridQualification.length + 2);
  assert(ledgerRecords.some((record) => record.execution_provenance?.binding_reconciliation === 'MATCH'));
  assert(ledgerRecords.some((record) => record.execution_provenance?.failure_classification === 'INFRASTRUCTURE_FAILURE'));

  const evidence = {
    status: 'M3_PROVEN',
    m2_regression: { command: m2.command, exit_code: m2.exit_code },
    deterministic_tests: { command: unit.command, exit_code: unit.exit_code },
    doctor: { command: doctor.command, exit_code: doctor.exit_code },
    design_c: 'OPENCODE_CONFIG_CONTENT -> agent.<role>.model -> opencode run/export',
    profiles: {
      free: { fingerprint: fingerprintBindingProfile(profileMap.free), bindings: profileMap.free.bindings },
      hybrid: { fingerprint: fingerprintBindingProfile(profileMap.hybrid), bindings: profileMap.hybrid.bindings },
    },
    semantic_contract_fingerprints: semanticFingerprintsAfter,
    free_qualification: freeQualification,
    hybrid_qualification: hybridQualification,
    profile_switch: switchProof,
    negative_qualification: {
      missing_binding: missingBinding,
      invalid_model: invalidModel,
      bad_freellmapi_endpoint: summarizeExecution(badEndpoint),
      binding_mismatch: {
        deterministic_detection: mismatchFixture,
        live_managed_conflict: 'UNPROVEN_SAFETY_BOUNDARY',
      },
    },
    ledger: {
      path: '(temporary project removed)',
      records: ledgerRecords.length,
      explain_run_id: explainRecord.run_id,
    },
    operator_commands: operatorCommands,
    normal_launcher: { command: 'ocode --profile free --help', exit_code: normalLaunch.exit_code },
    persistent_opencode_and_ocode_config_preserved: true,
    semantic_agent_files_preserved: true,
    infrastructure_retries: infrastructureRetries,
    m4_ready: true,
    temporary_project: process.env.OCODE_M3_KEEP_TEMP === '1' ? temporaryProject : '(removed)',
  };
  console.log(JSON.stringify(evidence, null, 2));
  console.log('\n✓ M3 acceptance passed');
} catch (error) {
  failed = true;
  console.error(`\n✗ M3 acceptance failed: ${error.message}`);
  if (error.stack) console.error(error.stack);
} finally {
  if (process.env.OCODE_M3_KEEP_TEMP !== '1') rmSync(temporaryProject, { recursive: true, force: true });
  else console.log(`Temporary evidence retained at ${temporaryProject}`);
}

if (failed) process.exit(1);
