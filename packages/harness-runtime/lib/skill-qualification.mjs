import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
