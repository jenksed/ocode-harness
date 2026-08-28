import { createHash } from 'node:crypto';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const TASK_CAPSULE_SCHEMA_VERSION = 1;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ACCEPTANCE_STATES = new Set(['SATISFIED', 'UNSATISFIED', 'UNRESOLVED']);

function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function string(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value.trim(); }
function fields(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); }
function path(value, label) { value = string(value, label); if (value.startsWith('/') || value.includes('\\') || value === '.' || value.split('/').includes('..')) throw new Error(`${label} must be a normalized repository-relative path`); return value; }
function fingerprint(value) { return createHash('sha256').update(canonicalJSONStringify(value)).digest('hex'); }
function list(value, label) { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; }
function uniqueStrings(value, label) { const output = list(value, label).map((entry) => string(entry, label)); if (new Set(output).size !== output.length) throw new Error(`${label} must not contain duplicates`); return output; }

function normalizeInputs(inputs) {
  return list(inputs, 'authoritative_inputs').map((entry) => {
    object(entry, 'authoritative input'); fields(entry, ['id', 'kind', 'reference', 'fingerprint', 'description'], 'authoritative input');
    if (!ID.test(entry.id)) throw new Error('authoritative input id invalid');
    const kind = string(entry.kind, 'authoritative input kind');
    const reference = kind === 'PATH' ? path(entry.reference, 'authoritative input reference') : string(entry.reference, 'authoritative input reference');
    if (!HEX.test(entry.fingerprint)) throw new Error('authoritative input fingerprint invalid');
    return { id: entry.id, kind, reference, fingerprint: entry.fingerprint, description: string(entry.description, 'authoritative input description') };
  });
}
function normalizeContext(context) {
  object(context, 'context'); fields(context, ['path_refs', 'evidence_refs', 'max_supplied_chars', 'max_expansions'], 'context');
  const paths = uniqueStrings(context.path_refs, 'context.path_refs').map((entry) => path(entry, 'context.path_refs'));
  const evidence = uniqueStrings(context.evidence_refs, 'context.evidence_refs');
  if (!Number.isInteger(context.max_supplied_chars) || context.max_supplied_chars < 1) throw new Error('context.max_supplied_chars invalid');
  if (!Number.isInteger(context.max_expansions) || context.max_expansions < 0) throw new Error('context.max_expansions invalid');
  return { path_refs: paths, evidence_refs: evidence, max_supplied_chars: context.max_supplied_chars, max_expansions: context.max_expansions };
}
function normalizeAcceptance(acceptance) {
  const output = list(acceptance, 'acceptance').map((entry) => {
    object(entry, 'acceptance'); fields(entry, ['id', 'requirement', 'required_evidence'], 'acceptance');
    if (!ID.test(entry.id)) throw new Error('acceptance id invalid');
    return { id: entry.id, requirement: string(entry.requirement, 'acceptance requirement'), required_evidence: uniqueStrings(entry.required_evidence, 'acceptance required_evidence') };
  });
  if (!output.length || new Set(output.map((entry) => entry.id)).size !== output.length) throw new Error('acceptance IDs must be non-empty and unique');
  return output;
}

export function taskCapsuleFingerprint(capsule) {
  const { fingerprint: ignored, ...identity } = validateTaskCapsule(capsule, { requireFingerprint: false });
  return fingerprint(identity);
}

