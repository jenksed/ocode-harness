#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../lib/agent-contract.mjs';
import { readMachineConfig } from '../lib/deploy.mjs';
import { getRecordByRunId } from '../lib/ledger.mjs';
import {
  BindingError,
  createExecutionResolution,
  fingerprintBindingProfile,
  loadBindingProfile,
  selectProfileName,
  serializeOpenCodeRuntimeOverlay,
  validateProfileCompleteness,
} from '../lib/opencode-integration.mjs';
import { validateProfileAvailability } from '../lib/execution.mjs';

const __filename = fileURLToPath(import.meta.url);

function findHarnessRoot(start = dirname(__filename)) {
  if (process.env.OCODE_HARNESS_ROOT) return resolve(process.env.OCODE_HARNESS_ROOT);
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, 'profiles')) && existsSync(resolve(current, 'agents', 'manifest.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Could not locate Ocode profiles and agent manifest');
    current = parent;
  }
}

function extractProfileOverride(args) {
  const remaining = [];
  let override;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--profile') {
      const next = args[++index];
      if (!next || next.startsWith('-')) throw new BindingError('--profile requires a profile name');
      if (override) throw new BindingError('--profile may be specified only once');
      override = next;
    } else if (value.startsWith('--profile=')) {
      if (override) throw new BindingError('--profile may be specified only once');
      override = value.slice('--profile='.length);
    } else {
      remaining.push(value);
    }
  }
  return { override, remaining };
}

function loadContext(profileOverride) {
  const harnessRoot = findHarnessRoot();
  const machineConfigPath = process.env.OCODE_MACHINE_CONFIG
    || resolve(homedir(), '.config', 'ocode', 'config.json');
  const machineConfig = readMachineConfig(machineConfigPath);
  const profileName = selectProfileName({ override: profileOverride, machineConfig });
  const { manifest, contracts } = loadAgentContracts({ baseDir: harnessRoot });
  const loaded = loadBindingProfile(profileName, {
    profilesDir: resolve(harnessRoot, 'profiles'),
    manifest,
  });
  return { harnessRoot, machineConfig, profileName, manifest, contracts, ...loaded };
}

