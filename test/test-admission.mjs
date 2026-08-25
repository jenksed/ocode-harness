import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  ADMISSION_KINDS,
  ADMISSION_REASON_CODES,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  EVALUATION_STATES,
  PERMISSION_EVALUATION_STATES,
  evaluateAdmission,
  evaluateContractAdmission,
  validateAdmissionRequest,
} from '../packages/harness-runtime/lib/admission.mjs';
import {
  ADMISSION_DECISIONS,
  GOVERNANCE_STATES,
  IDENTITY_STATES,
} from '../packages/harness-runtime/lib/governance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { contracts } = loadAgentContracts({ baseDir: repoRoot });
const contractByRole = contracts;

const authority = (overrides = {}) => ({
  edit: false,
  stage: false,
  commit: false,
  push: false,
  ...overrides,
});

const requestFor = (role, {
  capabilities = [],
  requestedAuthority = {},
  referenceContractFingerprint,
} = {}) => ({
  schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
  kind: ADMISSION_KINDS.ASSIGNMENT,
  subject: { role },
  requirements: { capabilities },
  requested_authority: authority(requestedAuthority),
  ...(referenceContractFingerprint === undefined
    ? {}
    : { reference_contract_fingerprint: referenceContractFingerprint }),
});

const decide = (role, options) => evaluateAdmission({
  request: requestFor(role, options),
  contract: contractByRole.get(role),
});

const assertReason = (decision, reason) => {
  assert.ok(decision.reason_codes.includes(reason), `${reason} was not reported`);
};

const normalized = validateAdmissionRequest(requestFor('coder', {
  capabilities: ['test.execute', 'implementation.change'],
  requestedAuthority: { edit: true },
}));
assert.deepEqual(normalized.requirements.capabilities, ['implementation.change', 'test.execute']);

assert.throws(
  () => validateAdmissionRequest(requestFor('coder', { capabilities: ['implementation.change', 'implementation.change'] })),
  /duplicate/i,
);
assert.throws(
  () => validateAdmissionRequest(requestFor('coder', { capabilities: ['provider.route'] })),
  /Unknown capability/i,
);

const cases = [
  {
    name: 'Coder satisfies multiple semantic capabilities',
    role: 'coder',
    options: { capabilities: ['implementation.change', 'test.execute'] },
    decision: ADMISSION_DECISIONS.ALLOW,
    capability: EVALUATION_STATES.PASS,
    authority: EVALUATION_STATES.PASS,
  },
  {
    name: 'Coder denies a missing semantic capability',
    role: 'coder',
    options: { capabilities: ['review.evaluate'] },
    decision: ADMISSION_DECISIONS.DENY,
    capability: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.REQUIRED_CAPABILITY_MISSING,
    missingCapabilities: ['review.evaluate'],
  },
  {
    name: 'Coder admits a valid implementation edit request',
    role: 'coder',
    options: { capabilities: ['implementation.change'], requestedAuthority: { edit: true } },
    decision: ADMISSION_DECISIONS.ALLOW,
    capability: EVALUATION_STATES.PASS,
    authority: EVALUATION_STATES.PASS,
  },
  {
    name: 'Coder denies insufficient stage authority',
    role: 'coder',
    options: { requestedAuthority: { stage: true } },
    decision: ADMISSION_DECISIONS.DENY,
    authority: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT,
    insufficientAuthority: ['stage'],
  },
  {
    name: 'Coder denies insufficient commit authority',
    role: 'coder',
    options: { requestedAuthority: { commit: true } },
    decision: ADMISSION_DECISIONS.DENY,
    authority: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT,
    insufficientAuthority: ['commit'],
  },
  {
    name: 'Coder denies insufficient push authority',
    role: 'coder',
    options: { requestedAuthority: { push: true } },
    decision: ADMISSION_DECISIONS.DENY,
    authority: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT,
    insufficientAuthority: ['push'],
  },
  {
    name: 'Reviewer edit request is denied',
    role: 'reviewer',
    options: { capabilities: ['review.evaluate'], requestedAuthority: { edit: true } },
    decision: ADMISSION_DECISIONS.DENY,
    authority: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT,
    insufficientAuthority: ['edit'],
  },
  {
    name: 'Committer commit request is denied',
    role: 'committer',
    options: { capabilities: ['closeout.evaluate'], requestedAuthority: { commit: true } },
    decision: ADMISSION_DECISIONS.DENY,
    authority: EVALUATION_STATES.FAIL,
    reason: ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT,
    insufficientAuthority: ['commit'],
  },
];

