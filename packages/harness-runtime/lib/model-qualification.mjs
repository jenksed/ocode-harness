import { createHash } from 'node:crypto';
import { canonicalJSONStringify } from './agent-contract.mjs';
import { validateModelTelemetry } from './model-telemetry.mjs';

export const MODEL_QUALIFICATION_SCHEMA_VERSION = 1;
export const MODEL_QUALIFICATION_STATUSES = Object.freeze(['NOT_EVALUATED', 'QUALIFIED', 'NOT_QUALIFIED', 'STALE', 'UNAVAILABLE', 'UNPROVEN']);
const HEX = /^[a-f0-9]{64}$/;
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function string(value, label) { if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`); return value; }
function only(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); }
function hash(value) { return createHash('sha256').update(canonicalJSONStringify(value)).digest('hex'); }
export function qualificationIdentity(input) {
  object(input, 'qualification identity'); only(input, ['model_reference', 'effective_model_status', 'capability', 'adapter_fingerprint', 'role_contract_fingerprint', 'protocol_fingerprint', 'fixture_fingerprint', 'opencode_version', 'qualification_protocol_version'], 'qualification identity');
  if (!['KNOWN', 'UNKNOWN'].includes(input.effective_model_status)) throw new Error('qualification identity effective_model_status invalid');
  for (const key of ['model_reference', 'capability', 'role_contract_fingerprint', 'protocol_fingerprint', 'fixture_fingerprint', 'opencode_version', 'qualification_protocol_version']) string(input[key], key);
  for (const key of ['role_contract_fingerprint', 'protocol_fingerprint', 'fixture_fingerprint']) if (!HEX.test(input[key])) throw new Error(`${key} invalid`);
  if (input.adapter_fingerprint !== null && !HEX.test(input.adapter_fingerprint)) throw new Error('adapter_fingerprint invalid');
  return { ...input, fingerprint: hash(input) };
}
export function deriveModelQualification({ identity, telemetry, minimum_successful_trials = 2 }) {
  const normalizedIdentity = qualificationIdentity(identity);
  if (!Number.isInteger(minimum_successful_trials) || minimum_successful_trials < 2) throw new Error('minimum_successful_trials must be at least 2');
  const matching = (telemetry || []).map(validateModelTelemetry).filter((entry) => entry.qualification_identity_fingerprint === normalizedIdentity.fingerprint);
  const attributable = matching.filter((entry) => entry.failure_attribution !== 'NON_MODEL');
  const successes = attributable.filter((entry) => entry.outcome === 'SUCCESS' && entry.acceptance_result === 'ACCEPTED' && entry.reviewer_verdict === 'ACCEPT');
  const failures = attributable.filter((entry) => entry.outcome === 'FAILURE');
  const status = !matching.length ? 'NOT_EVALUATED' : failures.length ? 'NOT_QUALIFIED' : successes.length >= minimum_successful_trials ? 'QUALIFIED' : 'UNPROVEN';
  return { schema_version: MODEL_QUALIFICATION_SCHEMA_VERSION, identity: normalizedIdentity, status, minimum_successful_trials, successful_trials: successes.map((entry) => entry.run_id), non_model_failures: matching.filter((entry) => entry.failure_attribution === 'NON_MODEL').map((entry) => entry.run_id), failed_trials: failures.map((entry) => entry.run_id), evidence_fingerprints: matching.map((entry) => entry.fingerprint).sort() };
}
export function isQualificationCurrent(record, identity) { return record?.identity?.fingerprint === qualificationIdentity(identity).fingerprint ? record.status : 'STALE'; }
