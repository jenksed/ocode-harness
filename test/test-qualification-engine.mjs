import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveSkillLifecycle, loadSkillSource } from '../packages/harness-runtime/lib/skill-contract.mjs';
import {
  METHOD_COMPLETION,
  QUALIFICATION_PHASES,
  assertQualificationContextAccess,
  materializeQualificationContext,
  qualifySkillLive,
} from '../packages/harness-runtime/lib/skill-qualification.mjs';

const root = resolve('.');
const source = loadSkillSource({ skillsDir: join(root, 'skills'), skillId: 'tdd' });
const identity = { skill_id: 'tdd', skill_version: '1.0.0', skill_fingerprint: source.skill_fingerprint, acceptance_ids: source.protocol.acceptance.map((entry) => entry.id) };
const capsule = {
  path_refs: [{ path: 'math.mjs' }, { path: 'math.test.mjs' }, { path: 'package.json' }],
  context_expansion_policy: { max_expansions: 0 },
};
const visible = mkdtempSync(join(tmpdir(), 'ocode-context-boundary-'));
const boundary = materializeQualificationContext({ sourceDir: join(root, 'test/fixtures/m6-tdd/live'), projectDir: visible, capsule, runtimeMaterialize: (dir) => { assert.equal(dir.endsWith('.opencode'), true); } });
assert.deepEqual(boundary.visible_paths, ['math.mjs', 'math.test.mjs', 'package.json']);
assert.equal(existsSync(join(visible, 'qualification-test-runner.mjs')), false);
assert.equal(assertQualificationContextAccess(boundary, 'math.mjs'), 'math.mjs');
assert.throws(() => assertQualificationContextAccess(boundary, 'qualification-test-runner.mjs'), /OUT_OF_CONTEXT_ACCESS/);
console.log('✓ ContextCapsule materialization excludes harness files and rejects out-of-context access');

const runtime = Object.freeze({
  execution_id: 'exec-method-1', session_id: 'session-method-1', requested_model: 'model', effective_model: 'model',
  admitted_subject: 'coder', effective_subject: 'coder', skill_load: 'tdd-method-load', trace: ['RED', 'CHANGE', 'GREEN'],
  changed_paths: ['math.mjs'], oracle_unchanged: true, context_status: 'CONTEXT_CONFORMING', evidence_refs: ['tdd-red', 'tdd-change', 'tdd-green'],
});
const methodExecution = { method_completion: METHOD_COMPLETION.PROVEN_STOPPED, runtime };
const passEvaluator = (execution) => ({ status: 'PASS', method_evidence_sufficient: execution.runtime.trace.join('/') === 'RED/CHANGE/GREEN' });
const order = [];
let methodCalls = 0, reportCalls = 0, correctionCalls = 0;
const base = {
  skill: identity, subject: 'coder', fixture: { id: 'tdd' }, evaluator: passEvaluator, context: capsule,
  attempt: { attempt_id: 'attempt-later', execution_id: 'exec-method-1' },
  preflight: async () => order.push('preflight'),
  executeMethod: async () => { methodCalls += 1; order.push('method'); return methodExecution; },
  persistCheckpoint: async () => order.push('checkpoint'),
  report: async ({ checkpoint }) => { reportCalls += 1; order.push('report'); assert.equal(Object.isFrozen(checkpoint.runtime), true); assert.equal(checkpoint.runtime.method_completion, METHOD_COMPLETION.PROVEN_STOPPED); return { execution_id: 'exec-report-1', output: '{"valid":true}' }; },
  parseReported: (output) => { const value = JSON.parse(output); if (value.valid !== true) throw new Error('invalid report'); return value; },
  reconcile: async ({ checkpoint, reported }) => { assert.match(checkpoint.runtime.session_id, /^session-method-/); return { reported, runtime_session: checkpoint.runtime.session_id }; },
};
const qualified = await qualifySkillLive(base);
assert.equal(qualified.status, 'EVIDENCE_READY');
assert.deepEqual(order, ['preflight', 'method', 'checkpoint', 'report']);
assert.equal(qualified.phases.indexOf(QUALIFICATION_PHASES.EXECUTION_CHECKPOINTED) < qualified.phases.indexOf(QUALIFICATION_PHASES.REPORTING), true);
assert.equal(methodCalls, 1);
assert.equal(qualified.checkpoint.runtime.session_id, 'session-method-1');
console.log('✓ RED/change/GREEN is runtime-stopped, checkpointed before reporting, and remains execution-scoped');

const malformed = await qualifySkillLive({
  ...base,
  attempt: { attempt_id: 'attempt-report-fail', execution_id: 'exec-method-2' },
  executeMethod: async () => { methodCalls += 1; return { ...methodExecution, runtime: { ...runtime, execution_id: 'exec-method-2', session_id: 'session-method-2' } }; },
  report: async () => { reportCalls += 1; return { execution_id: 'exec-report-2', output: 'bad' }; },
  correctReport: async ({ checkpoint }) => { correctionCalls += 1; assert.equal(checkpoint.runtime.session_id, 'session-method-2'); return { execution_id: 'exec-correction-2', output: 'still bad' }; },
});
assert.equal(malformed.status, 'REPORT_FAILURE');
assert.equal(malformed.repair_count, 1);
assert.equal(malformed.retry_authorization.allowed, false);
assert.equal(malformed.method_executions, 1);
assert.equal(correctionCalls, 1);
console.log('✓ One lower-authority correction cannot rewrite runtime facts or authorize method retry');

const corrected = await qualifySkillLive({
  ...base,
  attempt: { attempt_id: 'attempt-corrected', execution_id: 'exec-method-3' },
  executeMethod: async () => ({ ...methodExecution, runtime: { ...runtime, execution_id: 'exec-method-3', session_id: 'session-method-3' } }),
  report: async () => ({ execution_id: 'exec-report-3', output: 'bad' }),
  correctReport: async () => ({ execution_id: 'exec-correction-3', output: '{"valid":true}' }),
});
assert.equal(corrected.status, 'EVIDENCE_READY');
assert.equal(corrected.repair_count, 1);
assert.equal(corrected.checkpoint.runtime.session_id, 'session-method-3');
console.log('✓ Reporting and correction run after method stop with distinct inspectable identities');

const missing = await qualifySkillLive({
  ...base,
  attempt: { attempt_id: 'attempt-missing', execution_id: 'exec-missing' },
  executeMethod: async () => ({ method_completion: METHOD_COMPLETION.INCOMPLETE, runtime: { ...runtime, trace: ['RED'] } }),
  evaluator: () => ({ status: 'FAIL', method_evidence_sufficient: false }),
  report: async () => { throw new Error('report must not run'); },
});
assert.equal(missing.status, 'METHOD_EVIDENCE_MISSING');
assert.equal(missing.retry_authorization.allowed, true);
assert.equal(missing.report_executions, 0);
assert.equal(missing.retry_authorization.next_attempt_requires_new_identity, true);
assert.equal(deriveSkillLifecycle({ source, records: [] }), 'VALID');
console.log('✓ Missing method work permits only a new-identity attempt; failed history does not poison the fingerprint');

assert.throws(() => Object.assign(qualified.checkpoint.runtime, { session_id: 'report-session' }), TypeError);
assert.equal(reportCalls >= 2, true);
console.log('QUALIFICATION_ENGINE_PROVEN');
