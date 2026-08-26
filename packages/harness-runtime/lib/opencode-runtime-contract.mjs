import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const OPENCODE_RUNTIME_CONTRACT_SCHEMA_VERSION = 1;
export const OPENCODE_RUNTIME_CONTRACT_VERSION = 1;
export const RUNTIME_CAPABILITY_STATES = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  UNKNOWN: 'UNKNOWN',
});
export const RUNTIME_QUALIFICATION_STATUSES = Object.freeze({
  COMPATIBLE: 'COMPATIBLE',
  COMPATIBLE_WITH_DEGRADATION: 'COMPATIBLE_WITH_DEGRADATION',
  INCOMPATIBLE: 'INCOMPATIBLE',
  UNQUALIFIED: 'UNQUALIFIED',
});

export const REQUIRED_RUNTIME_CAPABILITIES = Object.freeze([
  'server_start', 'sdk_endpoint', 'session_create', 'event_subscribe',
  'prompt_submit', 'session_completion', 'session_abort', 'clean_shutdown',
  'permission_request', 'permission_request_identity', 'permission_reply_once',
  'permission_reject', 'same_session_resume', 'rejection_semantics',
]);
export const OPTIONAL_RUNTIME_CAPABILITIES = Object.freeze([
  'permission_reply_session', 'bash_metadata', 'edit_metadata', 'external_directory_metadata',
  'web_metadata', 'skill_metadata', 'task_metadata', 'interactive_permission_parity',
]);

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function state(value, label) {
  if (!Object.values(RUNTIME_CAPABILITY_STATES).includes(value)) throw new Error(`${label} must be a runtime capability state`);
  return value;
}
function capabilitySet(value, names, label) {
  if (!plain(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...names].sort();
  if (actual.join('\0') !== expected.join('\0')) throw new Error(`${label} must contain exactly the runtime contract capabilities`);
  return Object.fromEntries(names.map((name) => [name, state(value[name], `${label}.${name}`)]));
}

export function createOpenCodeRuntimeIdentity({ executablePath, executableVersion, sdkPackagePath, sdkVersion }) {
  if (typeof executablePath !== 'string' || !executablePath) throw new Error('executablePath is required');
  if (typeof executableVersion !== 'string' || !executableVersion) throw new Error('executableVersion is required');
  if (typeof sdkPackagePath !== 'string' || !sdkPackagePath) throw new Error('sdkPackagePath is required');
  if (typeof sdkVersion !== 'string' || !sdkVersion) throw new Error('sdkVersion is required');
  return {
    name: 'opencode', executable_path: executablePath, executable_version: executableVersion,
    executable_fingerprint: existsSync(executablePath) ? sha256File(executablePath) : null,
    sdk_package_path: sdkPackagePath, sdk_version: sdkVersion,
    sdk_package_fingerprint: existsSync(sdkPackagePath) ? sha256File(sdkPackagePath) : null,
  };
}

export function qualifyOpenCodeRuntime({ runtime, required, optional, observations = [] }) {
  if (!plain(runtime) || runtime.name !== 'opencode') throw new Error('runtime must be an OpenCode runtime identity');
  const normalizedRequired = capabilitySet(required, REQUIRED_RUNTIME_CAPABILITIES, 'required');
  const normalizedOptional = capabilitySet(optional, OPTIONAL_RUNTIME_CAPABILITIES, 'optional');
  if (!Array.isArray(observations) || observations.some((item) => !plain(item) || typeof item.id !== 'string' || typeof item.kind !== 'string')) {
    throw new Error('observations must be structured evidence records');
  }
  const requiredStates = Object.values(normalizedRequired);
  const optionalStates = Object.values(normalizedOptional);
  const qualificationStatus = requiredStates.includes(RUNTIME_CAPABILITY_STATES.UNKNOWN)
    ? RUNTIME_QUALIFICATION_STATUSES.UNQUALIFIED
    : requiredStates.includes(RUNTIME_CAPABILITY_STATES.UNSUPPORTED)
      ? RUNTIME_QUALIFICATION_STATUSES.INCOMPATIBLE
      : optionalStates.includes(RUNTIME_CAPABILITY_STATES.UNKNOWN) || optionalStates.includes(RUNTIME_CAPABILITY_STATES.UNSUPPORTED)
        ? RUNTIME_QUALIFICATION_STATUSES.COMPATIBLE_WITH_DEGRADATION
        : RUNTIME_QUALIFICATION_STATUSES.COMPATIBLE;
  return {
    schema_version: OPENCODE_RUNTIME_CONTRACT_SCHEMA_VERSION,
    contract_version: OPENCODE_RUNTIME_CONTRACT_VERSION,
    runtime: structuredClone(runtime), qualification_status: qualificationStatus,
    required: normalizedRequired, optional: normalizedOptional,
    observations: structuredClone(observations),
  };
}

export function qualificationInvalidationReasons({ previous, currentRuntime, contractVersion = OPENCODE_RUNTIME_CONTRACT_VERSION, adapterFingerprint = null }) {
  if (!previous) return ['NO_PRIOR_QUALIFICATION'];
  const reasons = [];
  if (previous.contract_version !== contractVersion) reasons.push('RUNTIME_CONTRACT_CHANGED');
  for (const key of ['executable_fingerprint', 'sdk_package_fingerprint']) {
    if (previous.runtime?.[key] !== currentRuntime?.[key]) reasons.push(`${key.toUpperCase()}_CHANGED`);
  }
  if (previous.adapter_fingerprint !== adapterFingerprint) reasons.push('COMPATIBILITY_ADAPTER_CHANGED');
  return reasons;
}
