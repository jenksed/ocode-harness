import assert from 'node:assert/strict';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { createRuntimePermissionProjection, decideCommandAdmission, decideEffectAdmission } from '../packages/harness-runtime/lib/command-admission.mjs';
import { projectBashCommand, projectPermissions } from '../packages/harness-runtime/lib/permission-projection.mjs';
import { decidePreExecutionAuthority, PRE_EXECUTION_GUARD_DECISIONS, createPreExecutionAuthorityGuardOptions } from '../packages/harness-runtime/lib/pre-execution-authority-guard.mjs';

const root = new URL('..', import.meta.url).pathname;
const { contracts } = loadAgentContracts({ baseDir: root });
const projection = createRuntimePermissionProjection({ contracts, projectDir: root });
const effectCommands = ['echo unsafe > program/SUPERSESSION-NOTICE.md', 'git add program/SUPERSESSION-NOTICE.md', 'git -C . add program/SUPERSESSION-NOTICE.md', 'GIT_DIR=.git git add program/SUPERSESSION-NOTICE.md', 'env git add program/SUPERSESSION-NOTICE.md', '/usr/bin/git add program/SUPERSESSION-NOTICE.md', 'git commit -m update', 'git --git-dir=.git commit -m update', 'env git commit -m update', 'git push origin main', 'git --git-dir=.git push origin main', 'env git push origin main', 'git checkout -- program/SUPERSESSION-NOTICE.md', 'git restore program/SUPERSESSION-NOTICE.md', 'git switch feature'];
const readOnlyRoles = ['orchestrator', 'planner', 'wayfinder', 'researcher', 'verifier', 'reviewer', 'judge', 'committer'];

for (const role of readOnlyRoles) {
  const contract = contracts.get(role); const bash = projection.agents[role].permission.bash;
  assert.equal(projectBashCommand(bash, 'git status --short').state, 'ALLOW', `${role} keeps read-only inspection`);
  for (const command of effectCommands) assert.equal(projectBashCommand(bash, command).state, 'DENY', `${role} cannot bypass mutation authority: ${command}`);
  assert.equal(decideCommandAdmission({ command: 'echo unsafe > file', role, roleAuthority: contract.authority }).decision, 'DENY');
}

const orchestrator = contracts.get('orchestrator');
const routed = decideEffectAdmission({ effect: 'repository.edit', role: 'orchestrator', authority: orchestrator.authority });
assert.deepEqual({ code: routed.code, owner: routed.owner, action: routed.action }, { code: 'OCODE_ROLE_EFFECT_DENIED', owner: 'coder', action: 'DELEGATE_TO_AUTHORIZED_OWNER' });
assert.equal(decideCommandAdmission({ command: 'git add file', role: 'orchestrator', roleAuthority: orchestrator.authority }).owner, 'deterministic-runtime');
for (const [command, effect] of [['git -C . add file', 'stage'], ['git --git-dir=.git commit -m x', 'commit'], ['git restore file', 'repository.edit']]) {
  const denied = decideCommandAdmission({ command, role: 'orchestrator', roleAuthority: orchestrator.authority });
  assert.equal(denied.code, 'OCODE_ROLE_EFFECT_DENIED'); assert.equal(denied.effect, effect);
}
for (const command of ['GIT_DIR=.git git add file', 'env git commit -m x', '/usr/bin/git add file']) {
  const denied = decideCommandAdmission({ command, role: 'orchestrator', roleAuthority: orchestrator.authority });
  assert.equal(denied.code, 'OCODE_ROLE_EFFECT_DENIED');
}

const coder = contracts.get('coder');
const guard = createPreExecutionAuthorityGuardOptions({ contracts });
assert.equal(projectPermissions(coder.permissions).operations.edit.state, 'ALLOW', 'coder native edit remains admitted');
assert.equal(projectBashCommand(projection.agents.coder.permission.bash, 'npm test').state, 'ALLOW', 'coder admitted validation remains low friction');
for (const command of ['git add file', 'git commit -m update', 'git push origin main']) assert.equal(projectBashCommand(projection.agents.coder.permission.bash, command).state, 'DENY');
for (const command of ['git -C . add file', 'git --git-dir=.git commit -m update', 'git --git-dir=.git push origin main']) assert.equal(projectBashCommand(projection.agents.coder.permission.bash, command).state, 'DENY');
for (const command of ['GIT_DIR=.git git add file', 'env git commit -m update', '/usr/bin/git add file']) assert.equal(decidePreExecutionAuthority({ command, role: 'coder', authorityByRole: guard.authorityByRole, capabilitiesByRole: guard.capabilitiesByRole }).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY);
assert.equal(decideEffectAdmission({ effect: 'repository.edit', role: 'coder', authority: coder.authority }).decision, 'ALLOW');

console.log(JSON.stringify({ status: 'AUTHORITY_HARDENING_PROVEN', read_only_roles: readOnlyRoles, coder_edit: 'ALLOW', direct_stage_commit_push: 'DENY', effect_routing: 'orchestrator→coder' }));
