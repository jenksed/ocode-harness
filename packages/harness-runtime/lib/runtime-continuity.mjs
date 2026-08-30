import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRuntimeExecutionReceipt, isRuntimeEffectRequest } from './authority-evidence.mjs';

export const OPERATION_CLASSES = Object.freeze({
  OBSERVE_REPOSITORY: 'OBSERVE_REPOSITORY',
  RUN_LOCAL_VALIDATION: 'RUN_LOCAL_VALIDATION',
  MANAGE_EPHEMERAL_VERIFICATION_WORKTREE: 'MANAGE_EPHEMERAL_VERIFICATION_WORKTREE',
  MUTATE_WORKSPACE: 'MUTATE_WORKSPACE',
  LOCAL_GIT_HISTORY_MUTATION: 'LOCAL_GIT_HISTORY_MUTATION',
  PROTECTED_INTEGRATION: 'PROTECTED_INTEGRATION',
  EXTERNAL_EFFECT: 'EXTERNAL_EFFECT',
  DESTRUCTIVE_EFFECT: 'DESTRUCTIVE_EFFECT',
});

const SESSION = Symbol('runtime-authority-session');
const GRANT = Symbol('runtime-authority-grant');
const HARD_DENY = new Set([OPERATION_CLASSES.LOCAL_GIT_HISTORY_MUTATION, OPERATION_CLASSES.PROTECTED_INTEGRATION, OPERATION_CLASSES.EXTERNAL_EFFECT, OPERATION_CLASSES.DESTRUCTIVE_EFFECT]);

