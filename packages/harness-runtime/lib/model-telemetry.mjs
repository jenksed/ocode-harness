import { createHash } from 'node:crypto';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const MODEL_TELEMETRY_SCHEMA_VERSION = 1;
export const MODEL_FAILURE_CLASSES = Object.freeze([
  'IMPLEMENTATION_DEFECT', 'VALIDATION_FAILURE', 'REVIEW_DEFECT', 'STRUCTURED_OUTPUT_FAILURE', 'TOOL_USE_FAILURE',
  'PERMISSION_BLOCK', 'CONTEXT_FAILURE', 'PREMATURE_COMPLETION', 'SCOPE_VIOLATION', 'INFRASTRUCTURE_FAILURE', 'PROVIDER_FAILURE', 'UNKNOWN',
]);
export const MODEL_OUTCOMES = Object.freeze(['SUCCESS', 'FAILURE', 'UNPROVEN']);
const HEX = /^[a-f0-9]{64}$/;
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function string(value, label, nullable = false) { if (nullable && value === null) return null; if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string${nullable ? ' or null' : ''}`); return value; }
function integer(value, label, nullable = false) { if (nullable && value === null) return null; if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer${nullable ? ' or null' : ''}`); return value; }
function only(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); }
function fingerprint(value) { return createHash('sha256').update(canonicalJSONStringify(value)).digest('hex'); }

