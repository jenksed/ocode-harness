import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { installVerifiedArtifact } from '../packages/harness-runtime/lib/release-store.mjs';

const repository = resolve('.');
const root = mkdtempSync(join(tmpdir(), 'ocode-installed-skill-discovery-'));
const source = join(root, 'committed-source');
const output = join(root, 'artifacts');
const installStore = join(root, 'install-store');
const project = join(root, 'project');
const home = join(root, 'home');
const skillId = 'tdd';
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

try {
  const commit = git('-C', repository, 'rev-parse', 'HEAD');
  assert.equal(git('-C', repository, 'status', '--porcelain=v1'), '', 'qualification must begin from committed clean bytes');
  // Use a real checkout at the exact source commit, then remove that checkout
  // before discovery. This is the existing runtime-closure source-removal
  // model, while retaining the actual DD2 commit identity.
  assert.equal(spawnSync('git', ['clone', '--quiet', '--no-local', repository, source], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', source, 'checkout', '--quiet', '--detach', commit], { encoding: 'utf8' }).status, 0);
  assert.equal(git('-C', source, 'rev-parse', 'HEAD'), commit);

  const built = buildReleaseArtifact({ sourceRoot: source, outputDir: output });
  assert.equal(built.release.source_commit, commit);
  assert.equal(sha256(built.archive), built.archive_sha256);
  const installed = installVerifiedArtifact({ archive: built.archive, installStore });

  rmSync(source, { recursive: true, force: true });
  assert.equal(existsSync(source), false, 'build source checkout is unavailable before discovery');

  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(project, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json' }));
  const before = readFileSync(join(project, 'opencode.json'), 'utf8');

  const installedLib = (name) => pathToFileURL(join(installed.path, 'harness-runtime', 'lib', name)).href;
  const [{ loadAgentContracts }, { createRuntimeBoundOpenCodeEnvironment }, { qualifyRuntimeIdentity }, { loadSkillSource }] = await Promise.all([
    import(installedLib('agent-contract.mjs')),
    import(installedLib('interactive-configuration.mjs')),
    import(installedLib('runtime-identity.mjs')),
    import(installedLib('skill-contract.mjs')),
  ]);
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'), XDG_CACHE_HOME: join(home, '.cache'),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  };
  const identity = qualifyRuntimeIdentity({ releaseRoot: installed.path, environment });
  assert.equal(identity.executable.version, '1.18.21');
  const { manifest } = loadAgentContracts({ baseDir: installed.path });
  const runtime = createRuntimeBoundOpenCodeEnvironment({
    harnessRoot: installed.path,
    projectRoot: project,
    governedAgentIds: manifest.roles.map((role) => role.id),
    environment,
  });
  try {
    const skills = JSON.parse(execFileSync(identity.executable.path, ['debug', 'skill', '--pure'], {
      cwd: project,
      env: runtime.environment,
      encoding: 'utf8',
    }));
    const discovered = skills.find((skill) => skill.name === skillId);
    const projectedPath = join(runtime.config_home, 'opencode', 'skills', skillId, 'SKILL.md');
    assert.ok(discovered, 'OpenCode must discover the installed canonical skill');
    assert.equal(discovered.location, projectedPath);
    assert.equal(existsSync(projectedPath), true);
    assert.equal(projectedPath.startsWith(installed.path), false, 'projection is runtime-owned, not an installed-source write');
    const canonical = loadSkillSource({ skillsDir: join(installed.path, 'skills'), skillId });
    assert.match(readFileSync(projectedPath, 'utf8'), new RegExp(canonical.skill_fingerprint));
    assert.equal(readFileSync(join(project, 'opencode.json'), 'utf8'), before, 'target project config remains unchanged');
    assert.equal(existsSync(join(project, '.opencode', 'skills', skillId)), false, 'no Ocode skill projection is written to the project');
    console.log(JSON.stringify({
      status: 'INSTALLED_OPENCODE_SKILL_DISCOVERY_PROVEN',
      dd2_commit: commit,
      artifact: built.archive,
      artifact_sha256: built.archive_sha256,
      payload_manifest_sha256: built.artifact.payload.manifest_sha256,
      installed_runtime_root: installed.path,
      qualified_opencode_executable: identity.executable.path,
      opencode_version: identity.executable.version,
      source_checkout_removed: !existsSync(source),
      project_fixture: project,
      skill_id: skillId,
      projected_skill_path: projectedPath,
      discovery_location: discovered.location,
      target_project_skill_projection: existsSync(join(project, '.opencode', 'skills', skillId)),
    }));
  } finally {
    runtime.cleanup();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
