#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../lib/agent-contract.mjs';
import { readMachineConfig } from '../lib/deploy.mjs';
import { getRecordByRunId } from '../lib/ledger.mjs';
import {
  ADMISSION_KINDS,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  evaluateAdmission,
  evaluateContractAdmission,
} from '../lib/admission.mjs';
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

/** Enforce the runtime pin only when this release carries a compatibility contract. */
function assertRuntimeCompatibility(harnessRoot) {
  const path = resolve(harnessRoot, 'runtime-compatibility.json');
  if (!existsSync(path)) return;
  let compatibility;
  try {
    compatibility = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`OCODE_RUNTIME_COMPATIBILITY_INVALID: cannot read ${path}`);
  }
  const required = compatibility?.opencode?.required_version;
  const supported = compatibility?.platform?.supported;
  const minimumNode = compatibility?.node?.minimum_major;
  if (typeof required !== 'string' || !Array.isArray(supported) || !Number.isInteger(minimumNode)) {
    throw new Error('OCODE_RUNTIME_COMPATIBILITY_INVALID: required OpenCode, platform, or Node declaration is missing');
  }
  if (!supported.includes(`${process.platform} ${process.arch}`)) {
    throw new Error(`OCODE_RUNTIME_PLATFORM_UNSUPPORTED: ${process.platform} ${process.arch}; supported: ${supported.join(', ')}`);
  }
  if (Number(process.versions.node.split('.')[0]) < minimumNode) {
    throw new Error(`OCODE_RUNTIME_NODE_UNSUPPORTED: requires Node >=${minimumNode}; found ${process.versions.node}`);
  }
  const version = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  const found = version.error ? null : version.stdout.trim();
  if (version.status !== 0 || found !== required) {
    throw new Error(`OCODE_RUNTIME_OPENCODE_VERSION_MISMATCH: requires ${required}; found ${found || 'unavailable'}. Install the pinned version, then rerun ocode.`);
  }
}

function loadGovernanceContext() {
  const harnessRoot = findHarnessRoot();
  return { harnessRoot, ...loadAgentContracts({ baseDir: harnessRoot }) };
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
  console.log(`ADMITTED SUBJECT\n${provenance.admitted_subject ?? 'NOT_RECORDED'}\n`);
  console.log(`EFFECTIVE SUBJECT\n${provenance.effective_subject ?? 'UNKNOWN'}\n`);
  console.log(`SUBJECT RECONCILIATION\n${provenance.subject_reconciliation ?? 'NOT_RECORDED'}\n`);
  console.log(`SUBJECT REASON\n${provenance.subject_reason_code ?? 'NOT_RECORDED'}\n`);
  console.log(`RESULT\n${provenance.success ? 'SUCCESS' : 'FAILURE'}`);
  if (provenance.failure_classification) {
    console.log(`\nFAILURE CLASSIFICATION\n${provenance.failure_classification}`);
  }
}

function emptyAuthority() {
  return { edit: false, stage: false, commit: false, push: false };
}

function requireContract(context, role) {
  const contract = context.contracts.get(role);
  if (!contract || !context.manifest.roles.some((entry) => entry.id === role)) {
    throw new Error(`Unknown governed role: ${role}`);
  }
  return contract;
}

function parseGovernCheckArguments(args) {
  const requirements = [];
  const requestedAuthority = emptyAuthority();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--requires') {
      const next = args[++index];
      if (!next || next.startsWith('-') || next.split(',').some((item) => !item)) {
        throw new Error('--requires requires a comma-separated capability list');
      }
      requirements.push(...next.split(','));
    } else if (value.startsWith('--requires=')) {
      const requested = value.slice('--requires='.length);
      if (!requested || requested.split(',').some((item) => !item)) throw new Error('--requires requires a comma-separated capability list');
      requirements.push(...requested.split(','));
    } else if (['--edit', '--stage', '--commit', '--push'].includes(value)) {
      requestedAuthority[value.slice(2)] = true;
    } else {
      throw new Error(`Unknown govern check option: ${value}`);
    }
  }
  return { requirements, requestedAuthority };
}

function assignmentDecision(context, role, { requirements = [], requestedAuthority = emptyAuthority() } = {}) {
  const contract = requireContract(context, role);
  return evaluateAdmission({
    contract,
    request: {
      schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
      kind: ADMISSION_KINDS.ASSIGNMENT,
      subject: { role },
      requirements: { capabilities: requirements },
      requested_authority: requestedAuthority,
    },
  });
}

