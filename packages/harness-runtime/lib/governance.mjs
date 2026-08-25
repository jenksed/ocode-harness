import { createHash } from 'node:crypto';

export const CAPABILITY_SCHEMA_VERSION = 1;

export const CAPABILITY_IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export const CAPABILITY_VOCABULARY = Object.freeze({
  schema_version: CAPABILITY_SCHEMA_VERSION,
  capabilities: Object.freeze([
    Object.freeze({ id: 'closeout.evaluate', description: 'Evaluate bounded semantic closeout evidence.' }),
    Object.freeze({ id: 'command.execute', description: 'Execute commands within the role runtime constraints.' }),
    Object.freeze({ id: 'implementation.change', description: 'Implement bounded engineering changes.' }),
    Object.freeze({ id: 'judgment.adjudicate', description: 'Adjudicate a specific technical disagreement.' }),
    Object.freeze({ id: 'orchestration.coordinate', description: 'Coordinate governed engineering roles and evidence.' }),
    Object.freeze({ id: 'planning.decompose', description: 'Decompose engineering work into an implementation plan.' }),
    Object.freeze({ id: 'repository.edit', description: 'Edit repository files when separately authorized.' }),
    Object.freeze({ id: 'repository.read', description: 'Inspect repository files and state.' }),
    Object.freeze({ id: 'research.investigate', description: 'Investigate an external technical question.' }),
    Object.freeze({ id: 'review.evaluate', description: 'Evaluate implementation evidence and repository changes.' }),
    Object.freeze({ id: 'test.execute', description: 'Execute repository-defined validation commands.' }),
    Object.freeze({ id: 'uncertainty.assess', description: 'Assess planning-blocking uncertainty and required evidence.' }),
    Object.freeze({ id: 'verification.validate', description: 'Independently validate requested engineering properties.' }),
    Object.freeze({ id: 'web.research', description: 'Research current external sources.' }),
  ]),
});

export const IDENTITY_STATES = Object.freeze({
  MATCHES_REFERENCE: 'MATCHES_REFERENCE',
  DRIFTED: 'DRIFTED',
  UNREFERENCED: 'UNREFERENCED',
});

export const GOVERNANCE_STATES = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
});

export const ADMISSION_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${label} field: ${key}`);
  }
}

export function validateCapabilityIdentifier(identifier) {
  if (typeof identifier !== 'string' || !CAPABILITY_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Malformed capability identifier: ${String(identifier)}`);
  }
  return identifier;
}

export function validateCapabilityVocabulary(vocabulary = CAPABILITY_VOCABULARY) {
  if (!isPlainObject(vocabulary)) throw new Error('Capability vocabulary must be an object');
  assertOnlyFields(vocabulary, new Set(['schema_version', 'capabilities']), 'capability vocabulary');
  if (vocabulary.schema_version !== CAPABILITY_SCHEMA_VERSION) {
    throw new Error(`Capability vocabulary schema_version must be ${CAPABILITY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(vocabulary.capabilities) || vocabulary.capabilities.length === 0) {
    throw new Error('Capability vocabulary must define a non-empty capabilities array');
  }

  const ids = new Set();
  let previous = null;
  for (const capability of vocabulary.capabilities) {
    if (!isPlainObject(capability)) throw new Error('Capability vocabulary entries must be objects');
    assertOnlyFields(capability, new Set(['id', 'description']), 'capability vocabulary entry');
    const id = validateCapabilityIdentifier(capability.id);
    if (ids.has(id)) throw new Error(`Duplicate capability in vocabulary: ${id}`);
    if (previous !== null && previous > id) {
      throw new Error('Capability vocabulary entries must be sorted by identifier');
    }
    if (typeof capability.description !== 'string' || capability.description.trim() === '') {
      throw new Error(`Capability ${id} requires a non-empty description`);
    }
    ids.add(id);
    previous = id;
  }
  return vocabulary;
}

export function fingerprintCapabilityVocabulary(vocabulary = CAPABILITY_VOCABULARY) {
  validateCapabilityVocabulary(vocabulary);
  const normalized = {
    schema_version: vocabulary.schema_version,
    capabilities: vocabulary.capabilities.map(({ id, description }) => ({ id, description })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function validateCapabilityDeclaration(declaration, vocabulary = CAPABILITY_VOCABULARY) {
  validateCapabilityVocabulary(vocabulary);
  if (!isPlainObject(declaration)) throw new Error('Capability declaration must be an object');
  assertOnlyFields(declaration, new Set(['schema_version', 'provides']), 'capability declaration');
  if (declaration.schema_version !== CAPABILITY_SCHEMA_VERSION) {
    throw new Error(`Capability declaration schema_version must be ${CAPABILITY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(declaration.provides) || declaration.provides.length === 0) {
    throw new Error('Capability declaration must define a non-empty provides array');
  }

  const known = new Set(vocabulary.capabilities.map(({ id }) => id));
  const provided = new Set();
  for (const capability of declaration.provides) {
    validateCapabilityIdentifier(capability);
    if (!known.has(capability)) throw new Error(`Unknown capability: ${capability}`);
    if (provided.has(capability)) throw new Error(`Duplicate capability declaration: ${capability}`);
    provided.add(capability);
  }

  return {
    schema_version: declaration.schema_version,
    provides: [...provided].sort(),
  };
}

function assertFingerprint(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint`);
  }
}

export function classifyIdentityState({ currentFingerprint, referenceFingerprint = null }) {
  assertFingerprint(currentFingerprint, 'currentFingerprint');
  if (referenceFingerprint === null || referenceFingerprint === undefined) {
    return IDENTITY_STATES.UNREFERENCED;
  }
  assertFingerprint(referenceFingerprint, 'referenceFingerprint');
  return currentFingerprint === referenceFingerprint
    ? IDENTITY_STATES.MATCHES_REFERENCE
    : IDENTITY_STATES.DRIFTED;
}
