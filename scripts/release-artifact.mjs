import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, posix, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectSourceIdentity, isExactReleaseIdentity, readReleaseIdentity, readVersion, validateReleaseIdentity, writeReleaseIdentity } from '../packages/harness-runtime/lib/deploy.mjs';

export const ARTIFACT_SCHEMA_VERSION = 1;
export const ARTIFACT_FORMAT = 'ocode-release-artifact-v1';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fileSHA = (path) => sha(readFileSync(path));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const toPosix = (path) => path.split('\\').join('/');

function copy(source, target) { cpSync(source, target, { recursive: true, dereference: false, force: true }); }
function list(root, current = root, entries = []) {
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name), rel = toPosix(relative(root, absolute)), info = lstatSync(absolute);
    if (info.isDirectory()) list(root, absolute, entries);
    else if (info.isSymbolicLink()) entries.push({ path: rel, type: 'symlink', target: readlinkSync(absolute), executable: false, size: 0, sha256: null });
    else if (info.isFile()) entries.push({ path: rel, type: 'file', size: info.size, sha256: fileSHA(absolute), executable: Boolean(info.mode & 0o111) });
    else throw new Error(`Unsupported artifact payload entry: ${rel}`);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
function assertSafeEntries(entries) {
  for (const entry of entries) {
    if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) throw new Error(`Unsafe artifact path: ${entry.path}`);
    if (entry.type === 'symlink' && (entry.target.startsWith('/') || posix.normalize(posix.join(posix.dirname(entry.path), entry.target)).startsWith('../'))) throw new Error(`Escaping artifact symlink: ${entry.path}`);
  }
}
export function createArtifactManifest(root, release, lockSHA, sdkVersion) {
  const files = list(root).filter((entry) => entry.path !== 'ARTIFACT.json');
  assertSafeEntries(files);
  const manifestSHA = sha(JSON.stringify(files));
  return { schema_version: ARTIFACT_SCHEMA_VERSION, format: ARTIFACT_FORMAT, release: { version: release.version, source_commit: release.source_commit }, build_inputs: { package_lock_sha256: lockSHA }, runtime: { sdk: { package: '@opencode-ai/sdk', version: sdkVersion } }, payload: { manifest_sha256: manifestSHA, files } };
}
function sanitizedRuntimeManifest(source, version) {
  const pkg = JSON.parse(readFileSync(source, 'utf8'));
  return { name: pkg.name, version, description: pkg.description, private: true, type: pkg.type, bin: pkg.bin, dependencies: pkg.dependencies };
}
function copySkills(source, target) {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source).sort()) {
    const dir = join(source, name); if (!lstatSync(dir).isDirectory()) continue;
    for (const file of ['SKILL.md', 'protocol.json']) if (existsSync(join(dir, file))) { mkdirSync(join(target, name), { recursive: true }); copy(join(dir, file), join(target, name, file)); }
  }
}
function assertNoContamination(root, forbidden) {
  for (const entry of list(root)) if (entry.type === 'file' && entry.size < 2_000_000) {
    const content = readFileSync(join(root, entry.path), 'utf8');
    for (const value of forbidden) if (value && content.includes(value)) throw new Error(`Artifact contains forbidden absolute path in ${entry.path}`);
  }
}
export function buildReleaseArtifact({ sourceRoot, outputDir }) {
  const version = readVersion(join(sourceRoot, 'VERSION')); if (!version) throw new Error('Missing canonical VERSION');
  const release = inspectSourceIdentity(sourceRoot); if (!isExactReleaseIdentity(release)) throw new Error('OCODE_RELEASE_SOURCE_NOT_EXACT: release artifacts require a clean Git source');
  const runtimePkg = JSON.parse(readFileSync(join(sourceRoot, 'packages/harness-runtime/package.json'), 'utf8'));
  const rootPkg = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  const sdkVersion = runtimePkg.dependencies?.['@opencode-ai/sdk'];
  if (!sdkVersion || rootPkg.dependencies?.['@opencode-ai/sdk'] !== sdkVersion) throw new Error('Runtime SDK declaration disagrees with root locked build dependency');
  const lockPath = join(sourceRoot, 'package-lock.json'), lockSHA = fileSHA(lockPath);
  const temp = mkdtempSync(join(tmpdir(), 'ocode-release-build-'));
  try {
    const dependencyRoot = join(temp, 'dependencies'); mkdirSync(dependencyRoot);
    copy(join(sourceRoot, 'package.json'), join(dependencyRoot, 'package.json')); copy(lockPath, join(dependencyRoot, 'package-lock.json'));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: dependencyRoot, stdio: 'inherit' });
    const sdkPackage = join(dependencyRoot, 'node_modules/@opencode-ai/sdk/package.json');
    if (!existsSync(sdkPackage) || JSON.parse(readFileSync(sdkPackage, 'utf8')).version !== sdkVersion) throw new Error('Locked production SDK dependency is unavailable or mismatched');
    const root = join(temp, 'ocode-release'); mkdirSync(root);
    writeFileSync(join(root, 'VERSION'), `${version}\n`); writeReleaseIdentity(root, release);
    const runtime = join(root, 'harness-runtime'); mkdirSync(runtime); copy(join(sourceRoot, 'packages/harness-runtime/bin'), join(runtime, 'bin')); copy(join(sourceRoot, 'packages/harness-runtime/lib'), join(runtime, 'lib')); writeFileSync(join(runtime, 'package.json'), json(sanitizedRuntimeManifest(join(sourceRoot, 'packages/harness-runtime/package.json'), version))); copy(join(dependencyRoot, 'node_modules'), join(runtime, 'node_modules'));
    const orientation = join(root, 'orientation'); mkdirSync(orientation); copy(join(sourceRoot, 'packages/orientation/bin'), join(orientation, 'bin')); copy(join(sourceRoot, 'packages/orientation/lib'), join(orientation, 'lib')); copy(join(sourceRoot, 'packages/orientation/package.json'), join(orientation, 'package.json'));
    for (const dir of ['agents', 'profiles', 'doctrine', 'opencode-config']) copy(join(sourceRoot, dir), join(root, dir));
    copySkills(join(sourceRoot, 'skills'), join(root, 'skills'));
    const artifact = createArtifactManifest(root, release, lockSHA, sdkVersion); writeFileSync(join(root, 'ARTIFACT.json'), json(artifact));
    assertNoContamination(root, [resolve(sourceRoot), homedir(), temp]);
    mkdirSync(outputDir, { recursive: true }); const name = `ocode-${version}+${release.source_commit.slice(0, 7)}.tar.gz`, archive = join(outputDir, name);
    execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', temp, 'ocode-release']);
    const archiveSHA = fileSHA(archive); writeFileSync(`${archive}.sha256`, `${archiveSHA}  ${name}\n`);
    return { archive, checksum: `${archive}.sha256`, archive_sha256: archiveSHA, artifact, release };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function verifyReleaseArtifact(archive) {
  const checksum = `${archive}.sha256`; if (!existsSync(checksum)) throw new Error('Detached archive checksum missing');
  const expected = readFileSync(checksum, 'utf8').trim().split(/\s+/)[0]; if (!/^[0-9a-f]{64}$/.test(expected) || fileSHA(archive) !== expected) throw new Error('Archive SHA-256 mismatch');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); if (names.some((name) => name.startsWith('/') || name.split('/').includes('..'))) throw new Error('Archive has unsafe path');
  const temp = mkdtempSync(join(tmpdir(), 'ocode-release-verify-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temp]); const root = join(temp, 'ocode-release');
    const release = readReleaseIdentity(root), artifact = JSON.parse(readFileSync(join(root, 'ARTIFACT.json'), 'utf8'));
    validateReleaseIdentity(release); if (artifact.schema_version !== ARTIFACT_SCHEMA_VERSION || artifact.format !== ARTIFACT_FORMAT) throw new Error('Artifact schema invalid');
    if (artifact.release.version !== release.version || artifact.release.source_commit !== release.source_commit) throw new Error('Release/artifact identity mismatch');
    const actual = list(root).filter((entry) => entry.path !== 'ARTIFACT.json'); assertSafeEntries(actual);
    if (sha(JSON.stringify(actual)) !== artifact.payload.manifest_sha256 || JSON.stringify(actual) !== JSON.stringify(artifact.payload.files)) throw new Error('Artifact payload manifest mismatch');
    const sdk = join(root, 'harness-runtime/node_modules/@opencode-ai/sdk/package.json'); if (!existsSync(sdk) || JSON.parse(readFileSync(sdk, 'utf8')).version !== artifact.runtime.sdk.version) throw new Error('Artifact SDK dependency mismatch');
    for (const required of ['harness-runtime/bin/harness.mjs', 'harness-runtime/lib/deploy.mjs', 'orientation/bin/orient.mjs', 'agents/manifest.json', 'profiles/free.json', 'doctrine/policy-version.json', 'opencode-config/opencode.json']) if (!existsSync(join(root, required))) throw new Error(`Artifact missing ${required}`);
    return { root, release, artifact, archive_sha256: expected };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
