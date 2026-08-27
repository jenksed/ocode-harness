import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const STAGING_AUTHORIZATION_SCHEMA_VERSION = 1;

function git(root, args) { return execFileSync('git', args, { cwd: resolve(root), encoding: 'utf8' }); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function paths(root, args) { return git(root, args).split('\n').map((value) => value.trim()).filter(Boolean).sort(); }
function statusPaths(root) {
  return git(root, ['status', '--porcelain=v1'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      if (line.length < 4 || line.slice(0, 2).includes('R') || line.slice(0, 2).includes('C')) throw new Error(`UNSUPPORTED_STATUS_PATH:${line}`);
      return line.slice(3);
    })
    .sort();
}
function validatePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) throw new Error(`Invalid repository-relative path: ${String(value)}`);
  return value;
}
export function fingerprintWorktreeDiff(projectRoot) {
  const status = git(projectRoot, ['status', '--porcelain=v1', '-z']);
  const unstaged = git(projectRoot, ['diff', '--binary']);
  const staged = git(projectRoot, ['diff', '--cached', '--binary']);
  const head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  return sha(`OCODE_WORKTREE_DIFF_V1\0${head}\0${status}\0${unstaged}\0${staged}`);
}
export function createStagingAuthorization({ projectRoot, accepted_paths, reviewer_verdict, lifecycle_state, validation_status, task_capsule_fingerprint, reviewer_diff_fingerprint = null } = {}) {
  if (reviewer_verdict !== 'ACCEPT' || lifecycle_state !== 'CLOSEOUT_READY' || validation_status !== 'PASS') throw new Error('Staging requires accepted review, CLOSEOUT_READY lifecycle, and PASS validation');
  if (!/^[a-f0-9]{64}$/.test(task_capsule_fingerprint)) throw new Error('task_capsule_fingerprint invalid');
  if (!Array.isArray(accepted_paths) || !accepted_paths.length) throw new Error('accepted_paths must be non-empty');
  const accepted = [...new Set(accepted_paths.map(validatePath))].sort();
  const current = fingerprintWorktreeDiff(projectRoot);
  if (reviewer_diff_fingerprint !== null && reviewer_diff_fingerprint !== current) throw new Error('STALE_REVIEW_DIFF');
  const authorization = { schema_version: STAGING_AUTHORIZATION_SCHEMA_VERSION, accepted_paths: accepted, reviewer_verdict, lifecycle_state, validation_status, task_capsule_fingerprint, diff_fingerprint: current };
  return { ...authorization, fingerprint: sha(canonicalJSONStringify(authorization)) };
}
export function executeDeterministicStaging({ projectRoot, authorization } = {}) {
  if (!authorization || authorization.schema_version !== STAGING_AUTHORIZATION_SCHEMA_VERSION) throw new Error('StagingAuthorization schema invalid');
  const canonical = { schema_version: authorization.schema_version, accepted_paths: [...authorization.accepted_paths].sort(), reviewer_verdict: authorization.reviewer_verdict, lifecycle_state: authorization.lifecycle_state, validation_status: authorization.validation_status, task_capsule_fingerprint: authorization.task_capsule_fingerprint, diff_fingerprint: authorization.diff_fingerprint };
  if (sha(canonicalJSONStringify(canonical)) !== authorization.fingerprint) throw new Error('StagingAuthorization fingerprint mismatch');
  if (fingerprintWorktreeDiff(projectRoot) !== authorization.diff_fingerprint) throw new Error('STALE_WORKTREE_DIFF');
  const preStaged = paths(projectRoot, ['diff', '--cached', '--name-only']);
  if (preStaged.length) throw new Error(`PRESTAGED_PATHS_PRESENT:${preStaged.join(',')}`);
  const changed = statusPaths(projectRoot);
  const unexpected = changed.filter((path) => !authorization.accepted_paths.includes(path));
  const missing = authorization.accepted_paths.filter((path) => !changed.includes(path));
  if (unexpected.length || missing.length) throw new Error(`PATH_SET_MISMATCH:unexpected=${unexpected.join(',')};missing=${missing.join(',')}`);
  git(projectRoot, ['add', '--', ...authorization.accepted_paths]);
  const staged = paths(projectRoot, ['diff', '--cached', '--name-only']);
  if (JSON.stringify(staged) !== JSON.stringify(authorization.accepted_paths)) throw new Error('STAGED_PATH_SET_MISMATCH');
  return { status: 'STAGED', staged_paths: staged, authorization_fingerprint: authorization.fingerprint };
}
