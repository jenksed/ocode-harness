import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReleaseArtifact, createArtifactManifest } from '../scripts/release-artifact.mjs';
import { materializeVerifiedArtifact, verifyMaterializedPayload, verifyReleaseArtifact } from '../packages/harness-runtime/lib/artifact.mjs';
import { activateRelease, installVerifiedArtifact, releaseEntrypoint } from '../packages/harness-runtime/lib/release-store.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-runtime-closure-'));
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'build-source');
const output = join(root, 'artifacts');
const installStore = join(root, 'install-store');
const home = join(root, 'home');
const project = join(root, 'project');
const bin = join(root, 'bin');
const proof = join(root, 'proof');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
}

function executable(name, sourceText) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\nset -eu\n${sourceText}\n`, 'utf8');
  chmodSync(path, 0o755);
}

function opencodeFixture() {
  const script = join(bin, 'opencode.mjs');
  writeFileSync(script, `
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (process.argv[2] === 'models') {
  console.log('freellmapi/auto:default');
  console.log('freellmapi/auto:planning');
  console.log('freellmapi/auto:coding');
  console.log('freellmapi/auto:wayfinder');
  console.log('freellmapi/auto:research');
  console.log('freellmapi/auto:verification');
  console.log('freellmapi/auto:review');
  console.log('freellmapi/auto:reasoning');
  console.log('freellmapi/auto:utility');
  process.exit(0);
}
const overlay = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
const authorityPlugin = overlay.plugin[0][0];
await import(pathToFileURL(authorityPlugin).href);
writeFileSync(process.env.OCODE_RUNTIME_CLOSURE_PLUGIN_PROOF, JSON.stringify({ authority_plugin: authorityPlugin, loaded: true }));
writeFileSync(process.env.OCODE_RUNTIME_CLOSURE_PATH_PROOF, process.env.PATH);
`, 'utf8');
  executable('opencode', 'exec node "$(dirname "$0")/opencode.mjs" "$@"');
}

try {
  // The build source is disposable. It is removed before the installed
  // entrypoint runs, so no source checkout remains at any path available to
  // runtime resolution.
  cpSync(repository, source, {
    recursive: true,
    filter: (path) => !['.git', 'node_modules', 'dist'].includes(relative(repository, path).split('/')[0]),
  });
  git(source, 'init', '-q');
  git(source, 'config', 'user.email', 'ocode-runtime-closure@example.invalid');
  git(source, 'config', 'user.name', 'Ocode Runtime Closure');
  git(source, 'add', '-A');
  git(source, 'commit', '-qm', 'runtime closure fixture');

  const built = buildReleaseArtifact({ sourceRoot: source, outputDir: output });
  const installed = installVerifiedArtifact({ archive: built.archive, installStore });
  activateRelease(installed.id, installStore);

  const negativeCandidate = join(root, 'negative-candidate');
  const { root: negativePayload } = materializeVerifiedArtifact(built.archive, negativeCandidate);
  rmSync(join(negativePayload, 'harness-runtime', 'plugins', 'pre-execution-authority-guard.mjs'));
  const negativeArtifact = JSON.parse(readFileSync(join(negativePayload, 'ARTIFACT.json'), 'utf8'));
  writeFileSync(join(negativePayload, 'ARTIFACT.json'), `${JSON.stringify(createArtifactManifest(
    negativePayload,
    negativeArtifact.release,
    hash(join(negativePayload, 'package-lock.json')),
    negativeArtifact.runtime.sdk.version,
  ), null, 2)}\n`);
  assert.throws(
    () => verifyMaterializedPayload(negativePayload),
    /Artifact missing runtime resource harness-runtime\/plugins\/pre-execution-authority-guard\.mjs/,
  );
  const negativeArchive = join(root, 'missing-authority-plugin.tar.gz');
  execFileSync('tar', ['--format', 'ustar', '-czf', negativeArchive, '-C', negativeCandidate, 'ocode-release']);
  writeFileSync(`${negativeArchive}.sha256`, `${hash(negativeArchive)}  missing-authority-plugin.tar.gz\n`);
  assert.throws(
    () => verifyReleaseArtifact(negativeArchive),
    /Artifact missing runtime resource harness-runtime\/plugins\/pre-execution-authority-guard\.mjs/,
  );

  rmSync(source, { recursive: true, force: true });
  assert.equal(existsSync(source), false, 'build source must be unavailable before installed startup');

  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(proof, { recursive: true });
  executable('orient', 'project="$1"\nmkdir -p "$project/.opencode"\nprintf \'{"project":{"root":"%s"},"git":{"root":"%s"}}\' "$project" "$project" > "$project/.opencode/orientation.json"\nprintf "runtime closure fixture\\n" > "$project/.opencode/orientation.md"');
  opencodeFixture();
  writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --version' } }));
  writeFileSync(join(home, 'machine.json'), JSON.stringify({ profile: 'free' }));

  const entrypoint = releaseEntrypoint(installed.id, installStore, 'ocode');
  const result = spawnSync(process.execPath, [entrypoint, '.'], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      XDG_CACHE_HOME: join(home, '.cache'),
      PATH: `${bin}:${process.env.PATH}`,
      OCODE_MACHINE_CONFIG: join(home, 'machine.json'),
      OCODE_DISABLE_INTERACTIVE_ACTIVITY_BRIDGE: '1',
      OCODE_RUNTIME_CLOSURE_PLUGIN_PROOF: join(proof, 'plugin.json'),
      OCODE_RUNTIME_CLOSURE_PATH_PROOF: join(proof, 'path.txt'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /=== PROJECT ORIENTATION ===/);
  assert.match(result.stdout, /=== ORIENTATION READY ===/);
  assert.match(result.stdout, /WORK — ◇ Orchestrator · active/);

  const pluginProof = JSON.parse(readFileSync(join(proof, 'plugin.json'), 'utf8'));
  const authorityPlugin = pluginProof.authority_plugin;
  const validationWrapper = readFileSync(join(proof, 'path.txt'), 'utf8').split(':')[0];
  assert.equal(pluginProof.loaded, true);
  assert.equal(authorityPlugin, realpathSync(join(installed.path, 'harness-runtime', 'plugins', 'pre-execution-authority-guard.mjs')));
  assert.equal(validationWrapper, realpathSync(join(installed.path, 'harness-runtime', 'bin', 'validation')));
  assert.equal(authorityPlugin.includes(source), false);
  assert.equal(validationWrapper.includes(source), false);
  assert.equal(authorityPlugin.includes('packages/harness-runtime'), false);
  assert.equal(validationWrapper.includes('packages/harness-runtime'), false);

  console.log(JSON.stringify({
    status: 'INSTALLED_RUNTIME_CLOSURE_PROVEN',
    artifact: built.archive,
    archive_sha256: built.archive_sha256,
    install_root: installed.path,
    source_checkout_removed: !existsSync(source),
    entrypoint,
    authority_plugin: authorityPlugin,
    validation_wrapper: validationWrapper,
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