function short(value) {
  return value.slice(0, 12);
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function printProfile(context) {
  console.log(`Active profile: ${context.profile.name}`);
  console.log(`Policy version: ${context.profile.policy_version}`);
  console.log(`Fingerprint: ${short(fingerprintBindingProfile(context.profile))}`);
  console.log('');
  console.log(`${pad('ROLE', 14)}REQUESTED BINDING`);
  for (const role of context.manifest.roles) {
    console.log(`${pad(role.id, 14)}${context.profile.bindings[role.id]}`);
  }
}

function explainRole(context, role) {
  const contract = context.contracts.get(role);
  const resolution = createExecutionResolution({
    role,
    contract,
    profile: context.profile,
    bindingSource: `profiles/${context.profile.name}.json`,
  });
  console.log(`ROLE\n${role}\n`);
  console.log(`SEMANTIC CONTRACT\nagents/${contract.file}\n`);
  console.log(`CONTRACT FINGERPRINT\n${contract.contract_fingerprint}\n`);
  console.log(`PROFILE\n${resolution.execution_policy.profile}\n`);
  console.log(`POLICY VERSION\n${resolution.execution_policy.policy_version}\n`);
  console.log(`PROFILE FINGERPRINT\n${resolution.execution_policy.profile_fingerprint}\n`);
  console.log(`REQUESTED BINDING\n${resolution.execution_policy.requested_model}\n`);
  console.log(`SOURCE\n${resolution.execution_policy.binding_source}\n`);
  console.log(`FALLBACK\n${resolution.execution_policy.fallback}\n`);
  console.log(`VALIDATION\n${resolution.validation.status}`);
}

function diffProfiles(harnessRoot, manifest, leftName, rightName) {
  const profilesDir = resolve(harnessRoot, 'profiles');
  const left = loadBindingProfile(leftName, { profilesDir, manifest }).profile;
  const right = loadBindingProfile(rightName, { profilesDir, manifest }).profile;
  console.log(`${pad('ROLE', 14)}${pad(left.name.toUpperCase(), 36)}${right.name.toUpperCase()}`);
  for (const role of manifest.roles) {
    const leftBinding = left.bindings[role.id];
    const rightBinding = right.bindings[role.id];
    console.log(`${pad(role.id, 14)}${pad(leftBinding, 36)}${leftBinding === rightBinding ? 'SAME' : rightBinding}`);
  }
}

function findProjectRoot(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, '.opencode'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function explainRun(runID) {
  const projectRoot = findProjectRoot(process.cwd());
  const record = getRecordByRunId(resolve(projectRoot, '.opencode', 'run-ledger.jsonl'), runID);
  if (!record) throw new Error(`Run not found in project ledger: ${runID}`);
  const provenance = record.execution_provenance;
  if (!provenance) throw new Error(`Run ${runID} has no M3 execution provenance`);
  console.log(`RUN\n${runID}\n`);
  console.log(`ROLE\n${provenance.subject.role}\n`);
  console.log(`CONTRACT FINGERPRINT\n${provenance.subject.contract_fingerprint}\n`);
  console.log(`PROFILE\n${provenance.execution_policy.profile}\n`);
  console.log(`POLICY VERSION\n${provenance.execution_policy.policy_version}\n`);
  console.log(`PROFILE FINGERPRINT\n${provenance.execution_policy.profile_fingerprint}\n`);
  console.log(`REQUESTED BINDING\n${provenance.execution_policy.requested_model}\n`);
  console.log(`EFFECTIVE BINDING\n${provenance.effective_model || 'UNKNOWN'}\n`);
  console.log(`RECONCILIATION\n${provenance.binding_reconciliation}\n`);
  console.log(`RESULT\n${provenance.success ? 'SUCCESS' : 'FAILURE'}`);
  if (provenance.failure_classification) {
    console.log(`\nFAILURE CLASSIFICATION\n${provenance.failure_classification}`);
  }
}

function orientProject() {
  const requested = process.cwd();
  console.log('=== PROJECT ORIENTATION ===');
  const result = spawnSync('orient', [requested], { stdio: 'inherit', env: process.env });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`Project orientation failed${result.error ? `: ${result.error.message}` : ''}`);
  }
  let current = requested;
  while (true) {
    if (existsSync(resolve(current, '.opencode', 'orientation.json'))
      && existsSync(resolve(current, '.opencode', 'orientation.md'))) {
      console.log('=== ORIENTATION READY ===');
      console.log(`project root: ${current}`);
      console.log(`context:      ${resolve(current, '.opencode', 'orientation.md')}\n`);
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Orientation completed but no orientation artifact was found');
    current = parent;
  }
}

function printBindingError(error) {
  console.error(error.code || 'BINDING_ERROR');
  const details = error.details || {};
  if (details.role) console.error(`role: ${details.role}`);
  if (details.profile) console.error(`profile: ${details.profile}`);
  if (details.requested) console.error(`requested: ${details.requested}`);
  console.error(`problem: ${details.problem || error.message}`);
  console.error(`fallback: ${details.fallback || 'deny'}`);
}

async function main() {
  const { override, remaining } = extractProfileOverride(process.argv.slice(2));
  if (remaining[0] === 'explain' && remaining[1] === '--run') {
    if (!remaining[2]) throw new Error('ocode explain --run requires a run ID');
    explainRun(remaining[2]);
    return;
  }

  const context = loadContext(override);
  if (remaining[0] === 'profile') {
    if (remaining.length === 1) {
      printProfile(context);
      return;
    }
    if (remaining[1] === 'explain' && remaining[2] && remaining.length === 3) {
      explainRole(context, remaining[2]);
      return;
    }
    if (remaining[1] === 'diff' && remaining[2] && remaining[3] && remaining.length === 4) {
      diffProfiles(context.harnessRoot, context.manifest, remaining[2], remaining[3]);
      return;
    }
    throw new Error('Usage: ocode profile | ocode profile explain <role> | ocode profile diff <left> <right>');
  }

  validateProfileCompleteness(context.profile, context.manifest);
  validateProfileAvailability(context.profile, {
    cwd: process.cwd(),
    env: process.env,
  });
  const projectRoot = orientProject();
  const overlay = serializeOpenCodeRuntimeOverlay(context.profile, process.env.OPENCODE_CONFIG_CONTENT);
  console.log(`=== EXECUTION PROFILE: ${context.profile.name} (${short(fingerprintBindingProfile(context.profile))}) ===\n`);
  const result = spawnSync('opencode', remaining, {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENCODE_ENABLE_EXA: '1',
      OPENCODE_CONFIG_CONTENT: overlay,
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`OpenCode terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}

try {
  await main();
} catch (error) {
  if (error instanceof BindingError || error.code === 'BINDING_ERROR') printBindingError(error);
  else console.error(`OCODE_ERROR: ${error.message}`);
  process.exitCode = 1;
}
