import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// This is the sole authority for Ocode-owned mutable per-worktree state.
// Project files are deliberately never consulted for the destination.
export const RUNTIME_STATE_DIRECTORY = 'ocode';

function environmentValue(environment, name) {
  const value = environment?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function runtimeStateRoot({ environment = process.env } = {}) {
  const configured = environmentValue(environment, 'XDG_STATE_HOME');
  return resolve(configured || join(environmentValue(environment, 'HOME') || homedir(), '.local', 'state'), RUNTIME_STATE_DIRECTORY);
}

export function worktreeRoot(projectDir) {
  const requested = realpathSync(resolve(projectDir));
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: requested, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error || result.status !== 0 || !result.stdout.trim()) return requested;
  return realpathSync(result.stdout.trim());
}

export function runtimeStateIdentity(projectDir) {
  const worktree = worktreeRoot(projectDir);
  return {
    worktree_root: worktree,
    id: createHash('sha256').update(`ocode-runtime-state-v1\0${worktree}`, 'utf8').digest('hex'),
  };
}

export function resolveRuntimeState(projectDir, { environment = process.env } = {}) {
  const identity = runtimeStateIdentity(projectDir);
  const root = join(runtimeStateRoot({ environment }), 'worktrees', identity.id);
  return Object.freeze({
    root,
    state_root: runtimeStateRoot({ environment }),
    ...identity,
    orientation_json: join(root, 'orientation.json'),
    orientation_markdown: join(root, 'orientation.md'),
    activity: join(root, 'activity'),
    ledger: join(root, 'run-ledger.jsonl'),
  });
}
