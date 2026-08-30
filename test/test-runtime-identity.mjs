import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualifyRuntimeIdentity, readRuntimeCompatibility, resolveOpenCodeExecutable } from '../packages/harness-runtime/lib/runtime-identity.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-runtime-identity-'));
const bin = join(root, 'bin');
const compatibilityPath = join(root, 'runtime-compatibility.json');
const base = {
  schema_version: 1,
  contract_version: 1,
  compatibility_id: 'test-opencode-1.18.21',
  opencode: { required_version: '1.18.21' },
  sdk: { package: '@opencode-ai/sdk', required_version: '1.18.21' },
  node: { minimum_major: 18 },
  platform: { supported: [`${process.platform} ${process.arch}`] },
};

function writeCompatibility(value = base) {
  writeFileSync(compatibilityPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeExecutable(path, version) {
  writeFileSync(path, `#!/bin/sh\nif [ "${'$'}{1:-}" = "--version" ]; then printf '%s\\n' '${version}'; fi\n`, 'utf8');
  chmodSync(path, 0o755);
}

function environment() {
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

try {
  mkdirSync(bin, { recursive: true });
  const executableA = join(bin, 'opencode-a');
  const executableB = join(bin, 'opencode-b');
  writeExecutable(executableA, '1.18.21');
  writeExecutable(executableB, '9.9.9');
  symlinkSync('opencode-a', join(bin, 'opencode'));
  writeCompatibility();

  const qualified = qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() });
  assert.equal(qualified.executable.path, realpathSync(executableA));
  assert.equal(qualified.executable.version, '1.18.21');
  assert.equal(qualified.compatibility.path, compatibilityPath);
  assert.equal(qualified.sdk.package, '@opencode-ai/sdk');
  assert.equal(qualified.sdk.version, '1.18.21');
  assert.equal(qualified.node.minimum_major, 18);
  assert.equal(qualified.platform, process.platform);
  assert.equal(qualified.architecture, process.arch);

  rmSync(join(bin, 'opencode')); symlinkSync('opencode-b', join(bin, 'opencode'));
  assert.equal(resolveOpenCodeExecutable({ environment: environment() }), realpathSync(executableB));
  assert.equal(qualified.executable.path, realpathSync(executableA), 'qualified identity is immutable after PATH substitution');

  assert.throws(() => readRuntimeCompatibility({ releaseRoot: join(root, 'missing') }), /OCODE_RUNTIME_COMPATIBILITY_MISSING/);
  writeFileSync(compatibilityPath, '{not json');
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() }), /OCODE_RUNTIME_COMPATIBILITY_INVALID/);
  writeCompatibility();
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: { ...environment(), PATH: join(root, 'empty') } }), /OCODE_RUNTIME_EXECUTABLE_MISSING/);
  rmSync(join(bin, 'opencode')); symlinkSync('opencode-b', join(bin, 'opencode'));
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() }), /OCODE_RUNTIME_OPENCODE_VERSION_MISMATCH/);
  rmSync(join(bin, 'opencode')); symlinkSync('opencode-a', join(bin, 'opencode'));
  writeCompatibility({ ...base, sdk: { ...base.sdk, required_version: '9.9.9' } });
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() }), /OCODE_RUNTIME_SDK_MISMATCH/);
  writeCompatibility({ ...base, node: { minimum_major: 99 } });
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() }), /OCODE_RUNTIME_NODE_UNSUPPORTED/);
  writeCompatibility({ ...base, platform: { supported: ['linux x64'] } });
  assert.throws(() => qualifyRuntimeIdentity({ releaseRoot: root, environment: environment() }), /OCODE_RUNTIME_PLATFORM_UNSUPPORTED/);
  console.log('RUNTIME_IDENTITY_QUALIFICATION_AND_FAIL_CLOSED_PROVEN');
} finally {
  rmSync(root, { recursive: true, force: true });
}
