import assert from 'node:assert/strict';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  createPreExecutionAuthorityGuardOptions,
  decidePreExecutionAuthority,
  PRE_EXECUTION_GUARD_DECISIONS,
  resolvePreExecutionGuardTarget,
} from '../packages/harness-runtime/lib/pre-execution-authority-guard.mjs';

const root = new URL('..', import.meta.url).pathname;
const { contracts } = loadAgentContracts({ baseDir: root });
const options = createPreExecutionAuthorityGuardOptions({ contracts });

function decision(command, role = 'coder') {
  return decidePreExecutionAuthority({ command, role, authorityByRole: options.authorityByRole });
}

const stageForms = [
  'git add file', 'git add -- file', 'git -C . add file', 'git --git-dir=.git add file',
  'GIT_DIR=.git git add file', 'GIT_WORK_TREE=. git add file', 'GIT_OPTIONAL_LOCKS=0 git add file',
  'env git add file', 'env -i git add file', 'env GIT_OPTIONAL_LOCKS=0 git add file', '/usr/bin/git add file',
  'command git add file', 'command /usr/bin/git add file', '/usr/bin/env git add file',
  '/usr/bin/env GIT_OPTIONAL_LOCKS=0 git add file',
];
const commitForms = [
  'git commit -m test', 'git -C . commit -m test', 'git --git-dir=.git commit -m test',
  'GIT_DIR=.git git commit -m test', 'env git commit -m test', '/usr/bin/git commit -m test',
];
const pushForms = [
  'git push origin branch', 'git -C . push origin branch', 'git --git-dir=.git push origin branch',
  'GIT_DIR=.git git push origin branch', 'env git push origin branch', '/usr/bin/git push origin branch',
];

for (const [forms, effect] of [[stageForms, 'stage'], [commitForms, 'commit'], [pushForms, 'push']]) {
  for (const command of forms) {
    const found = decision(command);
    assert.equal(found.decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, command);
    assert.equal(found.effect, effect, command);
    assert.equal(found.code, 'OCODE_ROLE_EFFECT_DENIED', command);
  }
}

for (const role of ['orchestrator', 'reviewer', 'verifier']) {
  for (const command of [...stageForms, ...commitForms, ...pushForms]) {
    assert.equal(decision(command, role).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, `${role}: ${command}`);
  }
  assert.equal(decision('git restore file', role).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, `${role} cannot edit through Git`);
}

assert.equal(decision('git restore file').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, 'coder retains existing repository edit authority');
assert.equal(decision('uname -a').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, 'ordinary unknown command remains native-policy-owned');
assert.equal(decision('git status --short').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, 'safe Git observation remains native-policy-owned');
assert.equal(decision('git status && git add file').decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'composition cannot hide governed Git');
assert.equal(decision('git status ; git add file').decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'semicolon composition cannot hide governed Git');
assert.equal(decision("sh -c 'git add file'").decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'nested sh is fail-closed');
assert.equal(decision("bash -c 'git add file'").decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'nested bash is fail-closed');
assert.equal(decision("zsh -c 'git add file'").decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'nested zsh is fail-closed');
assert.equal(decision('git mystery').decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, 'unclassified Git is fail-closed');
assert.equal(decision('git add file', null).reason, 'ROLE_AUTHORITY_UNAVAILABLE');
assert.equal(resolvePreExecutionGuardTarget('echo git add file'), null, 'non-invoked git text does not become an authority decision');

console.log(JSON.stringify({
  status: 'PRE_EXECUTION_AUTHORITY_GUARD_PROVEN',
  stage_forms: stageForms.length,
  commit_forms: commitForms.length,
  push_forms: pushForms.length,
  nested_shell: 'DENY',
  ordinary_unknown: 'CONTINUE',
}));
