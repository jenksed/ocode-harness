import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionAuthority, createEffectRequest, ingestEffectEvidence } from '../packages/harness-runtime/lib/authority-evidence.mjs';
import { OPERATION_CLASSES, createRuntimeAuthoritySession, createRuntimeAuthorityBridge, identifyRepository, executeVerificationWorktree, cleanupVerificationWorktree } from '../packages/harness-runtime/lib/runtime-continuity.mjs';
import { createActivityExecutionContext, queryActivity } from '../packages/harness-runtime/lib/activity.mjs';
import { createInteractiveActivityCapture } from '../packages/harness-runtime/lib/interactive-activity.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const root = mkdtempSync(join(tmpdir(), 'ocode-dd4-live-'));
try {
  git(root, ['init']); git(root, ['config', 'user.email', 'live@example.test']); git(root, ['config', 'user.name', 'Live']);
  writeFileSync(join(root, 'README.md'), 'live\n'); git(root, ['add', 'README.md']); git(root, ['commit', '-m', 'live']);
  const revision = git(root, ['rev-parse', 'HEAD']); writeFileSync(join(root, 'dirty.txt'), 'unchanged primary worktree\n');
  const repo = identifyRepository(root);
  const authority = createExecutionAuthority({ authority_id: 'live-authority', operation_classes: [OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, OPERATION_CLASSES.MUTATE_WORKSPACE] });
  const session = createRuntimeAuthoritySession({ repository: repo, work_scope: 'live-work' });
  const bridge = createRuntimeAuthorityBridge({ session });
  const activity = createActivityExecutionContext({ activity_store_path: join(root, '.activity'), workflow_id: 'live-runtime', agent_instance_id: 'orchestrator-live' }, { projectDir: root, role: 'orchestrator' });
  const capture = createInteractiveActivityCapture({ projectDir: root, activity, authorityBridge: bridge });
  capture.project({ type: 'session.created', properties: { info: { id: 'root-session', directory: root } } });
  const makeRequest = (id, scope = 'live-work') => createEffectRequest({ authority, request_id: id, effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MANAGE_EPHEMERAL_VERIFICATION_WORKTREE, repository_id: repo.repository_id, work_scope: scope, revision });
  const request = makeRequest('effect-r1');
  assert.equal(bridge.registerRequest({ request, permission_id: 'permission-r1', session_id: 'root-session' }).status, 'APPROVAL_REQUIRED');
  assert.equal(executeVerificationWorktree({ session, request }).environment, null);
  // The actual interactive subscriber entrypoint receives native events; the
  // test never calls the bridge's event handler or grant constructor directly.
  capture.project({ type: 'permission.asked', properties: { id: 'permission-r1', type: 'verification-worktree', sessionID: 'root-session', callID: 'call-r1' } });
  capture.project({ type: 'permission.replied', properties: { permissionID: 'permission-r1', sessionID: 'root-session', response: 'once', id: 'reply-r1' } });
  assert.equal(bridge.admissionFor({ request }).status, 'ADMITTED');
  const execution = executeVerificationWorktree({ session, request });
  assert.equal(execution.receipt.success, true); assert.equal(ingestEffectEvidence({ request, receipt: execution.receipt, report: { request_id: request.request_id, claim: 'created' } }).state, 'SATISFIED');
  assert.equal(executeVerificationWorktree({ session, request }).reused, true);

  // Native correlation negatives: none may become a grant for R1.
  const wrong = createEffectRequest({ authority, request_id: 'effect-r2', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MUTATE_WORKSPACE, repository_id: repo.repository_id, work_scope: 'live-work', revision }); bridge.registerRequest({ request: wrong, permission_id: 'permission-r2', session_id: 'root-session' });
  capture.project({ type: 'permission.replied', properties: { permissionID: 'permission-r2', sessionID: 'other-session', response: 'allow' } });
  assert.equal(bridge.admissionFor({ request: wrong }).status, 'APPROVAL_REQUIRED');
  capture.project({ type: 'permission.replied', properties: { permissionID: 'permission-unknown', sessionID: 'root-session', response: 'allow' } });
  assert.equal(bridge.admissionFor({ request: wrong }).status, 'APPROVAL_REQUIRED');
  const rejected = createEffectRequest({ authority, request_id: 'effect-reject', effect: 'verification.worktree', operation_class: OPERATION_CLASSES.MUTATE_WORKSPACE, repository_id: repo.repository_id, work_scope: 'live-work', revision });
  bridge.registerRequest({ request: rejected, permission_id: 'permission-reject', session_id: 'root-session' });
  capture.project({ type: 'permission.replied', properties: { permissionID: 'permission-reject', sessionID: 'root-session', response: 'deny' } });
  assert.equal(bridge.admissionFor({ request: rejected }).code, 'OPERATOR_REJECTED');
  capture.project({ type: 'permission.replied', properties: { permissionID: 'permission-r1', sessionID: 'root-session', response: 'allow' } });
  assert.equal(bridge.admissionFor({ request }).status, 'ADMITTED');
  assert.equal(bridge.admissionFor({ request: makeRequest('prose-only') }).status, 'ADMITTED', 'grant reuse is semantic; prose was never input');
  const events = queryActivity(join(root, '.activity'), { workflow_id: 'live-runtime' }).events;
  assert.equal(events.some((entry) => entry.event_type === 'APPROVAL_GRANTED' && entry.effect_request_id === 'permission-r1'), true);
  const cleanup = cleanupVerificationWorktree({ session, request });
  assert.deepEqual(cleanup.primary_before, cleanup.primary_after);
  console.log('DD4_PASS_2_LIVE_RUNTIME_CONTINUITY_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