function command(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function requireString(value, label) { if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`); return value; }

export function identifyRepository(cwd) {
  const root = realpathSync(command(cwd, ['rev-parse', '--show-toplevel']));
  return Object.freeze({ repository_id: root, root, head: command(root, ['rev-parse', 'HEAD']) });
}

/** Runtime-owned session state; it is intentionally in-process and work-scoped. */
export function createRuntimeAuthoritySession({ repository, work_scope } = {}) {
  if (!repository?.repository_id) throw new Error('runtime session requires identified repository');
  return { repository: Object.freeze({ ...repository }), work_scope: requireString(work_scope, 'work_scope'), grants: new Map(), decisions: new Map(), worktrees: new Map(), [SESSION]: true };
}

function sameScope(session, request) {
  return request.repository_id === session.repository.repository_id && request.work_scope === session.work_scope;
}

export function evaluateAuthorityRequest({ session, request } = {}) {
  if (!session?.[SESSION] || !isRuntimeEffectRequest(request)) throw new Error('runtime admission requires session and runtime request');
  if (!sameScope(session, request)) return Object.freeze({ status: 'DENIED', code: 'AUTHORITY_SCOPE_MISMATCH', request_id: request.request_id });
  if (HARD_DENY.has(request.operation_class)) return Object.freeze({ status: 'DENIED', code: 'HARD_DENY_OPERATION', request_id: request.request_id });
  if (session.decisions.get(request.request_id)?.status === 'REJECTED') return Object.freeze({ status: 'DENIED', code: 'OPERATOR_REJECTED', request_id: request.request_id });
  for (const grant of session.grants.values()) {
    if (grant.operation_classes.includes(request.operation_class) && grant.repository_id === request.repository_id && grant.work_scope === request.work_scope && !grant.revoked) {
      return Object.freeze({ status: 'ADMITTED', request_id: request.request_id, grant_id: grant.grant_id });
    }
  }
  return Object.freeze({ status: 'APPROVAL_REQUIRED', request_id: request.request_id, operation_class: request.operation_class });
}

/** Structured operator decision only.  Prose is not an input to this API. */
export function recordOperatorDecision({ session, request, decision, decision_id = randomUUID() } = {}) {
  if (!session?.[SESSION] || !isRuntimeEffectRequest(request)) throw new Error('operator decision requires runtime session and request');
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new Error('operator decision must be APPROVE or REJECT');
  const prior = session.decisions.get(request.request_id);
  if (prior) return prior;
  if (evaluateAuthorityRequest({ session, request }).status !== 'APPROVAL_REQUIRED') throw new Error('operator decision is not applicable to this request');
  const result = decision === 'REJECT'
    ? Object.freeze({ status: 'REJECTED', decision_id, request_id: request.request_id })
    : (() => {
      const grant = Object.freeze({ grant_id: randomUUID(), authority_id: request.authority_id, repository_id: request.repository_id, work_scope: request.work_scope, operation_classes: Object.freeze([request.operation_class]), source: 'OPERATOR_APPROVAL', revoked: false, [GRANT]: true });
      session.grants.set(grant.grant_id, grant);
      return Object.freeze({ status: 'GRANT_CREATED', decision_id, request_id: request.request_id, grant_id: grant.grant_id });
    })();
  session.decisions.set(request.request_id, result);
  return result;
}

/** Bridge a native OpenCode permission reply into the only grant-creation path. */
export function recordNativeApprovalEvent({ session, request, event } = {}) {
  if (!event || event.type !== 'permission.replied') throw new Error('native approval event must be permission.replied');
  const properties = event.properties ?? event.data;
  if (!properties || properties.permissionID !== request?.request_id) throw new Error('native approval event does not correlate to request');
  const response = String(properties.response ?? '').toLowerCase();
  const decision = ['allow', 'always', 'once', 'approved', 'grant'].includes(response) ? 'APPROVE' : 'REJECT';
  return recordOperatorDecision({ session, request, decision, decision_id: typeof properties.id === 'string' ? properties.id : randomUUID() });
}

/** A serializable handoff is only a reference; the runtime rechecks it against its session grant store. */
export function createAuthorityContext({ session } = {}) {
  if (!session?.[SESSION]) throw new Error('authority context requires runtime session');
  return Object.freeze({ repository_id: session.repository.repository_id, work_scope: session.work_scope, grant_ids: Object.freeze([...session.grants.keys()].sort()) });
}

export function inheritAuthorityContext({ session, context, role } = {}) {
  if (!session?.[SESSION] || !context || !Array.isArray(context.grant_ids)) throw new Error('role handoff requires runtime session and authority context');
  requireString(role, 'role');
  if (context.repository_id !== session.repository.repository_id || context.work_scope !== session.work_scope || context.grant_ids.some((id) => !session.grants.get(id)?.[GRANT])) throw new Error('authority context is not runtime-verifiable');
  return Object.freeze({ ...context, role });
}

function primarySnapshot(root) {
  return Object.freeze({ status: command(root, ['status', '--porcelain=v1']), head: command(root, ['rev-parse', 'HEAD']), branch: command(root, ['branch', '--show-current']) });
}

function resolveCommit(root, revision) { return command(root, ['rev-parse', '--verify', `${requireString(revision, 'revision')}^{commit}`]); }

/** Runtime-only Git worktree mechanics.  The verifier receives the result, never Git mutation authority. */
export function executeVerificationWorktree({ session, request } = {}) {
  const admission = evaluateAuthorityRequest({ session, request });
  if (admission.status !== 'ADMITTED') return Object.freeze({ admission, receipt: null, environment: null });
  if (request.operation_class !== OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE || request.effect !== 'verification.worktree') throw new Error('request is not a verification-worktree effect');
  const existing = session.worktrees.get(request.request_id);
  if (existing) return Object.freeze({ admission, receipt: existing.receipt, environment: existing.environment, reused: true });
  const root = session.repository.root;
  const before = primarySnapshot(root);
  let target = null;
  try {
    const commit = resolveCommit(root, request.revision);
    target = mkdtempSync(join(tmpdir(), 'ocode-verification-'));
    rmdirSync(target);
    command(root, ['worktree', 'add', '--detach', target, commit]);
    const marker = join(target, '.ocode-managed-verification.json');
    const environment = Object.freeze({ worktree_id: randomUUID(), path: target, revision: commit, marker, primary_before: before });
    writeFileSync(marker, JSON.stringify({ owner: 'ocode', worktree_id: environment.worktree_id, request_id: request.request_id, repository_id: request.repository_id, revision: commit }) + '\n', 'utf8');
    const receipt = createRuntimeExecutionReceipt(request, { success: true, observation: { kind: 'verification.worktree.created', worktree_id: environment.worktree_id, revision: commit } });
    session.worktrees.set(request.request_id, { environment, receipt });
    return Object.freeze({ admission, receipt, environment, reused: false });
  } catch (error) {
    if (target) rmSync(target, { recursive: true, force: true });
    return Object.freeze({ admission, receipt: createRuntimeExecutionReceipt(request, { success: false, stderr: String(error.stderr ?? error.message) }), environment: null, reused: false });
  }
}

export function cleanupVerificationWorktree({ session, request } = {}) {
  if (!session?.[SESSION] || !isRuntimeEffectRequest(request)) throw new Error('cleanup requires runtime session and request');
  const record = session.worktrees.get(request.request_id);
  if (!record) throw new Error('verification worktree is not runtime-owned');
  const { environment } = record;
  const marker = JSON.parse(readFileSync(environment.marker, 'utf8'));
  if (marker.owner !== 'ocode' || marker.worktree_id !== environment.worktree_id || marker.request_id !== request.request_id) throw new Error('verification worktree ownership marker mismatch');
  command(session.repository.root, ['worktree', 'remove', '--force', environment.path]);
  rmSync(environment.path, { recursive: true, force: true });
  session.worktrees.delete(request.request_id);
  const after = primarySnapshot(session.repository.root);
  return Object.freeze({ receipt: createRuntimeExecutionReceipt(request, { success: true, observation: { kind: 'verification.worktree.removed', worktree_id: environment.worktree_id, revision: environment.revision } }), primary_before: environment.primary_before, primary_after: after });
}
