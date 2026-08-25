import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const OCODE_BINDING_PROFILE_SCHEMA_VERSION = 1;
export const EXECUTION_RESOLUTION_SCHEMA_VERSION = 1;
export const SUBJECT_RECONCILIATION_SCHEMA_VERSION = 1;
export const FALLBACK_POLICY = 'deny';

export const SUBJECT_RECONCILIATION_STATES = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  UNKNOWN: 'UNKNOWN',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class BindingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BindingError';
    this.code = 'BINDING_ERROR';
    this.details = details;
  }
}

export function splitModelReference(value, label = 'Model binding') {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new BindingError(`${label} must be a non-empty provider/model string`);
  }
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    throw new BindingError(`${label} must use provider/model format`);
  }
  return { provider: value.slice(0, separator), model: value.slice(separator + 1), reference: value };
}

export function validateBindingProfile(profile) {
  if (!isPlainObject(profile)) throw new BindingError('Binding profile must be an object');
  const allowedKeys = new Set(['schema_version', 'name', 'policy_version', 'bindings']);
  for (const key of Object.keys(profile)) {
    if (!allowedKeys.has(key)) throw new BindingError(`Unknown binding profile field: ${key}`);
  }
  if (profile.schema_version !== OCODE_BINDING_PROFILE_SCHEMA_VERSION) {
    throw new BindingError(
      `Binding profile schema_version must be ${OCODE_BINDING_PROFILE_SCHEMA_VERSION}`,
      { schema_version: profile.schema_version },
    );
  }
  if (typeof profile.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(profile.name)) {
    throw new BindingError('Binding profile name must use lowercase letters, numbers, underscores, or hyphens');
  }
  if (!Number.isInteger(profile.policy_version) || profile.policy_version < 1) {
    throw new BindingError('Binding profile policy_version must be a positive integer');
  }
  if (!isPlainObject(profile.bindings) || Object.keys(profile.bindings).length === 0) {
    throw new BindingError('Binding profile bindings must be a non-empty object');
  }
  for (const [role, model] of Object.entries(profile.bindings)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(role)) throw new BindingError(`Invalid semantic role id: ${role}`);
    splitModelReference(model, `Binding for ${role}`);
  }
  return profile;
}

export function validateProfileCompleteness(profile, manifest) {
  validateBindingProfile(profile);
  if (!manifest || !Array.isArray(manifest.roles)) throw new BindingError('A validated role manifest is required');
  const governed = manifest.roles.map((role) => role.id);
  const governedSet = new Set(governed);
  const profileRoles = Object.keys(profile.bindings);
  const missing = governed.filter((role) => !Object.prototype.hasOwnProperty.call(profile.bindings, role));
  const unknown = profileRoles.filter((role) => !governedSet.has(role)).sort(compareCodePoints);
  if (missing.length > 0 || unknown.length > 0) {
    const problems = [];
    if (missing.length > 0) problems.push(`missing governed roles: ${missing.join(', ')}`);
    if (unknown.length > 0) problems.push(`unknown roles: ${unknown.join(', ')}`);
    throw new BindingError(`Profile ${profile.name} is incomplete: ${problems.join('; ')}`, {
      profile: profile.name,
      missing_roles: missing,
      unknown_roles: unknown,
    });
  }
  return profile;
}