function printDecision(decision) {
  console.log(`DECISION\n${decision.decision}\n`);
  console.log(`REQUIREMENTS\n${decision.requirements.capabilities.join(', ') || 'none'}\n`);
  console.log(`CAPABILITY EVALUATION\n${decision.capability_evaluation.status}\n`);
  console.log(`AUTHORITY EVALUATION\n${decision.authority_evaluation.status}\n`);
  console.log(`PERMISSION EVALUATION\n${decision.permission_evaluation.status}\n`);
  console.log(`IDENTITY STATE\n${decision.identity_state}\n`);
  console.log(`GOVERNANCE STATE\n${decision.governance_state}\n`);
  console.log(`REASON CODES\n${decision.reason_codes.join(', ')}`);
}

function printProjection(projection) {
  console.log('\nPERMISSION PROJECTION');
  for (const operation of Object.values(projection.operations)) {
    console.log(`${operation.operation}: ${operation.state} (${operation.source}; ${operation.evidence.join('; ')})`);
  }
  for (const [operation, state] of Object.entries(projection.not_projected)) {
    console.log(`${operation}: ${state}`);
  }
}

function govern(context, args) {
  const [command, role, ...options] = args;
  if (command === 'explain' && role && options.length === 0) {
    const contract = requireContract(context, role);
    const decision = evaluateContractAdmission(contract);
    console.log(`ROLE\n${role}\n`);
    console.log(`CAPABILITIES\n${contract.capabilities.provides.join(', ')}\n`);
    console.log(`AUTHORITY\nedit=${contract.authority.may_edit}, stage=${contract.authority.may_stage}, commit=${contract.authority.may_commit}, push=${contract.authority.may_push}`);
    printProjection(decision.permission_evaluation.projection);
    console.log('');
    console.log(`BASELINE / CONTRACT ADMISSION\n${decision.decision}\n`);
    printDecision(decision);
    return decision;
  }
  if (command === 'check' && role) {
    const contract = requireContract(context, role);
    const decision = options.length === 0
      ? evaluateContractAdmission(contract)
      : assignmentDecision(context, role, parseGovernCheckArguments(options));
    console.log(`ROLE\n${role}\n`);
    printDecision(decision);
    return decision;
  }
  if (command === 'audit' && !role) {
    let hasDenial = false;
    console.log(`${pad('ROLE', 14)}${pad('IDENTITY', 22)}${pad('GOVERNANCE', 14)}ADMISSION`);
    for (const entry of context.manifest.roles) {
      const decision = evaluateContractAdmission(requireContract(context, entry.id));
      if (decision.decision === 'DENY') hasDenial = true;
      console.log(`${pad(entry.id, 14)}${pad(decision.identity_state, 22)}${pad(decision.governance_state, 14)}${decision.decision}`);
      if (decision.reason_codes.some((reason) => !['CONTRACT_VALID', 'REQUIRED_CAPABILITIES_SATISFIED', 'AUTHORITY_COMPATIBLE', 'PERMISSION_PROJECTION_COMPATIBLE', 'IDENTITY_UNREFERENCED'].includes(reason))) {
        console.log(`  reasons: ${decision.reason_codes.join(', ')}`);
      }
    }
    return { decision: hasDenial ? 'DENY' : 'ALLOW' };
  }
  throw new Error('Usage: ocode govern explain <role> | ocode govern check <role> [--requires capability[,capability]] [--edit] [--stage] [--commit] [--push] | ocode govern audit');
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

  if (remaining[0] === 'govern') {
    const decision = govern(loadGovernanceContext(), remaining.slice(1));
    if (decision?.decision === 'DENY') process.exitCode = 1;
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

  assertRuntimeCompatibility(context.harnessRoot);
  validateProfileCompleteness(context.profile, context.manifest);
  validateProfileAvailability(context.profile, {
    cwd: process.cwd(),
    env: process.env,
  });
  const projectRoot = orientProject();
  const overlayConfig = JSON.parse(serializeOpenCodeRuntimeOverlay(context.profile, process.env.OPENCODE_CONFIG_CONTENT));
  const overlay = JSON.stringify(overlayConfig);
  console.log(`=== EXECUTION PROFILE: ${context.profile.name} (${short(fingerprintBindingProfile(context.profile))}) ===\n`);
  const result = spawnSync('opencode', remaining, {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENCODE_ENABLE_EXA: '1',
      OCODE_HARNESS_ROOT: context.harnessRoot,
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
