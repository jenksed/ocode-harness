import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { classifyCommand, createNativeBashPermissionRules, createValidationRegistry, createValidationWrapperEnvironment, decideCommandAdmission } from '../packages/harness-runtime/lib/command-admission.mjs';
import { createPreExecutionAuthorityGuardOptions, decidePreExecutionAuthority, PRE_EXECUTION_GUARD_DECISIONS } from '../packages/harness-runtime/lib/pre-execution-authority-guard.mjs';
import { projectBashCommand } from '../packages/harness-runtime/lib/permission-projection.mjs';

const harnessRoot = resolve('.');
const { contracts } = loadAgentContracts({ baseDir: harnessRoot });
const options = createPreExecutionAuthorityGuardOptions({ contracts });
const root = mkdtempSync(join(tmpdir(), 'ocode-command-authority-'));
const bin = join(root, 'bin'); const marker = join(root, 'executed');
const role = (id) => contracts.get(id);
const decision = (id, command, registry = null) => decideCommandAdmission({ command, role: id, roleAuthority: role(id).authority, roleCapabilities: role(id).capabilities.provides, validationRegistry: registry, projectDir: root });
const guard = (id, command, registry = null) => decidePreExecutionAuthority({ command, role: id, authorityByRole: options.authorityByRole, capabilitiesByRole: options.capabilitiesByRole, validationRegistry: registry, projectDir: root });

try {
  mkdirSync(bin); writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'fixture' } }));
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\nprintf '%s' "$*" > '${marker}'\n`, 'utf8'); chmodSync(join(bin, 'npm'), 0o755);
  const registry = createValidationRegistry({ projectDir: root });
  const wrapperEnvironment = createValidationWrapperEnvironment({ projectDir: root, registry, environment: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }, executables: { npm: join(bin, 'npm') } });
  const wrapper = resolve(harnessRoot, 'packages/harness-runtime/bin/validation/npm');
  assert.equal(spawnSync(wrapper, ['test'], { cwd: root, env: wrapperEnvironment }).status, 0);
  assert.equal(readFileSync(marker, 'utf8'), 'test'); rmSync(marker);
  assert.equal(spawnSync(wrapper, ['test', '--extra'], { cwd: root, env: wrapperEnvironment }).status, 126);
  assert.equal(spawnSync(wrapper, ['install'], { cwd: root, env: wrapperEnvironment }).status, 126);
  assert.equal(existsSync(marker), false, 'non-admitted forms must not execute the real executable'); assert.equal(spawnSync(wrapper, ['test'], { cwd: root, env: { ...wrapperEnvironment, OCODE_VALIDATION_REGISTRY: '{bad' } }).status, 126);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'changed' } }));
  assert.equal(spawnSync(wrapper, ['test'], { cwd: root, env: wrapperEnvironment }).status, 125);

  const observations = ['git merge-base HEAD HEAD', 'git rev-list HEAD', 'git ls-tree HEAD', 'git cat-file -t HEAD', 'git show-ref', 'git ls-files', 'git grep needle', 'git blame file', 'git remote -v', 'git tag --list', 'git config --get user.name', 'git diff -- file', 'find . -type f', 'tree .'];
  for (const command of observations) {
    assert.equal(classifyCommand(command).risk_class, 'OBSERVE', command);
    for (const id of ['coder', 'verifier', 'reviewer']) assert.equal(decision(id, command).decision, 'ALLOW', `${id}: ${command}`);
  }
  for (const command of ['git tag v1.2.3', 'git config user.name changed', 'git remote add origin x', 'find . -delete', 'find . -exec sh -c x \\;', 'tree -o output .']) assert.notEqual(classifyCommand(command).risk_class, 'OBSERVE', command);
  for (const command of ['git add file', 'git commit -m x', 'git push origin main', 'sh -c x', 'bash -c x', 'node -e x', 'python -c x']) {
    assert.equal(decision('coder', command).decision, 'DENY', command);
    assert.equal(guard('coder', command).decision, PRE_EXECUTION_GUARD_DECISIONS.DENY, `guard ${command}`);
  }
  assert.equal(decision('coder', 'touch feature.txt').decision, 'ASK');
  assert.equal(guard('coder', 'touch feature.txt').decision, PRE_EXECUTION_GUARD_DECISIONS.CONTINUE);
  assert.equal(decision('reviewer', 'touch feature.txt').decision, 'DENY');
  const native = createNativeBashPermissionRules({ baseRules: role('coder').permissions.bash, validationRegistry: registry, roleCapabilities: role('coder').capabilities.provides, roleAuthority: role('coder').authority });
  assert.equal(projectBashCommand(native, 'touch feature.txt').state, 'ASK');
  assert.equal(projectBashCommand(native, 'git add file').state, 'DENY');
  assert.equal(projectBashCommand(native, 'git merge-base HEAD HEAD').state, 'ALLOW');
  console.log('COMMAND_AUTHORITY_AND_FAIL_CLOSED_VALIDATION_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