export function loadBindingProfile(profileName, { profilesDir, manifest } = {}) {
  if (typeof profileName !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(profileName)) {
    throw new BindingError(`Unknown profile: ${String(profileName)}`);
  }
  if (!profilesDir) throw new BindingError('profilesDir is required to load a binding profile');
  const profilePath = resolve(profilesDir, `${profileName}.json`);
  if (!existsSync(profilePath)) {
    throw new BindingError(`Unknown profile: ${profileName}`, { profile: profileName, source: profilePath });
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch (err) {
    throw new BindingError(`Malformed profile ${profileName} at ${profilePath}: ${err.message}`);
  }
  validateBindingProfile(profile);
  if (profile.name !== profileName) {
    throw new BindingError(`Profile filename ${profileName}.json does not match profile name ${profile.name}`);
  }
  if (manifest) validateProfileCompleteness(profile, manifest);
  return { profile, source: profilePath };
}

export function selectProfileName({ override, machineConfig }) {
  const selected = override || machineConfig?.profile;
  if (typeof selected !== 'string' || !selected) {
    throw new BindingError('No execution profile selected by launch override or machine config');
  }
  return selected;
}

export function getRoleBinding(profile, role) {
  validateBindingProfile(profile);
  if (typeof role !== 'string' || !role) throw new BindingError('Semantic role must be a non-empty string');
  const binding = profile.bindings[role];
  if (!binding) {
    throw new BindingError(`Profile ${profile.name} has no binding for semantic role ${role}`, {
      profile: profile.name,
      role,
    });
  }
  return binding;
}

export function buildOpenCodeRuntimeOverlay(profile) {
  validateBindingProfile(profile);
  const agent = {};
  for (const role of Object.keys(profile.bindings).sort(compareCodePoints)) {
    agent[role] = { model: profile.bindings[role] };
  }
  return { agent };
}

export function mergeOpenCodeRuntimeOverlay(profile, existingConfigContent) {
  const overlay = buildOpenCodeRuntimeOverlay(profile);
  let existing = {};
  if (existingConfigContent !== undefined && existingConfigContent !== null && existingConfigContent !== '') {
    try {
      existing = JSON.parse(existingConfigContent);
    } catch (err) {
      throw new BindingError(`Existing OPENCODE_CONFIG_CONTENT is malformed JSON: ${err.message}`);
    }
    if (!isPlainObject(existing)) throw new BindingError('Existing OPENCODE_CONFIG_CONTENT must be a JSON object');
  }
  const merged = structuredClone(existing);
  if (merged.agent !== undefined && !isPlainObject(merged.agent)) {
    throw new BindingError('Existing OPENCODE_CONFIG_CONTENT agent field must be an object');
  }
  merged.agent = { ...(merged.agent || {}) };
  for (const [role, owned] of Object.entries(overlay.agent)) {
    const existingRole = merged.agent[role];
    if (existingRole !== undefined && !isPlainObject(existingRole)) {
      throw new BindingError(`Existing OPENCODE_CONFIG_CONTENT agent.${role} must be an object`);
    }
    merged.agent[role] = { ...(existingRole || {}), ...owned };
  }
  return merged;
}

export function serializeOpenCodeRuntimeOverlay(profile, existingConfigContent) {
  return JSON.stringify(mergeOpenCodeRuntimeOverlay(profile, existingConfigContent));
}

export function fingerprintBindingProfile(profile) {
  validateBindingProfile(profile);
  return createHash('sha256').update(canonicalJSONStringify(profile)).digest('hex');
}

export function createExecutionResolution({ role, contract, profile, bindingSource }) {
  validateBindingProfile(profile);
  if (!contract || contract.id !== role) {
    throw new BindingError(`Unknown governed semantic role: ${role}`, { role, profile: profile.name });
  }
  const requestedModel = getRoleBinding(profile, role);
  splitModelReference(requestedModel, `Binding for ${role}`);
  return {
    schema_version: EXECUTION_RESOLUTION_SCHEMA_VERSION,
    subject: {
      role,
      contract_fingerprint: contract.contract_fingerprint,
    },
    execution_policy: {
      profile: profile.name,
      policy_version: profile.policy_version,
      profile_fingerprint: fingerprintBindingProfile(profile),
      requested_model: requestedModel,
      binding_source: bindingSource,
      fallback: FALLBACK_POLICY,
    },
    validation: {
      status: 'PASS',
    },
  };
}

export function assertModelAvailable(resolution, models) {
  const requested = resolution?.execution_policy?.requested_model;
  if (!Array.isArray(models) || !models.includes(requested)) {
    throw new BindingError(`Requested model is not available: ${requested}`, {
      role: resolution?.subject?.role,
      profile: resolution?.execution_policy?.profile,
      requested,
      fallback: FALLBACK_POLICY,
      problem: 'model not available',
    });
  }
  return resolution;
}

export function effectiveBindingFromExport(exported) {
  const provider = exported?.info?.model?.providerID;
  const model = exported?.info?.model?.id;
  if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return null;
  return `${provider}/${model}`;
}

export function reconcileExecutionBinding(resolution, exported) {
  const requested = resolution?.execution_policy?.requested_model || null;
  const effective = effectiveBindingFromExport(exported);
  const state = effective === null ? 'UNKNOWN' : effective === requested ? 'MATCH' : 'MISMATCH';
  return { requested, effective, state };
}

/**
 * Extracts only agent identity carried by the sanitized OpenCode export. It
 * deliberately does not consult requested role, overlays, profiles, or model
 * bindings: absent observed evidence remains null.
 */
export function effectiveSubjectFromExport(exported) {
  const agent = exported?.info?.agent;
  if (typeof agent === 'string' && agent) return agent;
  if (isPlainObject(agent)) {
    for (const key of ['id', 'name']) {
      if (typeof agent[key] === 'string' && agent[key]) return agent[key];
    }
  }
  return null;
}

export function reconcileExecutionSubject(admittedSubject, exported) {
  if (typeof admittedSubject !== 'string' || !admittedSubject) {
    throw new BindingError('Admitted semantic subject must be a non-empty string');
  }
  const effectiveSubject = effectiveSubjectFromExport(exported);
  const state = effectiveSubject === null
    ? SUBJECT_RECONCILIATION_STATES.UNKNOWN
    : effectiveSubject === admittedSubject
      ? SUBJECT_RECONCILIATION_STATES.MATCH
      : SUBJECT_RECONCILIATION_STATES.MISMATCH;
  return {
    schema_version: SUBJECT_RECONCILIATION_SCHEMA_VERSION,
    admitted_subject: admittedSubject,
    effective_subject: effectiveSubject,
    state,
    reason_code: `SUBJECT_${state}`,
  };
}
