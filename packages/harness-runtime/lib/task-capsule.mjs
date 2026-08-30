import { createHash } from 'node:crypto';
import { canonicalJSONStringify } from './agent-contract.mjs';
import { createRepositoryTaskContext } from './repository-snapshot.mjs';

export const TASK_CAPSULE_SCHEMA_VERSION = 3;
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
function normalizeAuthorityContext(value) {
  if (value === undefined || value === null) return null;
  object(value, 'authority_context'); fields(value, ['repository_id', 'work_scope', 'grant_ids'], 'authority_context');
  return { repository_id: string(value.repository_id, 'authority_context.repository_id'), work_scope: string(value.work_scope, 'authority_context.work_scope'), grant_ids: uniqueStrings(value.grant_ids, 'authority_context.grant_ids') };
}

export function taskCapsuleFingerprint(capsule) {
  const { fingerprint: ignored, ...identity } = validateTaskCapsule(capsule, { requireFingerprint: false });
  return fingerprint(identity);
}

export function validateTaskCapsule(capsule, { requireFingerprint = true } = {}) {
  object(capsule, 'TaskCapsule');
  fields(capsule, ['schema_version', 'task_id', 'revision', 'parent_fingerprint', 'objective', 'authoritative_inputs', 'scope', 'non_goals', 'constraints', 'acceptance', 'stop_conditions', 'context', 'assumptions', 'provenance', 'repository_context', 'authority_context', 'fingerprint'], 'TaskCapsule');
  if (![1, 2, TASK_CAPSULE_SCHEMA_VERSION].includes(capsule.schema_version)) throw new Error('TaskCapsule schema_version invalid');
  if (capsule.schema_version === 1 && capsule.repository_context !== undefined) throw new Error('TaskCapsule v1 cannot carry repository_context');
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
    assumptions: uniqueStrings(capsule.assumptions, 'assumptions'), provenance: (() => { object(capsule.provenance, 'provenance'); fields(capsule.provenance, ['workflow_id', 'run_id', 'session_id', 'role'], 'provenance'); const output = {}; for (const key of ['workflow_id', 'run_id', 'session_id', 'role']) { const value = capsule.provenance[key]; if (value !== null && value !== undefined) output[key] = string(value, `provenance.${key}`); else output[key] = null; } return output; })(), authority_context: capsule.schema_version === TASK_CAPSULE_SCHEMA_VERSION ? normalizeAuthorityContext(capsule.authority_context) : null,
  };
  if (capsule.schema_version === TASK_CAPSULE_SCHEMA_VERSION) {
    if (capsule.repository_context === undefined || capsule.repository_context === null) normalized.repository_context = null;
    else {
      object(capsule.repository_context, 'repository_context'); fields(capsule.repository_context, ['snapshot', 'verified_facts', 'decisions', 'evidence', 'observations', 'unknowns'], 'repository_context');
      const context = createRepositoryTaskContext(capsule.repository_context.snapshot, { observations: capsule.repository_context.observations, unknowns: capsule.repository_context.unknowns });
      if (capsule.repository_context.verified_facts !== undefined && canonicalJSONStringify(capsule.repository_context) !== canonicalJSONStringify(context)) throw new Error('repository_context does not match snapshot-derived facts');
      normalized.repository_context = context;
    }
  }
  if (Buffer.byteLength(canonicalJSONStringify(normalized), 'utf8') > normalized.context.max_supplied_chars) throw new Error('TaskCapsule supplied context exceeds budget');
  const calculated = fingerprint(normalized);
  if (requireFingerprint && capsule.fingerprint !== calculated) throw new Error('TaskCapsule fingerprint mismatch');
  return { ...normalized, fingerprint: capsule.fingerprint ?? calculated };
}

export function createTaskCapsule(input) {
  const draft = { ...input, schema_version: input.schema_version ?? TASK_CAPSULE_SCHEMA_VERSION, fingerprint: undefined };
  const normalized = validateTaskCapsule(draft, { requireFingerprint: false });
  return Object.freeze({ ...normalized, fingerprint: taskCapsuleFingerprint(normalized) });
}

export function createTaskCapsuleRevision(previous, next) {
  const prior = validateTaskCapsule(previous);
  const candidate = createTaskCapsule({ ...next, schema_version: next.schema_version ?? TASK_CAPSULE_SCHEMA_VERSION, task_id: prior.task_id, revision: prior.revision + 1, parent_fingerprint: prior.fingerprint });
  return candidate;
}

export function assertTaskCapsuleHandoff(capsule, expectedFingerprint) {
  const normalized = validateTaskCapsule(capsule);
  if (!HEX.test(expectedFingerprint) || normalized.fingerprint !== expectedFingerprint) throw new Error('TASK_CAPSULE_HANDOFF_FINGERPRINT_MISMATCH');
  return normalized;
}

/**
 * Serialize the immutable contract into every governed child prompt.  This is
 * deliberately a bounded directory of authority, not a copied conversation:
 * workers read the listed sources when a loaded term needs its definition.
 */
export function renderTaskCapsuleDelegationContext(capsule) {
  const normalized = validateTaskCapsule(capsule);
  const lines = [
    '## TASK CAPSULE — AUTHORITATIVE DELEGATION CONTEXT',
    `TASK_ID: ${normalized.task_id}`,
    `FINGERPRINT: ${normalized.fingerprint}`,
    `OBJECTIVE: ${normalized.objective}`,
    `RUNTIME_AUTHORITY_REFS: ${normalized.authority_context ? normalized.authority_context.grant_ids.join(', ') || '(none)' : '(none)'}`,
    'AUTHORITATIVE_INPUTS:',
    ...(normalized.authoritative_inputs.length ? normalized.authoritative_inputs.map((input) => `- [${input.kind}] ${input.reference} — ${input.description}`) : ['- (none supplied)']),
    `BOUNDED_RECOVERY_PATHS: ${normalized.context.path_refs.length ? normalized.context.path_refs.join(', ') : '(none supplied)'}`,
    `IN_SCOPE: ${normalized.scope.include_paths.join(', ')}`,
    `OUT_OF_SCOPE: ${normalized.scope.exclude_paths.length ? normalized.scope.exclude_paths.join(', ') : '(none specified)'}`,
    `NON_GOALS: ${normalized.non_goals.length ? normalized.non_goals.join('; ') : '(none specified)'}`,
    'CONSTRAINTS:',
    ...(normalized.constraints.length ? normalized.constraints.map((constraint) => `- ${constraint}`) : ['- (none supplied)']),
    'ACCEPTANCE_PROPERTIES:',
    ...normalized.acceptance.map((entry) => `- ${entry.requirement} (evidence: ${entry.required_evidence.join(', ')})`),
    'STOP_CONDITIONS:',
    ...(normalized.stop_conditions.length ? normalized.stop_conditions.map((condition) => `- ${condition}`) : ['- (none supplied)']),
    'CONTEXT_RECOVERY:',
    '- A loaded term is not an invitation to guess. Read the listed authoritative inputs and the bounded path_refs before reporting ambiguity.',
    '- If authoritative sources materially conflict, return BLOCKED with the exact conflicting sources and statements; do not choose one.',
    '- If the definition is absent after that bounded recovery, return BLOCKED with the missing authority and the smallest owner decision required.',
    '- Do not ask the operator to redefine a term recoverable from this capsule or repository authority. Do not broaden scope or invent semantics.',
  ];
  return lines.join('\n');
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
