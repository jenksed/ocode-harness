import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// These brands never cross the model-facing JSON boundary.  They make the
// runtime-created receipt distinguishable from a look-alike object assembled
// from assistant output in this process.
const AUTHORITY = Symbol('authority');
const REQUEST = Symbol('effect-request');
const RECEIPT = Symbol('execution-receipt');
const OBSERVATION = Symbol('git-observation');
const GIT_OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

/** A validated Git object identity, never a bare Git-looking string. */
export function createGitObjectId(value) {
  const hex = nonEmpty(value, 'Git object ID').toLowerCase();
  if (!GIT_OBJECT_ID.test(hex)) throw new Error('Git object ID must be a 40- or 64-character lowercase hexadecimal ID');
  return Object.freeze({ value: hex, [GIT_OBJECT_ID_BRAND]: true });
}

// Keep this symbol private while allowing the constructor above to attach it.
const GIT_OBJECT_ID_BRAND = Symbol('git-object-id');

export function isGitObjectId(value) {
  return Boolean(value?.[GIT_OBJECT_ID_BRAND] === true && typeof value.value === 'string' && GIT_OBJECT_ID.test(value.value));
}

/** Create bounded data authority from a trusted orchestration policy. */
export function createExecutionAuthority({ authority_id = randomUUID(), effects } = {}) {
  const id = nonEmpty(authority_id, 'authority_id');
  if (!Array.isArray(effects) || effects.length === 0 || effects.some((effect) => effect !== 'git.observe_head')) {
    throw new Error('authority effects must contain only supported bounded effects');
  }
  return Object.freeze({ authority_id: id, effects: Object.freeze([...new Set(effects)]), [AUTHORITY]: true });
}

/** Model-facing code can request, but cannot claim, the requested effect. */
export function createEffectRequest({ authority, request_id = randomUUID(), effect, git_ref = 'HEAD' } = {}) {
  if (!authority?.[AUTHORITY]) throw new Error('effect request requires runtime-issued authority');
  if (effect !== 'git.observe_head' || !authority.effects.includes(effect)) throw new Error('effect is not authorized');
  const ref = nonEmpty(git_ref, 'git_ref');
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error('git_ref contains unsupported characters');
  return Object.freeze({ request_id: nonEmpty(request_id, 'request_id'), authority_id: authority.authority_id, effect, git_ref: ref, [REQUEST]: true });
}

/** The deterministic substrate is the sole constructor of execution receipts. */
export function executeEffectRequest(request, { cwd = process.cwd() } = {}) {
  if (!request?.[REQUEST]) throw new Error('execution requires a runtime-issued effect request');
  if (request.effect !== 'git.observe_head') throw new Error('unsupported effect');
  let stdout = '', stderr = '', exit_code = 0;
  try {
    stdout = execFileSync('git', ['rev-parse', request.git_ref], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    stdout = String(error.stdout ?? '').trim(); stderr = String(error.stderr ?? '').trim(); exit_code = error.status ?? 1;
  }
  const success = exit_code === 0;
  const observation = success
    ? Object.freeze({ kind: 'git.head', object_id: createGitObjectId(stdout), [OBSERVATION]: true })
    : null;
  return Object.freeze({ request_id: request.request_id, authority_id: request.authority_id, effect: request.effect, success, exit_code, stdout, stderr, observation, [RECEIPT]: true });
}

/**
 * Production evidence boundary for effect-backed acceptance.  Reported text
 * is retained as a claim only; acceptance is derived from a branded receipt
 * whose request/effect binding was created by the deterministic runtime.
 */
export function ingestEffectEvidence({ request, receipt, report } = {}) {
  if (!request?.[REQUEST]) throw new Error('effect evidence requires a runtime-issued request');
  if (!receipt?.[RECEIPT]) throw new Error('effect evidence requires runtime provenance');
  if (receipt.request_id !== request.request_id || receipt.authority_id !== request.authority_id || receipt.effect !== request.effect) {
    throw new Error('runtime receipt does not bind to the requested effect');
  }
  object(report, 'effect report');
  if (report.request_id !== request.request_id || typeof report.claim !== 'string') throw new Error('report must identify its effect request and textual claim');
  if (!receipt.success || !receipt.observation?.[OBSERVATION] || !isGitObjectId(receipt.observation.object_id)) {
    return Object.freeze({ state: 'UNVERIFIED', request_id: request.request_id, claim: report.claim, evidence: null });
  }
  return Object.freeze({
    state: 'SATISFIED', request_id: request.request_id, claim: report.claim,
    evidence: Object.freeze({ origin: 'DETERMINISTIC_RUNTIME', kind: receipt.observation.kind, object_id: receipt.observation.object_id.value, exit_code: receipt.exit_code }),
  });
}