for (const testCase of cases) {
  const decision = decide(testCase.role, testCase.options);
  assert.equal(decision.decision, testCase.decision, testCase.name);
  if (testCase.capability) assert.equal(decision.capability_evaluation.status, testCase.capability, testCase.name);
  if (testCase.authority) assert.equal(decision.authority_evaluation.status, testCase.authority, testCase.name);
  if (testCase.reason) assertReason(decision, testCase.reason);
  if (testCase.missingCapabilities) assert.deepEqual(decision.failure_details.missing_capabilities, testCase.missingCapabilities, testCase.name);
  if (testCase.insufficientAuthority) {
    assert.deepEqual(
      decision.failure_details.insufficient_authority.map(({ requested }) => requested),
      testCase.insufficientAuthority,
      testCase.name,
    );
  }
  assert.notEqual(decision.permission_evaluation.status, PERMISSION_EVALUATION_STATES.NOT_EVALUATED, testCase.name);
}

const driftReference = '0'.repeat(64);
const driftedAllow = decide('coder', {
  capabilities: ['implementation.change'],
  requestedAuthority: { edit: true },
  referenceContractFingerprint: driftReference,
});
assert.equal(driftedAllow.identity_state, IDENTITY_STATES.DRIFTED);
assert.equal(driftedAllow.governance_state, GOVERNANCE_STATES.VALID);
assert.equal(driftedAllow.decision, ADMISSION_DECISIONS.ALLOW);
assertReason(driftedAllow, ADMISSION_REASON_CODES.IDENTITY_DRIFT_OBSERVED);

const driftedDeny = decide('coder', {
  capabilities: ['implementation.change'],
  requestedAuthority: { commit: true },
  referenceContractFingerprint: driftReference,
});
assert.equal(driftedDeny.identity_state, IDENTITY_STATES.DRIFTED);
assert.equal(driftedDeny.governance_state, GOVERNANCE_STATES.INVALID);
assert.equal(driftedDeny.decision, ADMISSION_DECISIONS.DENY);
assertReason(driftedDeny, ADMISSION_REASON_CODES.AUTHORITY_INSUFFICIENT);
assertReason(driftedDeny, ADMISSION_REASON_CODES.IDENTITY_DRIFT_OBSERVED);

const coderAsReviewer = { ...contractByRole.get('coder'), id: 'reviewer' };
const noRoleNameBypass = evaluateAdmission({
  request: requestFor('reviewer', {
    capabilities: ['implementation.change'],
    requestedAuthority: { edit: true },
  }),
  contract: coderAsReviewer,
});
assert.equal(noRoleNameBypass.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(noRoleNameBypass.authority_evaluation.status, EVALUATION_STATES.PASS);

const contractDecision = evaluateContractAdmission(contractByRole.get('coder'));
assert.equal(contractDecision.kind, ADMISSION_KINDS.CONTRACT);
assert.equal(contractDecision.decision, ADMISSION_DECISIONS.ALLOW);
assertReason(contractDecision, ADMISSION_REASON_CODES.CONTRACT_VALID);

const deterministicRequest = requestFor('coder', {
  capabilities: ['implementation.change'],
  requestedAuthority: { edit: true },
});
assert.deepEqual(
  evaluateAdmission({ request: deterministicRequest, contract: contractByRole.get('coder') }),
  evaluateAdmission({ request: deterministicRequest, contract: contractByRole.get('coder') }),
);

console.log(JSON.stringify({
  status: 'ADMISSION_TESTS_PROVEN',
  cases: cases.length,
  canonical_roles: [...contracts.keys()],
  permission_evaluation: 'M4C_PROJECTED',
}));
