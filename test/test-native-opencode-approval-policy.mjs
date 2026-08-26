import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { removeLegacyRequestEffectTools } from '../packages/harness-runtime/lib/deploy.mjs';
import { projectBashCommand } from '../packages/harness-runtime/lib/permission-projection.mjs';

const root = resolve(import.meta.dirname, '..');
const { contracts } = loadAgentContracts({ baseDir: root });
const orchestrator = contracts.get('orchestrator');
const coder = contracts.get('coder');

assert.equal(projectBashCommand(orchestrator.permissions.bash, 'uname -a').state, 'ASK');
assert.equal(projectBashCommand(orchestrator.permissions.bash, 'npm test').state, 'ASK');
assert.equal(projectBashCommand(orchestrator.permissions.bash, 'git add test.txt').state, 'ASK');
for (const command of ['git push origin main', 'git reset --hard', 'git clean -fd', 'rm -rf tmp']) {
  assert.equal(projectBashCommand(orchestrator.permissions.bash, command).state, 'DENY', command);
}
assert.equal(projectBashCommand(coder.permissions.bash, 'git add test.txt').state, 'DENY');

const orchestratorSource = readFileSync(resolve(root, 'agents/orchestrator.md'), 'utf8');
const coderSource = readFileSync(resolve(root, 'agents/coder.md'), 'utf8');
const launcher = readFileSync(resolve(root, 'packages/harness-runtime/bin/ocode.mjs'), 'utf8');
const installer = readFileSync(resolve(root, 'installer/install.mjs'), 'utf8');
const deploy = readFileSync(resolve(root, 'packages/harness-runtime/lib/deploy.mjs'), 'utf8');
const architecture = readFileSync(resolve(root, 'docs/architecture/approval-first-execution.md'), 'utf8');

assert.match(orchestratorSource, /native Bash tool/);
assert.match(coderSource, /EFFECT REQUEST/);
assert.match(launcher, /if \(!existsSync\(path\)\) return;/);
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
