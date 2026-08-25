import {
  ADMISSION_DECISIONS,
  CAPABILITY_VOCABULARY,
  GOVERNANCE_STATES,
  IDENTITY_STATES,
  classifyIdentityState,
  validateCapabilityDeclaration,
  validateCapabilityIdentifier,
} from './governance.mjs';
import {
  PERMISSION_PROJECTION_STATES,
  projectPermissions,
} from './permission-projection.mjs';

export const ADMISSION_REQUEST_SCHEMA_VERSION = 1;
export const ADMISSION_DECISION_SCHEMA_VERSION = 1;

export const ADMISSION_KINDS = Object.freeze({
  CONTRACT: 'CONTRACT',
  ASSIGNMENT: 'ASSIGNMENT',
});

export const EVALUATION_STATES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_EVALUATED: 'NOT_EVALUATED',
});

export const PERMISSION_EVALUATION_STATES = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
});

export const ADMISSION_REASON_CODES = Object.freeze({
  REQUIRED_CAPABILITIES_SATISFIED: 'REQUIRED_CAPABILITIES_SATISFIED',
  REQUIRED_CAPABILITY_MISSING: 'REQUIRED_CAPABILITY_MISSING',
  AUTHORITY_COMPATIBLE: 'AUTHORITY_COMPATIBLE',
  AUTHORITY_INSUFFICIENT: 'AUTHORITY_INSUFFICIENT',
  CONTRACT_VALID: 'CONTRACT_VALID',
  CONTRACT_INVALID: 'CONTRACT_INVALID',
  IDENTITY_DRIFT_OBSERVED: 'IDENTITY_DRIFT_OBSERVED',
  IDENTITY_UNREFERENCED: 'IDENTITY_UNREFERENCED',
  PERMISSION_PROJECTION_COMPATIBLE: 'PERMISSION_PROJECTION_COMPATIBLE',
  PERMISSION_INSUFFICIENT: 'PERMISSION_INSUFFICIENT',
  PERMISSION_EXCEEDS_AUTHORITY: 'PERMISSION_EXCEEDS_AUTHORITY',
  PERMISSION_UNKNOWN_FOR_REQUIREMENT: 'PERMISSION_UNKNOWN_FOR_REQUIREMENT',
  PERMISSION_NOT_PROJECTED: 'PERMISSION_NOT_PROJECTED',
});

