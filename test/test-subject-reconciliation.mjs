import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { evaluateAdmission, ADMISSION_KINDS, ADMISSION_REQUEST_SCHEMA_VERSION } from '../packages/harness-runtime/lib/admission.mjs';
import { loadBindingProfile, reconcileExecutionBinding, reconcileExecutionSubject } from '../packages/harness-runtime/lib/opencode-integration.mjs';
import {
  appendExecutionLedgerRecord,
  admittedSubjectForExecution,
  createExecutionProvenance,
  evaluateGovernedExecutionAcceptance,
  executeGovernedRole,
  serializeGovernedExecutionOverlay,
} from '../packages/harness-runtime/lib/execution.mjs';
import { getRecordByRunId } from '../packages/harness-runtime/lib/ledger.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), 'ocode-m4d-'));
const authority = (overrides = {}) => ({ edit: false, stage: false, commit: false, push: false, ...overrides });
const request = (role, capabilities = [], requestedAuthority = {}) => ({
  schema_version: ADMISSION_REQUEST_SCHEMA_VERSION,
  kind: ADMISSION_KINDS.ASSIGNMENT,
  subject: { role },
  requirements: { capabilities },
  requested_authority: authority(requestedAuthority),
});

try {
  const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
  const profile = loadBindingProfile('free', { profilesDir: resolve(repoRoot, 'profiles'), manifest }).profile;
  const planner = contracts.get('planner');
  const reviewer = contracts.get('reviewer');
  const plannerAdmission = evaluateAdmission({ request: request('planner', ['planning.decompose']), contract: planner });
  const reviewerAdmission = evaluateAdmission({ request: request('reviewer', ['review.evaluate']), contract: reviewer });
  assert.equal(plannerAdmission.decision, 'ALLOW');
  assert.equal(reviewerAdmission.decision, 'ALLOW');
  const resolution = {
    subject: { role: 'planner', contract_fingerprint: planner.contract_fingerprint },
    execution_policy: { profile: 'free', policy_version: 1, profile_fingerprint: 'a'.repeat(64), requested_model: 'freellmapi/auto:planning', binding_source: 'profiles/free.json', fallback: 'deny' },
    validation: { status: 'PASS' },
  };
  assert.equal(admittedSubjectForExecution(resolution, plannerAdmission), 'planner');
  assert.throws(() => admittedSubjectForExecution(resolution), /requires an AdmissionDecision/);
  assert.throws(
    () => admittedSubjectForExecution(resolution, { ...plannerAdmission, decision: 'DENY' }),
    /requires an allowed AdmissionDecision/,
  );
  assert.throws(
    () => admittedSubjectForExecution(resolution, { ...plannerAdmission, subject: { role: 'orchestrator' } }),
    /subject does not match/,
  );
  assert.throws(
    () => executeGovernedRole({
      baseDir: repoRoot,
      projectDir: tempRoot,
      profile,
      role: 'planner',
      prompt: 'MUST_NOT_EXECUTE',
      opencode: 'must-not-be-invoked',
      models: [],
    }),
    /requires an AdmissionDecision/,
  );

  const matchingExport = { info: { agent: 'planner', model: { providerID: 'freellmapi', id: 'auto:planning' } } };
  const mismatchExport = { info: { agent: { id: 'orchestrator' }, model: { providerID: 'freellmapi', id: 'auto:planning' } } };
  const unknownExport = { info: { model: { providerID: 'freellmapi', id: 'auto:planning' } } };
  const match = reconcileExecutionSubject(plannerAdmission.subject.role, matchingExport);
  const mismatch = reconcileExecutionSubject(plannerAdmission.subject.role, mismatchExport);
  const unknown = reconcileExecutionSubject(plannerAdmission.subject.role, unknownExport);
  assert.deepEqual(match, {
    schema_version: 1, admitted_subject: 'planner', effective_subject: 'planner', state: 'MATCH', reason_code: 'SUBJECT_MATCH',
  });
  assert.equal(mismatch.state, 'MISMATCH');
  assert.equal(mismatch.effective_subject, 'orchestrator');
  assert.equal(mismatch.reason_code, 'SUBJECT_MISMATCH');
  assert.equal(unknown.state, 'UNKNOWN');
  assert.equal(unknown.effective_subject, null);
  assert.notEqual(unknown.state, 'MATCH');
  console.log('✓ Sanitized observed subject evidence reconciles MATCH, MISMATCH, and UNKNOWN');

  const bindingMatch = reconcileExecutionBinding(
    { execution_policy: { requested_model: 'freellmapi/auto:planning' } },
    matchingExport,
  );
  const accepted = evaluateGovernedExecutionAcceptance({ runtimeSucceeded: true, reconciliation: bindingMatch, subjectReconciliation: match });
  const subjectMismatch = evaluateGovernedExecutionAcceptance({ runtimeSucceeded: true, reconciliation: bindingMatch, subjectReconciliation: mismatch });
  const subjectUnknown = evaluateGovernedExecutionAcceptance({ runtimeSucceeded: true, reconciliation: bindingMatch, subjectReconciliation: unknown });
  assert.deepEqual(accepted, { success: true, failure_classification: null });
  assert.deepEqual(subjectMismatch, { success: false, failure_classification: 'SUBJECT_MISMATCH' });
  assert.deepEqual(subjectUnknown, { success: false, failure_classification: 'SUBJECT_UNVERIFIED' });
  console.log('✓ Mismatch is rejected and UNKNOWN remains unverified rather than MATCH');

  const modelMismatch = reconcileExecutionBinding(
    { execution_policy: { requested_model: 'freellmapi/auto:planning' } },
    { info: { agent: 'planner', model: { providerID: 'openai', id: 'other' } } },
  );
  const separate = evaluateGovernedExecutionAcceptance({ runtimeSucceeded: true, reconciliation: modelMismatch, subjectReconciliation: match });
  assert.equal(modelMismatch.state, 'MISMATCH');
  assert.equal(match.state, 'MATCH');
  assert.equal(separate.failure_classification, 'BINDING_MISMATCH');
  console.log('✓ Model binding and subject reconciliation remain independent facts');

  for (const [role, contract, admission] of [['planner', planner, plannerAdmission], ['reviewer', reviewer, reviewerAdmission]]) {
    const before = {
      role: contract.id,
      capabilities: structuredClone(contract.capabilities),
      authority: structuredClone(contract.authority),
      permissions: structuredClone(contract.permissions),
      admission: structuredClone(admission),
    };
    const overlay = JSON.parse(serializeGovernedExecutionOverlay(profile, role));
    assert.equal(overlay.agent[role].mode, 'primary');
    const after = {
      role: contract.id,
      capabilities: contract.capabilities,
      authority: contract.authority,
      permissions: contract.permissions,
      admission,
    };
    assert.deepEqual(after, before);
  }
  assert.deepEqual(reviewer.authority, {
    tier: 'review', may_edit: false, may_stage: false, may_commit: false, may_push: false,
  });
  assert.equal(reviewerAdmission.decision, 'ALLOW');
  console.log('✓ Ephemeral primary-mode overlay preserves Planner and Reviewer semantic governance');

  const provenance = createExecutionProvenance({
    resolution,
    reconciliation: bindingMatch,
    subjectReconciliation: match,
    success: true,
  });
  const ledgerPath = resolve(tempRoot, 'run-ledger.jsonl');
  const record = appendExecutionLedgerRecord({
    ledgerPath, projectDir: tempRoot, resolution, reconciliation: bindingMatch, subjectReconciliation: match, success: true, elapsedMs: 1,
  });
  const persisted = getRecordByRunId(ledgerPath, record.run_id).execution_provenance;
  assert.equal(provenance.subject_reconciliation, 'MATCH');
  assert.equal(persisted.admitted_subject, 'planner');
  assert.equal(persisted.effective_subject, 'planner');
  assert.equal(persisted.subject_reason_code, 'SUBJECT_MATCH');
  assert.equal(persisted.binding_reconciliation, 'MATCH');
  console.log('✓ Existing execution ledger records independent subject evidence');

  console.log(JSON.stringify({ status: 'SUBJECT_RECONCILIATION_TESTS_PROVEN', live_provider_calls: 0 }));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
