import assert from 'node:assert/strict';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { createRuntimePermissionProjection, decideCommandAdmission, decideEffectAdmission } from '../packages/harness-runtime/lib/command-admission.mjs';
import { projectBashCommand, projectPermissions } from '../packages/harness-runtime/lib/permission-projection.mjs';

const root = new URL('..', import.meta.url).pathname;
const { contracts } = loadAgentContracts({ baseDir: root });
const projection = createRuntimePermissionProjection({ contracts, projectDir: root });
const effectCommands = ['echo unsafe > program/SUPERSESSION-NOTICE.md', 'git add program/SUPERSESSION-NOTICE.md', 'git commit -m update', 'git push origin main'];
const readOnlyRoles = ['orchestrator', 'planner', 'verifier', 'reviewer', 'committer'];

for (const role of readOnlyRoles) {
  const contract = contracts.get(role); const bash = projection.agents[role].permission.bash;
  assert.equal(projectBashCommand(bash, 'git status --short').state, 'ALLOW', `${role} keeps read-only inspection`);
  for (const command of effectCommands) assert.equal(projectBashCommand(bash, command).state, 'DENY', `${role} cannot bypass mutation authority: ${command}`);
  assert.equal(decideCommandAdmission({ command: 'echo unsafe > file', role, roleAuthority: contract.authority }).code, 'OCODE_ROLE_EFFECT_DENIED');
}

const orchestrator = contracts.get('orchestrator');
const routed = decideEffectAdmission({ effect: 'repository.edit', role: 'orchestrator', authority: orchestrator.authority });
assert.deepEqual({ code: routed.code, owner: routed.owner, action: routed.action }, { code: 'OCODE_ROLE_EFFECT_DENIED', owner: 'coder', action: 'DELEGATE_TO_AUTHORIZED_OWNER' });
assert.equal(decideCommandAdmission({ command: 'git add file', role: 'orchestrator', roleAuthority: orchestrator.authority }).owner, 'deterministic-runtime');

const coder = contracts.get('coder');
assert.equal(projectPermissions(coder.permissions).operations.edit.state, 'ALLOW', 'coder native edit remains admitted');
assert.equal(projectBashCommand(projection.agents.coder.permission.bash, 'npm test').state, 'ALLOW', 'coder admitted validation remains low friction');
for (const command of ['git add file', 'git commit -m update', 'git push origin main']) assert.equal(projectBashCommand(projection.agents.coder.permission.bash, command).state, 'DENY');
assert.equal(decideEffectAdmission({ effect: 'repository.edit', role: 'coder', authority: coder.authority }).decision, 'ALLOW');

console.log(JSON.stringify({ status: 'AUTHORITY_HARDENING_PROVEN', read_only_roles: readOnlyRoles, coder_edit: 'ALLOW', direct_stage_commit_push: 'DENY', effect_routing: 'orchestrator→coder' }));