export function validateTaskCapsule(capsule, { requireFingerprint = true } = {}) {
  object(capsule, 'TaskCapsule');
  fields(capsule, ['schema_version', 'task_id', 'revision', 'parent_fingerprint', 'objective', 'authoritative_inputs', 'scope', 'non_goals', 'constraints', 'acceptance', 'stop_conditions', 'context', 'assumptions', 'provenance', 'fingerprint'], 'TaskCapsule');
  if (capsule.schema_version !== TASK_CAPSULE_SCHEMA_VERSION) throw new Error('TaskCapsule schema_version invalid');
  if (!ID.test(capsule.task_id)) throw new Error('TaskCapsule task_id invalid');
  if (!Number.isInteger(capsule.revision) || capsule.revision < 1) throw new Error('TaskCapsule revision invalid');
  if (capsule.revision === 1 && capsule.parent_fingerprint !== null) throw new Error('Initial TaskCapsule must have null parent_fingerprint');
  if (capsule.revision > 1 && !HEX.test(capsule.parent_fingerprint)) throw new Error('Revised TaskCapsule requires parent_fingerprint');
  object(capsule.scope, 'scope'); fields(capsule.scope, ['include_paths', 'exclude_paths'], 'scope');
  const scope = { include_paths: uniqueStrings(capsule.scope.include_paths, 'scope.include_paths').map((entry) => path(entry, 'scope.include_paths')), exclude_paths: uniqueStrings(capsule.scope.exclude_paths, 'scope.exclude_paths').map((entry) => path(entry, 'scope.exclude_paths')) };
  if (!scope.include_paths.length) throw new Error('scope.include_paths must be non-empty');
  const normalized = {
    schema_version: capsule.schema_version, task_id: capsule.task_id, revision: capsule.revision, parent_fingerprint: capsule.parent_fingerprint,
    objective: string(capsule.objective, 'objective'), authoritative_inputs: normalizeInputs(capsule.authoritative_inputs), scope,
    non_goals: uniqueStrings(capsule.non_goals, 'non_goals'), constraints: uniqueStrings(capsule.constraints, 'constraints'),
    acceptance: normalizeAcceptance(capsule.acceptance), stop_conditions: uniqueStrings(capsule.stop_conditions, 'stop_conditions'), context: normalizeContext(capsule.context),
    assumptions: uniqueStrings(capsule.assumptions, 'assumptions'), provenance: (() => { object(capsule.provenance, 'provenance'); fields(capsule.provenance, ['workflow_id', 'run_id', 'session_id', 'role'], 'provenance'); const output = {}; for (const key of ['workflow_id', 'run_id', 'session_id', 'role']) { const value = capsule.provenance[key]; if (value !== null && value !== undefined) output[key] = string(value, `provenance.${key}`); else output[key] = null; } return output; })(),
  };
  if (Buffer.byteLength(canonicalJSONStringify(normalized), 'utf8') > normalized.context.max_supplied_chars) throw new Error('TaskCapsule supplied context exceeds budget');
  const calculated = fingerprint(normalized);
  if (requireFingerprint && capsule.fingerprint !== calculated) throw new Error('TaskCapsule fingerprint mismatch');
  return { ...normalized, fingerprint: capsule.fingerprint ?? calculated };
}

export function createTaskCapsule(input) {
  const draft = { ...input, schema_version: TASK_CAPSULE_SCHEMA_VERSION, fingerprint: undefined };
  const normalized = validateTaskCapsule(draft, { requireFingerprint: false });
  return Object.freeze({ ...normalized, fingerprint: taskCapsuleFingerprint(normalized) });
}

export function createTaskCapsuleRevision(previous, next) {
  const prior = validateTaskCapsule(previous);
  const candidate = createTaskCapsule({ ...next, schema_version: TASK_CAPSULE_SCHEMA_VERSION, task_id: prior.task_id, revision: prior.revision + 1, parent_fingerprint: prior.fingerprint });
  return candidate;
}

export function assertTaskCapsuleHandoff(capsule, expectedFingerprint) {
  const normalized = validateTaskCapsule(capsule);
  if (!HEX.test(expectedFingerprint) || normalized.fingerprint !== expectedFingerprint) throw new Error('TASK_CAPSULE_HANDOFF_FINGERPRINT_MISMATCH');
  return normalized;
}

export function validateAcceptanceEvidence(capsule, mappings) {
  const normalized = validateTaskCapsule(capsule);
  const entries = list(mappings, 'acceptance mappings').map((entry) => {
    object(entry, 'acceptance mapping'); fields(entry, ['acceptance_id', 'state', 'evidence_refs'], 'acceptance mapping');
    if (!ACCEPTANCE_STATES.has(entry.state)) throw new Error('acceptance mapping state invalid');
    return { acceptance_id: string(entry.acceptance_id, 'acceptance_id'), state: entry.state, evidence_refs: uniqueStrings(entry.evidence_refs, 'evidence_refs') };
  });
  const expected = normalized.acceptance.map((entry) => entry.id).sort();
  if (entries.length !== expected.length || new Set(entries.map((entry) => entry.acceptance_id)).size !== entries.length || entries.some((entry) => !expected.includes(entry.acceptance_id))) throw new Error('acceptance mappings must exactly cover TaskCapsule acceptance IDs');
  for (const entry of entries) if (entry.state === 'SATISFIED' && !entry.evidence_refs.length) throw new Error('SATISFIED acceptance requires evidence');
  return entries;
}