const REQUESTED_AUTHORITY_FIELDS = Object.freeze(['edit', 'stage', 'commit', 'push']);
const AUTHORITY_FIELD_BY_REQUEST = Object.freeze({
  edit: 'may_edit',
  stage: 'may_stage',
  commit: 'may_commit',
  push: 'may_push',
});
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const PERMISSION_BACKED_CAPABILITY_OPERATIONS = Object.freeze({
  'repository.edit': 'edit',
  'test.execute': 'test',
  'web.research': 'web',
  'command.execute': 'command_execute',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${label} field: ${key}`);
  }
}

function assertFingerprint(value, label) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function normalizeCapabilities(capabilities, label) {
  if (!Array.isArray(capabilities)) throw new Error(`${label} must be an array`);
  const known = new Set(CAPABILITY_VOCABULARY.capabilities.map(({ id }) => id));
  const normalized = new Set();
  for (const capability of capabilities) {
    validateCapabilityIdentifier(capability);
    if (!known.has(capability)) throw new Error(`Unknown capability: ${capability}`);
    if (normalized.has(capability)) throw new Error(`Duplicate capability: ${capability}`);
    normalized.add(capability);
  }
  return [...normalized].sort();
}

function normalizeRequestedAuthority(authority) {
  if (!isPlainObject(authority)) throw new Error('AdmissionRequest requested_authority must be an object');
  assertOnlyFields(authority, new Set(REQUESTED_AUTHORITY_FIELDS), 'AdmissionRequest requested_authority');
  const normalized = {};
  for (const field of REQUESTED_AUTHORITY_FIELDS) {
    if (typeof authority[field] !== 'boolean') {
      throw new Error(`AdmissionRequest requested_authority.${field} must be boolean`);
    }
    normalized[field] = authority[field];
  }
  return normalized;
}

export function validateAdmissionRequest(request) {
  if (!isPlainObject(request)) throw new Error('AdmissionRequest must be an object');
  assertOnlyFields(
    request,
    new Set(['schema_version', 'kind', 'subject', 'requirements', 'requested_authority', 'reference_contract_fingerprint']),
    'AdmissionRequest',
  );
  if (request.schema_version !== ADMISSION_REQUEST_SCHEMA_VERSION) {
    throw new Error(`AdmissionRequest schema_version must be ${ADMISSION_REQUEST_SCHEMA_VERSION}`);
  }
  if (!Object.values(ADMISSION_KINDS).includes(request.kind)) {
    throw new Error(`AdmissionRequest kind must be one of: ${Object.values(ADMISSION_KINDS).join(', ')}`);
  }
  if (!isPlainObject(request.subject)) throw new Error('AdmissionRequest subject must be an object');
  assertOnlyFields(request.subject, new Set(['role']), 'AdmissionRequest subject');
  if (typeof request.subject.role !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(request.subject.role)) {
    throw new Error('AdmissionRequest subject.role must be a valid role identifier');
  }
  if (!isPlainObject(request.requirements)) throw new Error('AdmissionRequest requirements must be an object');
  assertOnlyFields(request.requirements, new Set(['capabilities']), 'AdmissionRequest requirements');
  const capabilities = normalizeCapabilities(request.requirements.capabilities, 'AdmissionRequest requirements.capabilities');
  const requestedAuthority = normalizeRequestedAuthority(request.requested_authority);
  if (request.reference_contract_fingerprint !== undefined && request.reference_contract_fingerprint !== null) {
    assertFingerprint(request.reference_contract_fingerprint, 'AdmissionRequest reference_contract_fingerprint');
  }
  return {
    schema_version: request.schema_version,
    kind: request.kind,
    subject: { role: request.subject.role },
    requirements: { capabilities },
    requested_authority: requestedAuthority,
    reference_contract_fingerprint: request.reference_contract_fingerprint ?? null,
  };
}

function evaluateContract(contract) {
  const errors = [];
  if (!isPlainObject(contract)) {
    return { status: EVALUATION_STATES.FAIL, errors: ['Contract must be an object'] };
  }
  if (contract.schema_version !== 1) errors.push('Contract schema_version must be 1');
  if (typeof contract.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(contract.id)) {
    errors.push('Contract id must be a valid role identifier');
  }
  try {
    validateCapabilityDeclaration(contract.capabilities);
  } catch (err) {
    errors.push(`Contract capabilities invalid: ${err.message}`);
  }
  if (!isPlainObject(contract.authority)) {
    errors.push('Contract authority must be an object');
  } else {
    for (const field of Object.values(AUTHORITY_FIELD_BY_REQUEST)) {
      if (typeof contract.authority[field] !== 'boolean') errors.push(`Contract authority.${field} must be boolean`);
    }
  }
  if (typeof contract.contract_fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(contract.contract_fingerprint)) {
    errors.push('Contract contract_fingerprint must be a lowercase SHA-256 fingerprint');
  }
  return {
    status: errors.length === 0 ? EVALUATION_STATES.PASS : EVALUATION_STATES.FAIL,
    errors,
  };
}

export function evaluateCapabilities({ requiredCapabilities, subjectCapabilities }) {
  const required = normalizeCapabilities(requiredCapabilities, 'requiredCapabilities');
  const subject = normalizeCapabilities(subjectCapabilities, 'subjectCapabilities');
  const subjectSet = new Set(subject);
  const missingCapabilities = required.filter((capability) => !subjectSet.has(capability));
  return {
    status: missingCapabilities.length === 0 ? EVALUATION_STATES.PASS : EVALUATION_STATES.FAIL,
    required_capabilities: required,
    subject_capabilities: subject,
    missing_capabilities: missingCapabilities,
  };
}

export function evaluateAuthority({ requestedAuthority, subjectAuthority }) {
  const requested = normalizeRequestedAuthority(requestedAuthority);
  if (!isPlainObject(subjectAuthority)) throw new Error('subjectAuthority must be an object');
  const declared = {};
  const insufficientAuthority = [];
  for (const field of REQUESTED_AUTHORITY_FIELDS) {
    const contractField = AUTHORITY_FIELD_BY_REQUEST[field];
    if (typeof subjectAuthority[contractField] !== 'boolean') {
      throw new Error(`subjectAuthority.${contractField} must be boolean`);
    }
    declared[field] = subjectAuthority[contractField];
    if (requested[field] && !declared[field]) {
      insufficientAuthority.push({ requested: field, contract_field: contractField });
    }
  }
  return {
    status: insufficientAuthority.length === 0 ? EVALUATION_STATES.PASS : EVALUATION_STATES.FAIL,
    requested_authority: requested,
    subject_authority: declared,
    insufficient_authority: insufficientAuthority,
  };
}

function notEvaluatedCapabilityEvaluation(requirements) {
  return {
    status: EVALUATION_STATES.NOT_EVALUATED,
    required_capabilities: requirements.capabilities,
    subject_capabilities: [],
    missing_capabilities: [],
  };
}

function notEvaluatedAuthorityEvaluation(authority) {
  return {
    status: EVALUATION_STATES.NOT_EVALUATED,
    requested_authority: authority,
    subject_authority: {},
    insufficient_authority: [],
  };
}

function evaluatePermissions({ request, contract }) {
  const projection = projectPermissions(contract.permissions);
  const requiredOperations = new Set();
  for (const capability of request.requirements.capabilities) {
    const operation = PERMISSION_BACKED_CAPABILITY_OPERATIONS[capability];
    if (operation) requiredOperations.add(operation);
  }
  for (const action of REQUESTED_AUTHORITY_FIELDS) {
    if (request.requested_authority[action]) requiredOperations.add(action);
  }
  const required = [...requiredOperations].sort();
  const insufficientOperations = required.filter((operation) => projection.operations[operation]?.state === PERMISSION_PROJECTION_STATES.DENY);
  const unknownOperations = required.filter((operation) => projection.operations[operation]?.state === PERMISSION_PROJECTION_STATES.UNKNOWN);
  const notProjectedOperations = required.filter((operation) => projection.not_projected[operation] === PERMISSION_PROJECTION_STATES.NOT_PROJECTED);
  const excessMutationPermissions = REQUESTED_AUTHORITY_FIELDS
    .filter((operation) => projection.operations[operation].state === PERMISSION_PROJECTION_STATES.ALLOW
      && !contract.authority[AUTHORITY_FIELD_BY_REQUEST[operation]])
    .map((operation) => ({ operation, contract_field: AUTHORITY_FIELD_BY_REQUEST[operation] }));
  const status = insufficientOperations.length === 0
    && unknownOperations.length === 0
    && notProjectedOperations.length === 0
    && excessMutationPermissions.length === 0
    ? EVALUATION_STATES.PASS
    : EVALUATION_STATES.FAIL;
  return {
    status,
    required_operations: required,
    projection,
    insufficient_operations: insufficientOperations,
    unknown_operations: unknownOperations,
    not_projected_operations: notProjectedOperations,
    excess_mutation_permissions: excessMutationPermissions,
  };
}

function permissionReasonCodes(evaluation) {
  if (evaluation.status === EVALUATION_STATES.PASS) {
    return [ADMISSION_REASON_CODES.PERMISSION_PROJECTION_COMPATIBLE];
  }
  const reasons = [];
  if (evaluation.insufficient_operations.length > 0) reasons.push(ADMISSION_REASON_CODES.PERMISSION_INSUFFICIENT);
  if (evaluation.unknown_operations.length > 0) reasons.push(ADMISSION_REASON_CODES.PERMISSION_UNKNOWN_FOR_REQUIREMENT);
  if (evaluation.not_projected_operations.length > 0) reasons.push(ADMISSION_REASON_CODES.PERMISSION_NOT_PROJECTED);
  if (evaluation.excess_mutation_permissions.length > 0) reasons.push(ADMISSION_REASON_CODES.PERMISSION_EXCEEDS_AUTHORITY);
  return reasons;
}

export function evaluateAdmission({ request, contract }) {
  const normalizedRequest = validateAdmissionRequest(request);
  const contractEvaluation = evaluateContract(contract);
  if (contractEvaluation.status === EVALUATION_STATES.FAIL) {
    return {
      schema_version: ADMISSION_DECISION_SCHEMA_VERSION,
      decision: ADMISSION_DECISIONS.DENY,
      kind: normalizedRequest.kind,
      subject: { role: normalizedRequest.subject.role, contract_fingerprint: null },
      requirements: normalizedRequest.requirements,
      capability_evaluation: notEvaluatedCapabilityEvaluation(normalizedRequest.requirements),
      authority_evaluation: notEvaluatedAuthorityEvaluation(normalizedRequest.requested_authority),
      permission_evaluation: { status: PERMISSION_EVALUATION_STATES.NOT_EVALUATED },
      identity_state: IDENTITY_STATES.UNREFERENCED,
      governance_state: GOVERNANCE_STATES.INVALID,
      reason_codes: [ADMISSION_REASON_CODES.CONTRACT_INVALID],
      failure_details: {
        contract_errors: contractEvaluation.errors,
        missing_capabilities: [],
        insufficient_authority: [],
        insufficient_permission_operations: [],
        unknown_permission_operations: [],
        not_projected_permission_operations: [],
        excess_mutation_permissions: [],
      },
      provenance: {
        subject_contract_fingerprint: null,
        reference_contract_fingerprint: normalizedRequest.reference_contract_fingerprint,
      },
    };
  }
  if (contract.id !== normalizedRequest.subject.role) {
    throw new Error(`AdmissionRequest subject.role does not match contract id: ${normalizedRequest.subject.role}`);
  }

  const capabilityEvaluation = evaluateCapabilities({
    requiredCapabilities: normalizedRequest.requirements.capabilities,
    subjectCapabilities: contract.capabilities.provides,
  });
  const authorityEvaluation = evaluateAuthority({
    requestedAuthority: normalizedRequest.requested_authority,
    subjectAuthority: contract.authority,
  });
  const permissionEvaluation = evaluatePermissions({ request: normalizedRequest, contract });
  const identityState = classifyIdentityState({
    currentFingerprint: contract.contract_fingerprint,
    referenceFingerprint: normalizedRequest.reference_contract_fingerprint,
  });
  const governanceState = capabilityEvaluation.status === EVALUATION_STATES.PASS
    && authorityEvaluation.status === EVALUATION_STATES.PASS
    && permissionEvaluation.status === EVALUATION_STATES.PASS
    ? GOVERNANCE_STATES.VALID
    : GOVERNANCE_STATES.INVALID;
  const decision = governanceState === GOVERNANCE_STATES.VALID
    ? ADMISSION_DECISIONS.ALLOW
    : ADMISSION_DECISIONS.DENY;
  const reasonCodes = [ADMISSION_REASON_CODES.CONTRACT_VALID];
  reasonCodes.push(capabilityEvaluation.status === EVALUATION_STATES.PASS
    ? ADMISSION_REASON_CODES.REQUIRED_CAPABILITIES_SATISFIED
    : ADMISSION_REASON_CODES.REQUIRED_CAPABILITY_MISSING);
  reasonCodes.push(authorityEvaluation.status === EVALUATION_STATES.PASS
    ? ADMISSION_REASON_CODES.AUTHORITY_COMPATIBLE
    : ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT);
  reasonCodes.push(...permissionReasonCodes(permissionEvaluation));
  if (identityState === IDENTITY_STATES.DRIFTED) reasonCodes.push(ADMISSION_REASON_CODES.IDENTITY_DRIFT_OBSERVED);
  if (identityState === IDENTITY_STATES.UNREFERENCED) reasonCodes.push(ADMISSION_REASON_CODES.IDENTITY_UNREFERENCED);

  return {
    schema_version: ADMISSION_DECISION_SCHEMA_VERSION,
    decision,
    kind: normalizedRequest.kind,
    subject: { role: contract.id, contract_fingerprint: contract.contract_fingerprint },
    requirements: normalizedRequest.requirements,
    capability_evaluation: capabilityEvaluation,
    authority_evaluation: authorityEvaluation,
    permission_evaluation: permissionEvaluation,
    identity_state: identityState,
    governance_state: governanceState,
    reason_codes: reasonCodes,
    failure_details: {
      contract_errors: [],
      missing_capabilities: capabilityEvaluation.missing_capabilities,
      insufficient_authority: authorityEvaluation.insufficient_authority,
      insufficient_permission_operations: permissionEvaluation.insufficient_operations,
      unknown_permission_operations: permissionEvaluation.unknown_operations,
      not_projected_permission_operations: permissionEvaluation.not_projected_operations,
      excess_mutation_permissions: permissionEvaluation.excess_mutation_permissions,
    },
    provenance: {
      subject_contract_fingerprint: contract.contract_fingerprint,
      reference_contract_fingerprint: normalizedRequest.reference_contract_fingerprint,
    },
  };
}

export function evaluateContractAdmission(contract) {
  return evaluateAdmission({
    contract,
    request: {
      schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
      kind: ADMISSION_KINDS.CONTRACT,
      subject: { role: contract?.id },
      requirements: { capabilities: [] },
      requested_authority: { edit: false, stage: false, commit: false, push: false },
    },
  });
}
