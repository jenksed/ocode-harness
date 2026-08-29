import assert from 'node:assert/strict';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  createPreExecutionAuthorityGuardOptions,
  decidePreExecutionAuthority,
  PRE_EXECUTION_GUARD_DECISIONS,
} from '../packages/harness-runtime/lib/pre-execution-authority-guard.mjs';

const root = new URL('..', import.meta.url).pathname;
const { contracts } = loadAgentContracts({ baseDir: root });
const { authorityByRole } = createPreExecutionAuthorityGuardOptions({ contracts });
const decide = (command, role = 'coder') => decidePreExecutionAuthority({ command, role, authorityByRole });

const stageForms = [
  'git add file', 'git add -- file', 'git -C . add file', 'git --git-dir=.git add file',
  'GIT_DIR=.git git add file', 'GIT_WORK_TREE=. git add file', 'GIT_OPTIONAL_LOCKS=0 git add file',
  'env git add file', 'env -i git add file', 'env GIT_OPTIONAL_LOCKS=0 git add file',
  '/usr/bin/git add file', 'command git add file', 'command /usr/bin/git add file',
  '/usr/bin/env git add file', '/usr/bin/env GIT_OPTIONAL_LOCKS=0 git add file',
];
const commitForms = ['git commit -m test', 'git -C . commit -m test', 'git --git-dir=.git commit -m test', 'GIT_DIR=.git git commit -m test', 'env git commit -m test', '/usr/bin/git commit -m test'];
const pushForms = ['git push origin branch', 'git -C . push origin branch', 'git --git-dir=.git push origin branch', 'GIT_DIR=.git git push origin branch', 'env git push origin branch', '/usr/bin/git push origin branch'];

for (const [forms, effect] of [[stageForms, 'stage'], [commitForms, 'commit'], [pushForms, 'push']]) {
  for (const command of forms) {
    const found = decide(command);
    assert.equal(found.decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, command);
    assert.equal(found.effect, effect, command);
  }
}

for (const command of ['git checkout file', 'git restore file', 'git switch topic', 'git rm file', 'git mv old new', 'git config user.name']) {
  assert.equal(decide(command, 'reviewer').decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, `read-only ${command}`);
  assert.equal(decide(command).decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, `coder owns repository.edit for ${command}`);
}
for (const command of ['git merge topic', 'git rebase main', 'git cherry-pick HEAD', 'git tag release']) {
  assert.equal(decide(command).effect, 'commit', command);
  assert.equal(decide(command).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, command);
}

for (const command of ['git branch --show-current', 'git branch --list', 'git branch --list feature/*', 'git branch -a', 'git branch -r', 'git worktree list', 'git worktree list --porcelain']) {
  assert.equal(decide(command, 'reviewer').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, `observation ${command}`);
}
for (const command of ['git branch -D stale', 'git branch -d stale', 'git branch -m old new', 'git branch -M old new', 'git worktree add ../other branch', 'git worktree remove ../other', 'git worktree move old new', 'git worktree lock ../other', 'git worktree unlock ../other', 'git worktree prune', 'git worktree repair']) {
  assert.equal(decide(command, 'reviewer').decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, `read-only mutation ${command}`);
  assert.equal(decide(command).decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, `coder repository.edit ${command}`);
}

for (const command of ['git status && git add file', 'git status ; git add file', 'git status || git commit -m x', 'git status | git add file', "sh -c 'git add file'", "bash -c 'git add file'", "zsh -c 'git add file'"]) {
  assert.equal(decide(command).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, command);
}
assert.equal(decide('uname -a').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE);
assert.equal(decide('git add file', null).reason, 'ROLE_AUTHORITY_UNAVAILABLE');
assert.equal(decide('uname -a', null).decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE);

console.log(JSON.stringify({ status: 'PRE_EXECUTION_AUTHORITY_GUARD_PROVEN', stage_forms: stageForms.length, commit_forms: commitForms.length, push_forms: pushForms.length, branch_worktree_correction: 'PROVEN' }));
