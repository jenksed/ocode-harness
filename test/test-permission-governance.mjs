import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  ADMISSION_DECISIONS,
  GOVERNANCE_STATES,
} from '../packages/harness-runtime/lib/governance.mjs';
import {
  ADMISSION_KINDS,
  ADMISSION_REASON_CODES,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  EVALUATION_STATES,
  evaluateAdmission,
  evaluateContractAdmission,
} from '../packages/harness-runtime/lib/admission.mjs';
import {
  PERMISSION_OPERATIONS,
  PERMISSION_PROJECTION_SCHEMA_VERSION,
  PERMISSION_PROJECTION_STATES,
  projectBashCommand,
  projectPermissions,
} from '../packages/harness-runtime/lib/permission-projection.mjs';

const { ALLOW, DENY, UNKNOWN, NOT_PROJECTED } = PERMISSION_PROJECTION_STATES;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { contracts } = loadAgentContracts({ baseDir: repoRoot });
const authority = (overrides = {}) => ({ edit: false, stage: false, commit: false, push: false, ...overrides });
const request = (role, capabilities = [], requestedAuthority = {}) => ({
  schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
  kind: ADMISSION_KINDS.ASSIGNMENT,
  subject: { role },
  requirements: { capabilities },
  requested_authority: authority(requestedAuthority),
});
const decide = (role, capabilities, requestedAuthority, contract = contracts.get(role)) => evaluateAdmission({
  request: request(role, capabilities, requestedAuthority),
  contract,
});

const precedenceCases = [
  ['specific npm test allow overrides catch-all deny', { '*': 'deny', 'npm test': 'allow' }, 'npm test', ALLOW],
  ['specific git commit allow overrides catch-all deny', { '*': 'deny', 'git commit *': 'allow' }, 'git commit -m message', ALLOW],
  ['specific git push deny overrides catch-all allow', { '*': 'allow', 'git push *': 'deny' }, 'git push origin main', DENY],
];

for (const [name, permission, command, expected] of precedenceCases) {
  assert.equal(projectBashCommand(permission, command).state, expected, name);
}

const full = projectPermissions({
  edit: 'allow',
  websearch: 'allow',
  webfetch: 'allow',
  bash: { '*': 'deny', 'npm test': 'allow', 'npm test *': 'allow', 'git add *': 'deny', 'git commit *': 'deny', 'git push *': 'deny' },
});
assert.equal(full.schema_version, PERMISSION_PROJECTION_SCHEMA_VERSION);
assert.deepEqual(Object.keys(full.operations), PERMISSION_OPERATIONS);
assert.equal(full.operations.edit.state, ALLOW);
assert.equal(full.operations.test.state, ALLOW);
assert.equal(full.operations.stage.state, DENY);
assert.equal(full.operations.commit.state, DENY);
assert.equal(full.operations.push.state, DENY);
assert.equal(full.operations.web.state, ALLOW);
assert.equal(full.not_projected.command_execute, NOT_PROJECTED);

const unknown = projectPermissions({ edit: 'ask', bash: { 'git status': 'allow' } });
assert.equal(unknown.operations.edit.state, UNKNOWN);
assert.equal(unknown.operations.test.state, UNKNOWN);
assert.equal(unknown.operations.web.state, UNKNOWN);
assert.deepEqual(full, projectPermissions({
  edit: 'allow',
  websearch: 'allow',
  webfetch: 'allow',
  bash: { '*': 'deny', 'npm test': 'allow', 'npm test *': 'allow', 'git add *': 'deny', 'git commit *': 'deny', 'git push *': 'deny' },
}));

const coder = contracts.get('coder');
const validEdit = decide('coder', ['implementation.change'], { edit: true });
assert.equal(validEdit.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(validEdit.permission_evaluation.status, EVALUATION_STATES.PASS);
assert.equal(validEdit.permission_evaluation.projection.operations.edit.state, ALLOW);

const deniedEdit = decide('coder', ['implementation.change'], { edit: true }, {
  ...coder,
  permissions: { ...coder.permissions, edit: 'deny' },
});
assert.equal(deniedEdit.decision, ADMISSION_DECISIONS.DENY);
assert.ok(deniedEdit.reason_codes.includes(ADMISSION_REASON_CODES.PERMISSION_INSUFFICIENT));
assert.deepEqual(deniedEdit.failure_details.insufficient_permission_operations, ['edit']);

const unknownTest = decide('coder', ['test.execute'], {}, {
  ...coder,
  permissions: { edit: 'allow', bash: { 'git status': 'allow' } },
});
assert.equal(unknownTest.decision, ADMISSION_DECISIONS.DENY);
assert.ok(unknownTest.reason_codes.includes(ADMISSION_REASON_CODES.PERMISSION_UNKNOWN_FOR_REQUIREMENT));
assert.deepEqual(unknownTest.failure_details.unknown_permission_operations, ['test']);

const irrelevantUnknown = decide('coder', ['implementation.change'], {}, {
  ...coder,
  permissions: { edit: 'allow', bash: { 'git status': 'allow' } },
});
assert.equal(irrelevantUnknown.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(irrelevantUnknown.permission_evaluation.status, EVALUATION_STATES.PASS);

const outsideProjector = decide('coder', ['command.execute']);
assert.equal(outsideProjector.decision, ADMISSION_DECISIONS.DENY);
assert.ok(outsideProjector.reason_codes.includes(ADMISSION_REASON_CODES.PERMISSION_NOT_PROJECTED));
assert.deepEqual(outsideProjector.failure_details.not_projected_permission_operations, ['command_execute']);

const reviewer = contracts.get('reviewer');
const mutationPermissions = {
  edit: { edit: 'allow', bash: { '*': 'deny' } },
  stage: { edit: 'deny', bash: { '*': 'deny', 'git add': 'allow', 'git add *': 'allow' } },
  commit: { edit: 'deny', bash: { '*': 'deny', 'git commit': 'allow', 'git commit *': 'allow' } },
  push: { edit: 'deny', bash: { '*': 'deny', 'git push': 'allow', 'git push *': 'allow' } },
};
for (const [operation, permissions] of Object.entries(mutationPermissions)) {
  const contradictoryContract = { ...reviewer, permissions };
  const assignment = decide('reviewer', ['review.evaluate'], {}, contradictoryContract);
  const baseline = evaluateContractAdmission(contradictoryContract);
  for (const decision of [assignment, baseline]) {
    assert.equal(decision.decision, ADMISSION_DECISIONS.DENY, `${operation} permission beyond authority denies`);
    assert.equal(decision.governance_state, GOVERNANCE_STATES.INVALID, `${operation} invalidates governance`);
    assert.ok(decision.reason_codes.includes(ADMISSION_REASON_CODES.PERMISSION_EXCEEDS_AUTHORITY));
    assert.deepEqual(decision.failure_details.excess_mutation_permissions.map(({ operation: value }) => value), [operation]);
  }
}

const permissiveWebWithoutNewAuthority = decide('reviewer', ['review.evaluate'], {}, {
  ...reviewer,
  permissions: { ...reviewer.permissions, websearch: 'allow', webfetch: 'allow' },
});
assert.equal(permissiveWebWithoutNewAuthority.decision, ADMISSION_DECISIONS.ALLOW);
assert.equal(permissiveWebWithoutNewAuthority.permission_evaluation.status, EVALUATION_STATES.PASS);

console.log(JSON.stringify({
  status: 'PERMISSION_PROJECTION_TESTS_PROVEN',
  operations: PERMISSION_OPERATIONS,
  states: [ALLOW, DENY, UNKNOWN],
  generic_command_execute: NOT_PROJECTED,
}));
