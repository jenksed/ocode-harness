import { createHash } from 'node:crypto';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const BEHAVIORAL_ADAPTER_SCHEMA_VERSION = 1;
export const ADAPTER_STATES = Object.freeze(['CANDIDATE', 'QUALIFIED', 'REJECTED', 'STALE']);
const HEX = /^[a-f0-9]{64}$/;
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function string(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value.trim(); }
function fields(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); }
function sha(value) { return createHash('sha256').update(canonicalJSONStringify(value)).digest('hex'); }
export function validateBehavioralAdapter(value, { requireFingerprint = true } = {}) {
  object(value, 'BehavioralAdapter'); fields(value, ['schema_version', 'id', 'version', 'state', 'target', 'mitigation', 'triggering_failure_class', 'evidence_refs', 'evaluation_protocol_fingerprint', 'before_qualification_fingerprint', 'after_qualification_fingerprint', 'fingerprint'], 'BehavioralAdapter');
  if (value.schema_version !== BEHAVIORAL_ADAPTER_SCHEMA_VERSION) throw new Error('BehavioralAdapter schema_version invalid');
  if (!ADAPTER_STATES.includes(value.state)) throw new Error('BehavioralAdapter state invalid');
  object(value.target, 'adapter target'); fields(value.target, ['kind', 'model_reference'], 'adapter target');
  if (!['EXACT_MODEL', 'MODEL_FAMILY'].includes(value.target.kind)) throw new Error('adapter target kind invalid');
  const evidence = Array.isArray(value.evidence_refs) ? value.evidence_refs.map((entry) => string(entry, 'adapter evidence_ref')) : (() => { throw new Error('adapter evidence_refs must be an array'); })();
  if (!evidence.length) throw new Error('BehavioralAdapter requires evidence_refs');
  for (const key of ['evaluation_protocol_fingerprint', 'before_qualification_fingerprint', 'after_qualification_fingerprint']) if (value[key] !== null && !HEX.test(value[key])) throw new Error(`${key} invalid`);
  if (value.state === 'QUALIFIED' && (!value.before_qualification_fingerprint || !value.after_qualification_fingerprint)) throw new Error('Qualified adapter requires before/after qualification evidence');
  const normalized = { schema_version: value.schema_version, id: string(value.id, 'adapter id'), version: string(value.version, 'adapter version'), state: value.state, target: { kind: value.target.kind, model_reference: string(value.target.model_reference, 'adapter target model_reference') }, mitigation: string(value.mitigation, 'adapter mitigation'), triggering_failure_class: string(value.triggering_failure_class, 'adapter triggering_failure_class'), evidence_refs: evidence, evaluation_protocol_fingerprint: value.evaluation_protocol_fingerprint, before_qualification_fingerprint: value.before_qualification_fingerprint, after_qualification_fingerprint: value.after_qualification_fingerprint };
  const calculated = sha(normalized);
  if (requireFingerprint && value.fingerprint !== calculated) throw new Error('BehavioralAdapter fingerprint mismatch');
  return { ...normalized, fingerprint: value.fingerprint ?? calculated };
}
export function createBehavioralAdapter(input) {
  const { fingerprint: ignored, ...draft } = input;
  return Object.freeze(validateBehavioralAdapter({ ...draft, schema_version: BEHAVIORAL_ADAPTER_SCHEMA_VERSION }, { requireFingerprint: false }));
}
/** Qualified exact-model adapters win; a family adapter is used only when no exact model adapter exists. */
export function selectBehavioralAdapter({ model_reference, family_reference = null, adapters = [] } = {}) {
  const qualified = adapters.map(validateBehavioralAdapter).filter((adapter) => adapter.state === 'QUALIFIED');
  const exact = qualified.filter((adapter) => adapter.target.kind === 'EXACT_MODEL' && adapter.target.model_reference === model_reference).sort((a, b) => a.id.localeCompare(b.id));
  if (exact.length > 1) throw new Error('Ambiguous qualified exact-model adapters');
  if (exact.length) return exact[0];
  const family = qualified.filter((adapter) => adapter.target.kind === 'MODEL_FAMILY' && adapter.target.model_reference === family_reference).sort((a, b) => a.id.localeCompare(b.id));
  if (family.length > 1) throw new Error('Ambiguous qualified family adapters');
  return family[0] || null;
}
