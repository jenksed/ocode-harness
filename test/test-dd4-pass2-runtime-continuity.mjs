import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionAuthority, createEffectRequest, ingestEffectEvidence } from '../packages/harness-runtime/lib/authority-evidence.mjs';
import { OPERATION_CLASSES, createRuntimeAuthoritySession, identifyRepository, evaluateAuthorityRequest, recordOperatorDecision, createAuthorityContext, inheritAuthorityContext, executeVerificationWorktree, cleanupVerificationWorktree } from '../packages/harness-runtime/lib/runtime-continuity.mjs';
import { createTaskCapsule, renderTaskCapsuleDelegationContext } from '../packages/harness-runtime/lib/task-capsule.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const root = mkdtempSync(join(tmpdir(), 'ocode-dd4-pass2-'));
try {
  git(root, ['init']); git(root, ['config', 'user.email', 'pass2@example.test']); git(root, ['config', 'user.name', 'Pass 2']);
  writeFileSync(join(root, 'README.md'), 'fixture\n'); git(root, ['add', 'README.md']); git(root, ['commit', '-m', 'fixture']);
  const revision = git(root, ['rev-parse', 'HEAD']); writeFileSync(join(root, 'dirty.txt'), 'operator worktree remains dirty\n');
  const repository = identifyRepository(root);
  const authority = createExecutionAuthority({ authority_id: 'pass2-authority', operation_classes: [OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, OPERATION_CLASSES.RUN_LOCAL_VALIDATION, OPERATION_CLASSES.MUTATE_WORKSPACE, OPERATION_CLASSES.LOCAL_GIT_HISTORY_MUTATION] });
  const session = createRuntimeAuthoritySession({ repository, work_scope: 'work-package-a' });
  const request = createEffectRequest({ authority, request_id: 'worktree-one', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, repository_id: repository.repository_id, work_scope: 'work-package-a', revision });
  const primaryBefore = { status: git(root, ['status', '--porcelain=v1']), head: git(root, ['rev-parse', 'HEAD']), branch: git(root, ['branch', '--show-current']) };

  // Original dogfood failure: no approval means no deterministic Git effect.
  assert.equal(evaluateAuthorityRequest({ session, request }).status, 'APPROVAL_REQUIRED');
  const unapproved = executeVerificationWorktree({ session, request });
  assert.equal(unapproved.admission.status, 'APPROVAL_REQUIRED'); assert.equal(unapproved.environment, null); assert.equal(git(root, ['status', '--porcelain=v1']), primaryBefore.status);
  assert.equal(evaluateAuthorityRequest({ session, request, assistant_claim: 'the user approved it' }).status, 'APPROVAL_REQUIRED');

  // Structured native decision creates the runtime grant; retry changes admission.
  const approved = recordOperatorDecision({ session, request, decision: 'APPROVE', decision_id: 'native-approval-1' });
  assert.equal(approved.status, 'GRANT_CREATED'); assert.equal(evaluateAuthorityRequest({ session, request }).status, 'ADMITTED');
  const first = executeVerificationWorktree({ session, request });
  assert.equal(first.admission.status, 'ADMITTED'); assert.equal(first.receipt.success, true); assert.equal(first.reused, false); assert.equal(existsSync(first.environment.path), true);
  assert.equal(ingestEffectEvidence({ request, receipt: first.receipt, report: { request_id: request.request_id, claim: 'verification worktree created' } }).state, 'SATISFIED');
  const replay = executeVerificationWorktree({ session, request }); assert.equal(replay.reused, true); assert.equal(replay.environment.path, first.environment.path);

  // Runtime-verifiable context crosses roles; the serializable references do not themselves grant anything.
  const context = createAuthorityContext({ session });
  for (const role of ['orchestrator', 'coder', 'verifier', 'reviewer']) assert.equal(inheritAuthorityContext({ session, context, role }).grant_ids[0], approved.grant_id);
  const capsule = createTaskCapsule({ task_id: 'pass2scope', revision: 1, parent_fingerprint: null, objective: 'verify exact source', authoritative_inputs: [{ id: 'fixture', kind: 'PATH', reference: 'README.md', fingerprint: 'a'.repeat(64), description: 'fixture' }], scope: { include_paths: ['README.md'], exclude_paths: [] }, non_goals: [], constraints: [], acceptance: [{ id: 'verified', requirement: 'fixture verified', required_evidence: ['worktree'] }], stop_conditions: [], context: { path_refs: [], evidence_refs: [], max_supplied_chars: 4096, max_expansions: 0 }, assumptions: [], provenance: { workflow_id: 'pass2', run_id: null, session_id: null, role: 'orchestrator' }, authority_context: context });
  assert.match(renderTaskCapsuleDelegationContext(capsule), new RegExp(approved.grant_id));

  // Grant reuse covers an equivalent new lifecycle without another approval.
  const secondRequest = createEffectRequest({ authority, request_id: 'worktree-two', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, repository_id: repository.repository_id, work_scope: 'work-package-a', revision });
  assert.equal(evaluateAuthorityRequest({ session, request: secondRequest }).status, 'ADMITTED');
  const second = executeVerificationWorktree({ session, request: secondRequest }); assert.equal(second.receipt.success, true);

  // Rejection, repository/task mismatch, broader operation, and hard denial fail closed.
  const rejected = createEffectRequest({ authority, request_id: 'rejected', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MUTATE_WORKSPACE, repository_id: repository.repository_id, work_scope: 'work-package-a', revision });
  assert.equal(recordOperatorDecision({ session, request: rejected, decision: 'REJECT' }).status, 'REJECTED'); assert.equal(evaluateAuthorityRequest({ session, request: rejected }).code, 'OPERATOR_REJECTED');
  const wrongRepo = createEffectRequest({ authority, request_id: 'wrong-repo', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, repository_id: '/different/repository', work_scope: 'work-package-a', revision });
  assert.equal(evaluateAuthorityRequest({ session, request: wrongRepo }).code, 'AUTHORITY_SCOPE_MISMATCH');
  const wrongScope = createEffectRequest({ authority, request_id: 'wrong-scope', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, repository_id: repository.repository_id, work_scope: 'work-package-b', revision });
  assert.equal(evaluateAuthorityRequest({ session, request: wrongScope }).code, 'AUTHORITY_SCOPE_MISMATCH');
  const broader = createEffectRequest({ authority, request_id: 'history', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.LOCAL_GIT_HISTORY_MUTATION, repository_id: repository.repository_id, work_scope: 'work-package-a', revision });
  assert.equal(evaluateAuthorityRequest({ session, request: broader }).code, 'HARD_DENY_OPERATION');

  const cleanupFirst = cleanupVerificationWorktree({ session, request }); const cleanupSecond = cleanupVerificationWorktree({ session, request: secondRequest });
  assert.equal(cleanupFirst.receipt.success, true); assert.equal(cleanupSecond.receipt.success, true); assert.equal(existsSync(first.environment.path), false); assert.deepEqual(cleanupFirst.primary_before, cleanupFirst.primary_after); assert.deepEqual(primaryBefore, cleanupFirst.primary_after);
  console.log('DD4_PASS_2_RUNTIME_CONTINUITY_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
