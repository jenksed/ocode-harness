import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { createRuntimePermissionProjection } from '../packages/harness-runtime/lib/command-admission.mjs';
import { finalizeGovernedOpenCodeOverlay } from '../packages/harness-runtime/lib/execution.mjs';
import { loadBindingProfile } from '../packages/harness-runtime/lib/opencode-integration.mjs';
import { runtimeResourcePath } from '../packages/harness-runtime/lib/runtime-paths.mjs';

const root = resolve('.');
const project = mkdtempSync(join(tmpdir(), 'ocode-governed-guard-'));
try {
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
  const { manifest, contracts } = loadAgentContracts({ baseDir: root });
  const profile = loadBindingProfile('free', { profilesDir: join(root, 'profiles'), manifest }).profile;
  const runtime = createRuntimePermissionProjection({ contracts, projectDir: project });
  const overlay = finalizeGovernedOpenCodeOverlay({ profile, role: 'coder', runtime, contracts });
  assert.equal(overlay.agent.coder.mode, 'primary');
  assert.equal(overlay.plugin.length, 1);
  assert.equal(overlay.plugin[0][0], runtimeResourcePath('plugins', 'pre-execution-authority-guard.mjs'));
  assert.deepEqual(overlay.plugin[0][1].validationRegistry, runtime.validation_registry);
  assert.deepEqual(Object.keys(overlay.plugin[0][1].authorityByRole).sort(), manifest.roles.map((role) => role.id).sort());
  assert.equal(overlay.plugin.filter(([path]) => path === runtimeResourcePath('plugins', 'pre-execution-authority-guard.mjs')).length, 1);
  console.log('GOVERNED_PRE_EXECUTION_AUTHORITY_GUARD_PROVEN');
} finally {
  rmSync(project, { recursive: true, force: true });
}
