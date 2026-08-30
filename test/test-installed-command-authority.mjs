import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { materializeVerifiedArtifact } from '../packages/harness-runtime/lib/artifact.mjs';

const repository = resolve('.'); const root = mkdtempSync(join(tmpdir(), 'ocode-installed-command-authority-'));
try {
  const built = buildReleaseArtifact({ sourceRoot: repository, outputDir: join(root, 'artifacts') });
  const installed = materializeVerifiedArtifact(built.archive, join(root, 'install'));
  const admission = await import(pathToFileURL(join(installed.root, 'harness-runtime/lib/command-admission.mjs')).href);
  const guard = await import(pathToFileURL(join(installed.root, 'harness-runtime/lib/pre-execution-authority-guard.mjs')).href);
  const execution = await import(pathToFileURL(join(installed.root, 'harness-runtime/lib/execution.mjs')).href);
  const agents = await import(pathToFileURL(join(installed.root, 'harness-runtime/lib/agent-contract.mjs')).href);
  const profiles = await import(pathToFileURL(join(installed.root, 'harness-runtime/lib/opencode-integration.mjs')).href);
  const wrapper = join(installed.root, 'harness-runtime/bin/validation/npm');
  const project = join(root, 'project'); const bin = join(root, 'bin'); const marker = join(root, 'ran'); mkdirSync(project); mkdirSync(bin);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'fixture' } }));
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(join(bin, 'npm'), 0o755);
  const registry = admission.createValidationRegistry({ projectDir: project });
  const environment = admission.createValidationWrapperEnvironment({ projectDir: project, registry, environment: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, executables: { npm: join(bin, 'npm') } });
  assert.equal(spawnSync(wrapper, ['test', '--extra'], { cwd: project, env: environment }).status, 126);
  assert.equal(existsSync(marker), false);
  const authorityByRole = { coder: { may_edit: true, may_stage: false, may_commit: false, may_push: false } };
  assert.equal(admission.classifyCommand('git merge-base HEAD HEAD').risk_class, 'OBSERVE');
  assert.equal(guard.decidePreExecutionAuthority({ command: 'node -e x', role: 'coder', authorityByRole, capabilitiesByRole: { coder: ['repository.edit'] } }).decision, 'DENY');
  const { manifest, contracts } = agents.loadAgentContracts({ baseDir: installed.root });
  const profile = profiles.loadBindingProfile('free', { profilesDir: join(installed.root, 'profiles'), manifest }).profile;
  const runtime = admission.createRuntimePermissionProjection({ contracts, projectDir: project });
  const overlay = execution.finalizeGovernedOpenCodeOverlay({ profile, role: 'coder', runtime, contracts });
  assert.equal(overlay.plugin[0][0], realpathSync(join(installed.root, 'harness-runtime', 'plugins', 'pre-execution-authority-guard.mjs')));
  assert.deepEqual(overlay.plugin[0][1].validationRegistry, runtime.validation_registry);
  console.log('INSTALLED_COMMAND_AUTHORITY_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