export function createModelTelemetry(input) { return Object.freeze(validateModelTelemetry({ ...input, schema_version: MODEL_TELEMETRY_SCHEMA_VERSION }, { requireFingerprint: false })); }
export function validateModelTelemetry(value, { requireFingerprint = true } = {}) {
  object(value, 'ModelTelemetry');
  only(value, ['schema_version', 'run_id', 'task_capsule_fingerprint', 'role', 'capability', 'requested_model', 'effective_model', 'effective_model_status', 'adapter_fingerprint', 'qualification_identity_fingerprint', 'execution_profile', 'outcome', 'acceptance_result', 'reviewer_verdict', 'repair_cycles', 'validation_results', 'failure_classification', 'failure_attribution', 'elapsed_ms', 'token_count', 'cost', 'fingerprint'], 'ModelTelemetry');
  if (value.schema_version !== MODEL_TELEMETRY_SCHEMA_VERSION) throw new Error('ModelTelemetry schema_version invalid');
  if (!HEX.test(value.task_capsule_fingerprint)) throw new Error('ModelTelemetry task_capsule_fingerprint invalid');
  if (!['KNOWN', 'UNKNOWN'].includes(value.effective_model_status)) throw new Error('ModelTelemetry effective_model_status invalid');
  if (value.effective_model_status === 'KNOWN') string(value.effective_model, 'effective_model');
  if (value.effective_model_status === 'UNKNOWN' && value.effective_model !== null) throw new Error('Unknown effective model must be null');
  if (value.adapter_fingerprint !== null && !HEX.test(value.adapter_fingerprint)) throw new Error('ModelTelemetry adapter_fingerprint invalid');
  if (value.qualification_identity_fingerprint !== null && !HEX.test(value.qualification_identity_fingerprint)) throw new Error('ModelTelemetry qualification_identity_fingerprint invalid');
  if (!MODEL_OUTCOMES.includes(value.outcome)) throw new Error('ModelTelemetry outcome invalid');
  if (!['ACCEPTED', 'REJECTED', 'UNRESOLVED'].includes(value.acceptance_result)) throw new Error('ModelTelemetry acceptance_result invalid');
  if (!['ACCEPT', 'REJECT', 'NONE'].includes(value.reviewer_verdict)) throw new Error('ModelTelemetry reviewer_verdict invalid');
  if (value.failure_classification !== null && !MODEL_FAILURE_CLASSES.includes(value.failure_classification)) throw new Error('ModelTelemetry failure_classification invalid');
  if (!['MODEL', 'NON_MODEL', 'UNATTRIBUTED'].includes(value.failure_attribution)) throw new Error('ModelTelemetry failure_attribution invalid');
  if (['INFRASTRUCTURE_FAILURE', 'PROVIDER_FAILURE'].includes(value.failure_classification) && value.failure_attribution !== 'NON_MODEL') throw new Error('Infrastructure/provider failures must be NON_MODEL');
  const normalized = {
    schema_version: value.schema_version, run_id: string(value.run_id, 'run_id'), task_capsule_fingerprint: value.task_capsule_fingerprint,
    role: string(value.role, 'role'), capability: string(value.capability, 'capability'), requested_model: string(value.requested_model, 'requested_model'),
    effective_model: string(value.effective_model, 'effective_model', true), effective_model_status: value.effective_model_status,
    adapter_fingerprint: value.adapter_fingerprint, qualification_identity_fingerprint: value.qualification_identity_fingerprint, execution_profile: string(value.execution_profile, 'execution_profile'), outcome: value.outcome,
    acceptance_result: value.acceptance_result, reviewer_verdict: value.reviewer_verdict, repair_cycles: integer(value.repair_cycles, 'repair_cycles'),
    validation_results: Array.isArray(value.validation_results) ? value.validation_results.map((entry) => string(entry, 'validation_result')) : (() => { throw new Error('ModelTelemetry validation_results must be an array'); })(),
    failure_classification: value.failure_classification, failure_attribution: value.failure_attribution,
    elapsed_ms: integer(value.elapsed_ms, 'elapsed_ms', true), token_count: integer(value.token_count, 'token_count', true), cost: value.cost === null ? null : (typeof value.cost === 'number' && value.cost >= 0 ? value.cost : (() => { throw new Error('ModelTelemetry cost invalid'); })()),
  };
  const calculated = fingerprint(normalized);
  if (requireFingerprint && value.fingerprint !== calculated) throw new Error('ModelTelemetry fingerprint mismatch');
  return { ...normalized, fingerprint: value.fingerprint ?? calculated };
}
export function classifyExecutionFailure({ runtime_failure = null, validation_failed = false, reviewer_verdict = 'NONE', structured_output_failed = false, tool_use_failed = false, permission_blocked = false, context_failed = false, premature_completion = false, scope_violation = false } = {}) {
  if (runtime_failure === 'PROVIDER') return { classification: 'PROVIDER_FAILURE', attribution: 'NON_MODEL' };
  if (runtime_failure) return { classification: 'INFRASTRUCTURE_FAILURE', attribution: 'NON_MODEL' };
  if (structured_output_failed) return { classification: 'STRUCTURED_OUTPUT_FAILURE', attribution: 'MODEL' };
  if (tool_use_failed) return { classification: 'TOOL_USE_FAILURE', attribution: 'MODEL' };
  if (permission_blocked) return { classification: 'PERMISSION_BLOCK', attribution: 'UNATTRIBUTED' };
  if (context_failed) return { classification: 'CONTEXT_FAILURE', attribution: 'MODEL' };
  if (premature_completion) return { classification: 'PREMATURE_COMPLETION', attribution: 'MODEL' };
  if (scope_violation) return { classification: 'SCOPE_VIOLATION', attribution: 'MODEL' };
  if (validation_failed) return { classification: 'VALIDATION_FAILURE', attribution: 'MODEL' };
  if (reviewer_verdict === 'REJECT') return { classification: 'REVIEW_DEFECT', attribution: 'UNATTRIBUTED' };
  return { classification: 'UNKNOWN', attribution: 'UNATTRIBUTED' };
}
export function queryModelTelemetry(records, filters = {}) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  return records.map((record) => record?.model_telemetry).filter(Boolean).map((record) => validateModelTelemetry(record)).filter((record) => Object.entries(filters).every(([key, value]) => value === undefined || record[key] === value));
}
