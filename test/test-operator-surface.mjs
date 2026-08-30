import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CANDIDATE_CAPABILITIES, requireCandidateCapability } from '../packages/harness-runtime/lib/candidate-capabilities.mjs';
import { classifyInteractiveArguments } from '../packages/harness-runtime/lib/operator-arguments.mjs';
import { attachArguments } from '../packages/harness-runtime/lib/interactive-activity.mjs';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { installVerifiedArtifact, releaseEntrypoint } from '../packages/harness-runtime/lib/release-store.mjs';

const classified = classifyInteractiveArguments(['.', '--continue', '--session=known-session', '-c', '-s', 'alias-session']);
assert.deepEqual(classified.forward, ['--continue', '--session', 'known-session', '--continue', '--session', 'alias-session']);
assert.deepEqual(classified.classifications.map((entry) => entry.classification), ['SUPPORTED_TRANSLATION', 'SUPPORTED_FORWARD', 'SUPPORTED_FORWARD', 'SUPPORTED_TRANSLATION', 'SUPPORTED_TRANSLATION']);
assert.deepEqual(attachArguments('http://127.0.0.1:9000', '/project', classified.forward), ['attach', 'http://127.0.0.1:9000', '--dir', '/project', ...classified.forward]);
for (const args of [['--unknown'], ['--agent', 'coder'], ['--session'], ['.', 'extra']]) {
  assert.throws(() => classifyInteractiveArguments(args), /OCODE_ARGUMENT_UNSUPPORTED/);
}

for (const name of ['self-update', 'rollback']) assert.throws(() => requireCandidateCapability(name), /OCODE_CAPABILITY_UNAVAILABLE/);
assert.equal(CANDIDATE_CAPABILITIES['git-stage'].status, 'UNSUPPORTED');
assert.equal(CANDIDATE_CAPABILITIES['bounded-workspace-mutation'].status, 'ASK');

// Rejected input is classified before orientation or runtime launch. Neither
// a fake orient executable nor a fake OpenCode executable is invoked.
const fixture = mkdtempSync(join(tmpdir(), 'ocode-operator-arguments-'));
try {
  const bin = join(fixture, 'bin'); mkdirSync(bin);
  for (const command of ['orient', 'opencode']) {
    const path = join(bin, command);
    writeFileSync(path, `#!/bin/sh\nprintf %s ${command} >> "${fixture}/spawned"\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(fixture, 'machine.json'), JSON.stringify({ profile: 'free' }));
  const result = spawnSync(process.execPath, [resolve('packages/harness-runtime/bin/ocode.mjs'), '--agent', 'coder'], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OCODE_HARNESS_ROOT: resolve('.'), OCODE_MACHINE_CONFIG: join(fixture, 'machine.json') },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OCODE_ARGUMENT_UNSUPPORTED/);
  assert.equal(existsSync(join(fixture, 'spawned')), false, 'rejection must precede orientation, server, and attach startup');
} finally { rmSync(fixture, { recursive: true, force: true }); }

// The authoritative command must work after its source checkout is removed.
// This also proves doctor uses the qualified executable identity, rather than
// an ambient `which` result, by reporting the fixture's absolute executable.
const installedFixture = mkdtempSync(join(tmpdir(), 'ocode-operator-installed-'));
try {
  const source = join(installedFixture, 'source'); const output = join(installedFixture, 'artifacts');
  const home = join(installedFixture, 'home'); const project = join(installedFixture, 'project'); const bin = join(installedFixture, 'bin');
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: resolve('.'), encoding: 'utf8' }).stdout.trim();
  assert.equal(spawnSync('git', ['clone', '--quiet', '--no-local', resolve('.'), source], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', sourceCommit], { cwd: source, encoding: 'utf8' }).status, 0);
  const built = buildReleaseArtifact({ sourceRoot: source, outputDir: output });
  const installed = installVerifiedArtifact({ archive: built.archive, installStore: join(installedFixture, 'store') });
  rmSync(source, { recursive: true, force: true });
  mkdirSync(home); mkdirSync(project); mkdirSync(bin);
  const opencode = join(bin, 'opencode');
  writeFileSync(opencode, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.18.21; exit 0; fi\nexit 99\n'); chmodSync(opencode, 0o755);
  const environment = { ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state'), XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), PATH: `${bin}:${process.env.PATH}` };
  const entrypoint = releaseEntrypoint(installed.id, join(installedFixture, 'store'), 'ocode');
  const doctor = spawnSync(process.execPath, [entrypoint, 'doctor'], { cwd: project, encoding: 'utf8', env: environment });
  assert.equal(doctor.status, 0, `${doctor.stdout}\n${doctor.stderr}`);
  assert.match(doctor.stdout, /PASS  qualified OpenCode runtime: executable=.*\/bin\/opencode; actual=1\.18\.21; expected=1\.18\.21/);
  assert.match(doctor.stdout, /PASS  DD1 runtime state:/);
  assert.match(doctor.stdout, /PASS  DD2 installed composition resources:/);
  assert.match(doctor.stdout, /UNSUPPORTED  capability self-update: UNSUPPORTED/);
  for (const command of ['update', 'rollback']) {
    const blocked = spawnSync(process.execPath, [entrypoint, command], { cwd: project, encoding: 'utf8', env: environment });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /OCODE_CAPABILITY_UNAVAILABLE/);
  }
} finally { rmSync(installedFixture, { recursive: true, force: true }); }

console.log('OPERATOR_SURFACE_ARGUMENT_AND_CAPABILITY_PROVEN');
