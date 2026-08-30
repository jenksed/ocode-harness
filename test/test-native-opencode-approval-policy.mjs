import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { removeLegacyRequestEffectTools } from '../packages/harness-runtime/lib/deploy.mjs';
import { projectBashCommand } from '../packages/harness-runtime/lib/permission-projection.mjs';
import { createNativeBashPermissionRules, decideEffectAdmission, createRuntimePermissionProjection } from '../packages/harness-runtime/lib/command-admission.mjs';

const root = resolve(import.meta.dirname, '..');
const { contracts } = loadAgentContracts({ baseDir: root });
const orchestrator = contracts.get('orchestrator');
const coder = contracts.get('coder');

const readOnlyCommands = [
  'ls -la',
  'pwd',
  'rg activity packages',
  'grep -R activity packages',
  'git status --short',
  'git diff',
  'git log',
  'git show',
  'git rev-parse --show-toplevel',
  'git worktree list --porcelain',
  'git branch --show-current',
  'git branch --list feature/*',
  'git branch -a',
  'git branch -r',
];

for (const [role, contract] of contracts) {
  for (const command of readOnlyCommands) {
    assert.equal(projectBashCommand(contract.permissions.bash, command).state, 'ALLOW', `${role}: ${command}`);
  }
}

assert.equal(projectBashCommand(createNativeBashPermissionRules({ baseRules: orchestrator.permissions.bash, roleAuthority: orchestrator.authority }), 'uname -a').state, 'DENY');
assert.equal(projectBashCommand(createNativeBashPermissionRules({ baseRules: orchestrator.permissions.bash, roleAuthority: orchestrator.authority }), 'npm test').state, 'DENY');
assert.equal(projectBashCommand(createNativeBashPermissionRules({ baseRules: orchestrator.permissions.bash, roleAuthority: orchestrator.authority }), 'git add test.txt').state, 'DENY');
for (const command of ['git push origin main', 'git reset --hard', 'git clean -fd', 'rm -rf tmp']) {
  assert.equal(projectBashCommand(orchestrator.permissions.bash, command).state, 'DENY', command);
}
assert.equal(projectBashCommand(coder.permissions.bash, 'git add test.txt').state, 'DENY');
assert.equal(decideEffectAdmission({ effect: 'repository.edit', role: 'orchestrator', authority: orchestrator.authority }).code, 'OCODE_ROLE_EFFECT_DENIED');
assert.equal(decideEffectAdmission({ effect: 'repository.edit', role: 'orchestrator', authority: orchestrator.authority }).owner, 'coder');
assert.equal(decideEffectAdmission({ effect: 'repository.edit', role: 'coder', authority: coder.authority }).decision, 'ALLOW');
const projected = createRuntimePermissionProjection({ contracts, projectDir: root });
const order = Object.keys(projected.agents.orchestrator.permission.bash);
const before = (left, right) => assert.ok(order.indexOf(left) < order.indexOf(right), `${left} must precede ${right}: ${order.join(', ')}`);
before('*', 'git *');
before('git *', 'git status');
before('git status *', 'git push');
before('git push *', '*>*');
before('*>*', '*<*');
assert.equal(projectBashCommand({ pwd: 'deny', '*': 'allow' }, 'pwd').state, 'ALLOW', 'later catch-all wins under native semantics');
assert.equal(projectBashCommand({ '*': 'allow', pwd: 'deny' }, 'pwd').state, 'DENY', 'later exact rule wins under native semantics');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'echo unsafe > file').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'git add file').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'git commit -m x').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'git push origin main').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'git status --short').state, 'ALLOW');
assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, 'git worktree list').state, 'ALLOW');
for (const command of ['ls . && touch marker.txt', 'rg needle fixture.txt | tee marker.txt', 'git status --short && touch marker.txt', 'git diff | tee marker.txt', 'find . -maxdepth 1; touch marker.txt']) {
  assert.equal(projectBashCommand(projected.agents.orchestrator.permission.bash, command).state, 'DENY', command);
}
for (const command of ['git show --output=marker.txt HEAD', 'git diff --output=marker.txt', 'git log --output=marker.txt', 'find . -delete', 'find . -exec touch marker.txt \\;', 'tree -o marker.txt']) {
  assert.notEqual(projectBashCommand(projected.agents.orchestrator.permission.bash, command).state, 'ALLOW', command);
}
assert.equal(projectBashCommand(projected.agents.coder.permission.bash, 'git add file').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.coder.permission.bash, 'git commit -m x').state, 'DENY');
assert.equal(projectBashCommand(projected.agents.coder.permission.bash, 'git push origin main').state, 'DENY');
assert.notEqual(projectBashCommand(orchestrator.permissions.bash, 'git branch -D stale').state, 'ALLOW');

const orchestratorSource = readFileSync(resolve(root, 'agents/orchestrator.md'), 'utf8');
const coderSource = readFileSync(resolve(root, 'agents/coder.md'), 'utf8');
const launcher = readFileSync(resolve(root, 'packages/harness-runtime/bin/ocode.mjs'), 'utf8');
const installer = readFileSync(resolve(root, 'installer/install.mjs'), 'utf8');
const deploy = readFileSync(resolve(root, 'packages/harness-runtime/lib/deploy.mjs'), 'utf8');
const architecture = readFileSync(resolve(root, 'docs/architecture/approval-first-execution.md'), 'utf8');

assert.match(orchestratorSource, /native Bash tool/);
assert.match(coderSource, /EFFECT REQUEST/);
assert.match(launcher, /const runtimeIdentity = qualifyRuntimeIdentity\(/);
assert.doesNotMatch(launcher, /spawnSync\('opencode'/);
for (const source of [launcher, installer]) {
  assert.doesNotMatch(source, /request_effect|Allow once\?|ocode effect|ALLOW_ONCE/);
}
assert.doesNotMatch(orchestratorSource, /request_effect|ALLOW_ONCE/);
assert.doesNotMatch(coderSource, /request_effect|ALLOW_ONCE/);
assert.match(architecture, /one approval owner and one operator interaction/i);
assert.match(architecture, /OpenCode's native permission UI/);
for (const path of [
  'opencode-tools/request_effect.js',
  'packages/harness-runtime/lib/approval-first-effect-execution.mjs',
  'packages/harness-runtime/lib/approval-first-effect-tool.mjs',
  'packages/harness-runtime/lib/approval-first-tool-deploy.mjs',
  'packages/harness-runtime/lib/opencode-permission-mediation.mjs',
  'docs/program/approval-first-operational-checkpoint.md',
  'docs/program/approval-first-remaining-work.md',
]) assert.equal(existsSync(resolve(root, path)), false, path);

const toolsDir = join(tmpdir(), `ocode-native-approval-${process.pid}`, 'tools');
mkdirSync(toolsDir, { recursive: true });
const legacyTool = join(toolsDir, 'request_effect.js');
const userTool = join(toolsDir, 'request_effect.mjs');
writeFileSync(legacyTool, '// OCODE_HARNESS_ROOT approval-first-effect-tool\n');
writeFileSync(userTool, '// user-owned tool\n');
assert.deepEqual(removeLegacyRequestEffectTools(join(tmpdir(), `ocode-native-approval-${process.pid}`, 'opencode.json')), [legacyTool]);
assert.equal(existsSync(legacyTool), false);
assert.equal(existsSync(userTool), true);

console.log('NATIVE_OPENCODE_APPROVAL_POLICY_PROVEN');
