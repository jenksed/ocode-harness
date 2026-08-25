import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { validateQualificationRecord } from './skill-contract.mjs';

export function observeCompletedSkillLoad(events, expectedSkill) {
  if (!Array.isArray(events) || typeof expectedSkill !== 'string') return null;
  return events.find((event) => event?.type === 'tool_use' && event?.part?.type === 'tool'
    && event?.part?.tool === 'skill' && event?.part?.state?.status === 'completed'
    && event?.part?.state?.input?.name === expectedSkill) || null;
}

export function fixtureFingerprint({ root, paths, domain }) {
  if(typeof root!=='string'||!root||!Array.isArray(paths)||!paths.length||typeof domain!=='string'||!domain) throw new Error('fixtureFingerprint requires root, paths, and domain');
  const hash=createHash('sha256').update(`OCODE-QUALIFICATION-FIXTURE-V1\0${domain}\0`);
  for(const path of [...paths].sort()) hash.update(path).update('\0').update(readFileSync(join(root,path))).update('\0');
  return hash.digest('hex');
}

export function contextTelemetry(capsule, telemetry={}) {
  return { supplied_path_refs:capsule.path_refs.length, supplied_evidence_refs:capsule.evidence_refs.length,
    supplied_chars:Buffer.byteLength(JSON.stringify(capsule),'utf8'), files_inspected:telemetry.files_inspected||0,
    tool_calls:telemetry.tool_calls||0, external_requests:telemetry.external_requests||0, repair_attempts:telemetry.repair_attempts||0 };
}

export function assembleQualificationRecord(record, source) { return validateQualificationRecord(record,{currentSource:source}); }

export const QUALIFICATION_PHASES = Object.freeze({
  PREFLIGHT: 'PREFLIGHT',
  EXECUTING_METHOD: 'EXECUTING_METHOD',
  METHOD_EVIDENCE_SUFFICIENT: 'METHOD_EVIDENCE_SUFFICIENT',
  RUNTIME_ENFORCED_STOP: 'RUNTIME_ENFORCED_STOP',
  EXECUTION_CHECKPOINTED: 'EXECUTION_CHECKPOINTED',
  REPORTING: 'REPORTING',
  CORRECTING_REPORT: 'CORRECTING_REPORT',
  EVIDENCE_READY: 'EVIDENCE_READY',
  REPORT_FAILURE: 'REPORT_FAILURE',
  METHOD_EVIDENCE_MISSING: 'METHOD_EVIDENCE_MISSING',
});

export const METHOD_COMPLETION = Object.freeze({
  PROVEN_STOPPED: 'METHOD_PROVEN_SESSION_STOPPED',
  INCOMPLETE: 'METHOD_EVIDENCE_INCOMPLETE',
});

