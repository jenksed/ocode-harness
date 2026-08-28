import { validateBindingProfile, getRoleBinding } from './opencode-integration.mjs';
import { selectBehavioralAdapter } from './behavioral-adapters.mjs';

export const CAPABILITY_RESOLUTION_SCHEMA_VERSION = 1;
function string(value, label) { if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`); return value; }
function candidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('candidate must be an object');
  for (const key of Object.keys(value)) if (!['model_reference', 'capabilities', 'qualification_status', 'available', 'family_reference', 'effective_model_status'].includes(key)) throw new Error(`Unknown candidate field: ${key}`);
  if (!['QUALIFIED', 'UNPROVEN', 'NOT_QUALIFIED', 'NOT_EVALUATED', 'STALE', 'UNAVAILABLE'].includes(value.qualification_status)) throw new Error('candidate qualification_status invalid');
  return { model_reference: string(value.model_reference, 'candidate model_reference'), capabilities: [...new Set(value.capabilities || [])].sort(), qualification_status: value.qualification_status, available: value.available === true, family_reference: value.family_reference ?? null, effective_model_status: value.effective_model_status ?? 'KNOWN' };
}
/** This resolver selects an existing OpenCode model identifier; it does not route providers or infer opaque auto:* identities. */
export function resolveCapabilityExecution({ profile, role, required_capability, candidates, explicit_model = null, adapters = [] } = {}) {
  validateBindingProfile(profile); string(role, 'role'); string(required_capability, 'required_capability');
  const configured = getRoleBinding(profile, role);
  const pool = candidates.map(candidate).filter((entry) => entry.capabilities.includes(required_capability) && entry.available);
  const requested = explicit_model || configured;
  const ordered = [...pool.filter((entry) => entry.model_reference === requested), ...pool.filter((entry) => entry.model_reference !== requested && entry.qualification_status === 'QUALIFIED').sort((a, b) => a.model_reference.localeCompare(b.model_reference)), ...pool.filter((entry) => entry.model_reference !== requested && entry.qualification_status !== 'QUALIFIED').sort((a, b) => a.model_reference.localeCompare(b.model_reference))];
  const selected = ordered[0] || null;
  if (!selected) return { schema_version: CAPABILITY_RESOLUTION_SCHEMA_VERSION, status: 'NO_CANDIDATE', requested_model: requested, selected_model: null, qualification_status: 'UNPROVEN', adapter: null, reason: 'NO_AVAILABLE_CAPABILITY_CANDIDATE' };
  const adapter = selectBehavioralAdapter({ model_reference: selected.model_reference, family_reference: selected.family_reference, adapters });
  return { schema_version: CAPABILITY_RESOLUTION_SCHEMA_VERSION, status: selected.qualification_status === 'QUALIFIED' ? 'QUALIFIED_SELECTION' : 'UNPROVEN_FALLBACK', requested_model: requested, selected_model: selected.model_reference, qualification_status: selected.qualification_status, effective_model_status: selected.effective_model_status, adapter: adapter ? { id: adapter.id, fingerprint: adapter.fingerprint } : null, reason: explicit_model ? 'EXPLICIT_MODEL_VALID' : selected.model_reference === configured ? 'PROFILE_BINDING_VALID' : 'QUALIFIED_FALLBACK' };
}
