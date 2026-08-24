import { createHash } from 'node:crypto';

export const OCODE_BINDING_PROFILE_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertModelReference(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new Error(`${label} must be a non-empty provider/model string`);
  }

  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${label} must use provider/model format`);
  }
}

export function validateBindingProfile(profile) {
  if (!isPlainObject(profile)) {
    throw new Error('Binding profile must be an object');
  }
  const allowedKeys = new Set(['schema_version', 'name', 'bindings']);
  for (const key of Object.keys(profile)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown binding profile field: ${key}`);
    }
  }
  if (profile.schema_version !== OCODE_BINDING_PROFILE_SCHEMA_VERSION) {
    throw new Error(
      `Binding profile schema_version must be ${OCODE_BINDING_PROFILE_SCHEMA_VERSION}`,
    );
  }
  if (typeof profile.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(profile.name)) {
    throw new Error('Binding profile name must use lowercase letters, numbers, underscores, or hyphens');
  }
  if (!isPlainObject(profile.bindings) || Object.keys(profile.bindings).length === 0) {
    throw new Error('Binding profile bindings must be a non-empty object');
  }

  for (const [role, model] of Object.entries(profile.bindings)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(role)) {
      throw new Error(`Invalid semantic role id: ${role}`);
    }
    assertModelReference(model, `Binding for ${role}`);
  }

  return profile;
}

export function getRoleBinding(profile, role) {
  validateBindingProfile(profile);
  const binding = profile.bindings[role];
  if (!binding) {
    throw new Error(`Profile ${profile.name} has no binding for semantic role ${role}`);
  }
  return binding;
}

export function buildOpenCodeRuntimeOverlay(profile) {
  validateBindingProfile(profile);

  const agent = {};
  for (const role of Object.keys(profile.bindings).sort()) {
    agent[role] = { model: profile.bindings[role] };
  }

  return { agent };
}

export function serializeOpenCodeRuntimeOverlay(profile) {
  return JSON.stringify(buildOpenCodeRuntimeOverlay(profile));
}

export function fingerprintBindingProfile(profile) {
  validateBindingProfile(profile);
  const canonical = {
    schema_version: profile.schema_version,
    name: profile.name,
    bindings: Object.fromEntries(
      Object.entries(profile.bindings).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      )),
    ),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