/** Materialize only capsule-authorized files; runtime material belongs under .opencode. */
export function materializeQualificationContext({ sourceDir, projectDir, capsule, runtimeMaterialize = null }) {
  const sourceRoot = resolve(sourceDir), destination = resolve(projectDir);
  mkdirSync(destination, { recursive: true });
  const visible = [];
  for (const ref of capsule.path_refs) {
    const from = resolve(sourceRoot, ref.path);
    if (relative(sourceRoot, from).startsWith('..') || !existsSync(from)) throw new Error(`Context source unavailable: ${ref.path}`);
    const to = resolve(destination, ref.path);
    if (relative(destination, to).startsWith('..')) throw new Error(`Context destination escaped: ${ref.path}`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    visible.push(ref.path);
  }
  if (runtimeMaterialize) runtimeMaterialize(join(destination, '.opencode'));
  return Object.freeze({ project_dir: destination, visible_paths: Object.freeze([...visible].sort()), max_expansions: capsule.context_expansion_policy.max_expansions });
}

export function assertQualificationContextAccess(boundary, requestedPath, expansions = []) {
  const allowed = new Set([...boundary.visible_paths, ...expansions]);
  if (!allowed.has(requestedPath)) throw new Error(`OUT_OF_CONTEXT_ACCESS:${requestedPath}`);
  return requestedPath;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

/**
 * Capture the authority-owned result of a method execution before any
 * model-authored report is parsed.  The returned value is intentionally
 * immutable: a report repair can describe these facts, never revise them.
 */
export function checkpointQualificationExecution({ attempt_id, skill, runtime, original_model_output }) {
  if (typeof attempt_id !== 'string' || !attempt_id) throw new Error('qualification attempt_id required');
  if (!skill || typeof skill !== 'object') throw new Error('qualification skill identity required');
  if (!runtime || typeof runtime !== 'object') throw new Error('qualification runtime evidence required');
  if (typeof original_model_output !== 'string') throw new Error('qualification original model output required');
  return freeze(structuredClone({
    schema_version: 1,
    attempt_id,
    skill,
    runtime,
    original_model_output,
  }));
}

/**
 * Validate a model report and, at most once, repair its serialization.  This
 * does not execute a method and exposes an immutable checkpoint to the repair
 * callback.  Callers must continue to derive trusted evidence from checkpoint
 * runtime facts only.
 */
export async function resumeQualificationReport({ checkpoint, parseReported, correct }) {
  if (!checkpoint || typeof checkpoint !== 'object' || !Object.isFrozen(checkpoint)) {
    throw new Error('immutable qualification checkpoint required');
  }
  if (typeof parseReported !== 'function') throw new Error('parseReported required');
  const before = JSON.stringify(checkpoint);
  try {
    return { success: true, value: parseReported(checkpoint.original_model_output), repair_count: 0 };
  } catch (first) {
    if (typeof correct !== 'function') {
      return { success: false, failure_classification: 'STRUCTURED_OUTPUT_INVALID', structured_output_error: first.message, repair_count: 0 };
    }
    let repaired;
    try {
      repaired = await correct({
        malformed_output: checkpoint.original_model_output,
        validation_error: first.message,
        checkpoint,
      });
    } catch (error) {
      return { success: false, failure_classification: 'STRUCTURED_OUTPUT_INVALID', structured_output_error: error.message, repair_count: 1 };
    }
    if (JSON.stringify(checkpoint) !== before) throw new Error('REPORT_CORRECTION_MUTATED_EXECUTION_CHECKPOINT');
    try {
      return { success: true, value: parseReported(repaired), repair_count: 1 };
    } catch (error) {
      return { success: false, failure_classification: 'STRUCTURED_OUTPUT_INVALID', structured_output_error: error.message, repair_count: 1 };
    }
  }
}

/**
 * Generic live-qualification phase coordinator. Method execution, reporting,
 * correction, and reconciliation are distinct authority domains.
 */
export async function qualifySkillLive({ skill, subject, fixture, evaluator, context, attempt, preflight, executeMethod, persistCheckpoint, report, parseReported, correctReport, reconcile }) {
  for (const [name, value] of Object.entries({ skill, subject, fixture, evaluator, context, attempt })) if (value === undefined || value === null) throw new Error(`qualifySkillLive requires ${name}`);
  for (const [name, value] of Object.entries({ preflight, executeMethod, persistCheckpoint, report, parseReported, reconcile })) if (typeof value !== 'function') throw new Error(`qualifySkillLive requires ${name}`);
  if (!attempt.attempt_id || !attempt.execution_id) throw new Error('qualification attempt and execution identities required');
  const phases = [QUALIFICATION_PHASES.PREFLIGHT];
  await preflight({ skill, subject, fixture, context, attempt });
  phases.push(QUALIFICATION_PHASES.EXECUTING_METHOD);
  const execution = await executeMethod({ skill, subject, fixture, context, attempt, evaluator });
  const evaluation = evaluator(execution);
  if (evaluation?.status !== 'PASS' || evaluation?.method_evidence_sufficient !== true) {
    phases.push(QUALIFICATION_PHASES.METHOD_EVIDENCE_MISSING);
    return { status: 'METHOD_EVIDENCE_MISSING', phases, execution, evaluation, method_executions: 1, report_executions: 0, correction_executions: 0, retry_authorization: { allowed: true, reason: 'MISSING_METHOD_EVIDENCE', next_attempt_requires_new_identity: true } };
  }
  phases.push(QUALIFICATION_PHASES.METHOD_EVIDENCE_SUFFICIENT);
  if (execution.method_completion !== METHOD_COMPLETION.PROVEN_STOPPED) throw new Error('Sufficient method evidence requires runtime-enforced session stop');
  phases.push(QUALIFICATION_PHASES.RUNTIME_ENFORCED_STOP);
  const checkpoint = checkpointQualificationExecution({ attempt_id: attempt.attempt_id, skill, runtime: { ...execution.runtime, execution_id: attempt.execution_id, method_completion: execution.method_completion }, original_model_output: '' });
  await persistCheckpoint(checkpoint);
  phases.push(QUALIFICATION_PHASES.EXECUTION_CHECKPOINTED, QUALIFICATION_PHASES.REPORTING);
  const initialReport = await report({ checkpoint, acceptance_ids: skill.acceptance_ids });
  if (!initialReport?.execution_id || initialReport.execution_id === attempt.execution_id) throw new Error('report execution identity must be distinct from method execution');
  const reportCheckpoint = checkpointQualificationExecution({ attempt_id: attempt.attempt_id, skill, runtime: checkpoint.runtime, original_model_output: initialReport.output ?? '' });
  const resumed = await resumeQualificationReport({
    checkpoint: reportCheckpoint,
    parseReported,
    correct: typeof correctReport === 'function' ? async (input) => {
      phases.push(QUALIFICATION_PHASES.CORRECTING_REPORT);
      const corrected = await correctReport(input);
      if (!corrected?.execution_id || corrected.execution_id === attempt.execution_id || corrected.execution_id === initialReport.execution_id) throw new Error('correction execution identity must be distinct');
      return corrected.output;
    } : undefined,
  });
  if (!resumed.success) {
    phases.push(QUALIFICATION_PHASES.REPORT_FAILURE);
    return { status: 'REPORT_FAILURE', phases, checkpoint, report: initialReport, repair_count: resumed.repair_count, method_executions: 1, report_executions: 1, correction_executions: resumed.repair_count, retry_authorization: { allowed: false, reason: 'REPORT_FAILURE_DOES_NOT_AUTHORIZE_METHOD_RETRY' } };
  }
  const evidence = await reconcile({ checkpoint, reported: resumed.value, report_execution_id: initialReport.execution_id });
  if (JSON.stringify(checkpoint.runtime) !== JSON.stringify(reportCheckpoint.runtime)) throw new Error('Runtime truth changed after method execution');
  phases.push(QUALIFICATION_PHASES.EVIDENCE_READY);
  return { status: 'EVIDENCE_READY', phases, checkpoint, reported: resumed.value, evidence, repair_count: resumed.repair_count, method_executions: 1, report_executions: 1, correction_executions: resumed.repair_count, retry_authorization: { allowed: false, reason: 'METHOD_ALREADY_EXECUTED' } };
}
