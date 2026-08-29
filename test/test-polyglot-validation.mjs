import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { createRuntimePermissionProjection, createValidationRegistry, createValidationWrapperEnvironment, decideCommandAdmission, evaluateValidationRegistryFreshness, validateValidationRegistry } from '../packages/harness-runtime/lib/command-admission.mjs';
import { projectBashCommand } from '../packages/harness-runtime/lib/permission-projection.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-polyglot-validation-'));
const harnessRoot = resolve(import.meta.dirname, '..');
const { contracts } = loadAgentContracts({ baseDir: harnessRoot });
const fixture = (name) => join(root, name);
const write = (name, path, source) => writeFileSync(join(fixture(name), path), source, 'utf8');
const make = (name) => {
  const dir = fixture(name);
  // mkdtemp parent is trusted test state; recursive fixture setup is avoided.
  mkdirSync(dir);
  return dir;
};

const cases = [
  {
    id: 'node', files: { 'package.json': JSON.stringify({ scripts: { test: 'node test.mjs', lint: 'node lint.mjs', 'typecheck:ci': 'node types.mjs', deploy: 'node deploy.mjs' } }) },
    commands: ['npm test', 'npm run test', 'npm run lint', 'npm run typecheck:ci'], absent: ['npm run deploy', 'npm install package', 'npm publish'], mutate: (id) => write(id, 'package.json', JSON.stringify({ scripts: { test: 'changed' } })),
  },
  {
    id: 'elixir', files: { 'mix.exs': 'defmodule Fixture.MixProject do\nend\n' }, commands: ['mix test', 'mix compile'], absent: ['mix deps.get', 'mix hex.publish'], mutate: (id) => write(id, 'mix.exs', 'defmodule Changed.MixProject do\nend\n'),
  },
  {
    id: 'python', files: { 'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["test"]\n', 'setup.cfg': '[metadata]\nname = fixture\n' }, commands: ['pytest', 'python -m pytest'], absent: ['pip install package', 'python script.py'], mutate: (id) => write(id, 'pyproject.toml', '[tool.pytest.ini_options]\naddopts = "-q"\n'),
  },
  {
    id: 'go', files: { 'go.mod': 'module example.test/fixture\n\ngo 1.22\n' }, commands: ['go test', 'go test ./...', 'go build', 'go build ./...'], absent: ['go get package', 'go install package'], mutate: (id) => write(id, 'go.mod', 'module example.test/changed\n\ngo 1.22\n'),
  },
  {
    id: 'rust', files: { 'Cargo.toml': '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n' }, commands: ['cargo test', 'cargo build'], absent: ['cargo install package', 'cargo publish'], mutate: (id) => write(id, 'Cargo.toml', '[package]\nname = "changed"\nversion = "0.1.0"\nedition = "2021"\n'),
  },
];

try {
  for (const entry of cases) {
    const dir = make(entry.id);
    for (const [path, source] of Object.entries(entry.files)) write(entry.id, path, source);
    const registry = createValidationRegistry({ projectDir: dir });
    assert.deepEqual(registry.commands, [...entry.commands].sort());
    assert.deepEqual(registry.providers.map((provider) => provider.id), [entry.id]);
    assert.deepEqual(createValidationRegistry({ projectDir: dir }), registry, `${entry.id} discovery is deterministic`);
    validateValidationRegistry(registry);
    assert.throws(() => validateValidationRegistry({ ...registry, commands: [...registry.commands, 'echo forged'] }), /commands invalid|commands are not provider-defined|fingerprint mismatch/);
    for (const command of entry.commands) {
      for (const role of ['coder', 'verifier', 'reviewer']) {
        const contract = contracts.get(role);
        assert.equal(decideCommandAdmission({ command, role, roleCapabilities: contract.capabilities.provides, roleAuthority: contract.authority, validationRegistry: registry, projectDir: dir }).decision, 'ALLOW', `${entry.id}: ${role} ${command}`);
      }
      const contract = contracts.get('orchestrator');
      assert.notEqual(decideCommandAdmission({ command, role: 'orchestrator', roleCapabilities: contract.capabilities.provides, roleAuthority: contract.authority, validationRegistry: registry, projectDir: dir }).decision, 'ALLOW', `${entry.id}: capability gate`);
    }
    for (const command of entry.absent) assert.notEqual(decideCommandAdmission({ command, role: 'coder', roleCapabilities: ['test.execute'], validationRegistry: registry, projectDir: dir }).decision, 'ALLOW', `${entry.id}: ${command}`);
    const projection = createRuntimePermissionProjection({ contracts, projectDir: dir });
    for (const role of ['coder', 'verifier', 'reviewer']) {
      for (const command of entry.commands) assert.equal(projectBashCommand(projection.agents[role].permission.bash, command).state, 'ALLOW', `${entry.id}: native ${role} ${command}`);
    }
    for (const command of entry.commands) assert.notEqual(projectBashCommand(projection.agents.orchestrator.permission.bash, command).state, 'ALLOW', `${entry.id}: native role without test.execute`);
    for (const command of entry.absent) assert.notEqual(projectBashCommand(projection.agents.coder.permission.bash, command).state, 'ALLOW', `${entry.id}: native negative ${command}`);
    const executable = entry.commands[0].split(' ')[0];
    const wrapperEnvironment = createValidationWrapperEnvironment({
      baseDir: harnessRoot, projectDir: dir, registry, environment: process.env, executables: { [executable]: '/usr/bin/true' },
    });
    assert.equal(spawnSync(join(harnessRoot, 'packages/harness-runtime/bin/validation', executable), entry.commands[0].split(' ').slice(1), { cwd: dir, env: wrapperEnvironment }).status, 0, `${entry.id}: generic wrapper current`);
    entry.mutate(entry.id);
    assert.equal(evaluateValidationRegistryFreshness(registry, { projectDir: dir }).status, 'STALE', `${entry.id}: governing change invalidates`);
    assert.notEqual(decideCommandAdmission({ command: entry.commands[0], role: 'coder', roleCapabilities: ['test.execute'], validationRegistry: registry, projectDir: dir }).decision, 'ALLOW', `${entry.id}: stale registry loses admission`);
    assert.equal(spawnSync(join(harnessRoot, 'packages/harness-runtime/bin/validation', executable), entry.commands[0].split(' ').slice(1), { cwd: dir, env: wrapperEnvironment }).status, 125, `${entry.id}: generic wrapper stale`);
  }

  const noPytest = make('python-without-pytest');
  write('python-without-pytest', 'pyproject.toml', '[project]\nname = "plain-python"\n');
  assert.equal(createValidationRegistry({ projectDir: noPytest }).commands.includes('pytest'), false, 'plain Python metadata does not invent pytest');
  console.log(JSON.stringify({ status: 'POLYGLOT_VALIDATION_PROVEN', providers: cases.map((entry) => entry.id), native_projection: 'PROVEN', stale_registries: cases.length }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
