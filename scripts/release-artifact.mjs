import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectSourceIdentity, isExactReleaseIdentity, readReleaseIdentity, readVersion, validateReleaseIdentity, writeReleaseIdentity } from '../packages/harness-runtime/lib/deploy.mjs';
import { checkVersionMirrors } from './version-authority.mjs';
import { inspectArtifactArchive as runtimeInspectArtifactArchive, materializeVerifiedArtifact as runtimeMaterializeVerifiedArtifact, verifyMaterializedPayload as runtimeVerifyMaterializedPayload, verifyReleaseArtifact as runtimeVerifyReleaseArtifact } from '../packages/harness-runtime/lib/artifact.mjs';

// Phase-2 and installed runtime deliberately share this authority.
export { runtimeInspectArtifactArchive as inspectArtifactArchive, runtimeMaterializeVerifiedArtifact as materializeVerifiedArtifact, runtimeVerifyMaterializedPayload as verifyMaterializedPayload };

export const ARTIFACT_SCHEMA_VERSION = 1;
export const ARTIFACT_FORMAT = 'ocode-release-artifact-v1';
export const ARTIFACT_LINK_POLICY = 'FINAL_ARTIFACT_NO_LINK_ENTRIES';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fileSHA = (path) => sha(readFileSync(path));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const toPosix = (path) => path.split('\\').join('/');

function copy(source, target, dereference = false) { cpSync(source, target, { recursive: true, dereference, force: true }); }
function list(root, current = root, entries = []) {
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name), rel = toPosix(relative(root, absolute)), info = lstatSync(absolute);
    if (info.isDirectory()) list(root, absolute, entries);
    else if (info.isSymbolicLink()) throw new Error(`Artifact link entries are prohibited: ${rel}`);
    else if (info.isFile()) entries.push({ path: rel, type: 'file', size: info.size, sha256: fileSHA(absolute), executable: Boolean(info.mode & 0o111) });
    else throw new Error(`Unsupported artifact payload entry: ${rel}`);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
function assertSafePayloadPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe artifact path: ${path}`);
}
export function createArtifactManifest(root, release, lockSHA, sdkVersion) {
  const files = list(root).filter((entry) => entry.path !== 'ARTIFACT.json');
  for (const entry of files) assertSafePayloadPath(entry.path);
  return { schema_version: ARTIFACT_SCHEMA_VERSION, format: ARTIFACT_FORMAT, release: { version: release.version, source_commit: release.source_commit }, build_inputs: { package_lock_sha256: lockSHA }, runtime: { sdk: { package: '@opencode-ai/sdk', version: sdkVersion } }, payload: { manifest_sha256: sha(JSON.stringify(files)), files } };
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
  for (const entry of list(root)) if (entry.size < 2_000_000) {
    const content = readFileSync(join(root, entry.path), 'utf8');
    for (const value of forbidden) if (value && content.includes(value)) throw new Error(`Artifact contains forbidden absolute path in ${entry.path}`);
  }
}
function publish(path, bytes) { const partial = `${path}.partial-${process.pid}`; writeFileSync(partial, bytes); renameSync(partial, path); }
function parseOctal(buffer) { const text = buffer.toString('ascii').replace(/\0.*$/, '').trim(); if (!text) return 0; if (!/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric field'); return Number.parseInt(text, 8); }
function tarText(buffer) { return buffer.toString('utf8').replace(/\0.*$/, ''); }
function zeroBlock(buffer) { return buffer.every((value) => value === 0); }
function validTarChecksum(header) { const expected = parseOctal(header.subarray(148, 156)); const copy = Buffer.from(header); copy.fill(0x20, 148, 156); return copy.reduce((sum, value) => sum + value, 0) === expected; }
function archivePath(name) {
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  if (clean === 'ocode-release') return '';
  if (!clean.startsWith('ocode-release/')) throw new Error(`Artifact root is invalid: ${name}`);
  const payload = clean.slice('ocode-release/'.length); assertSafePayloadPath(payload); return payload;
}

/** Inspect untrusted bytes before any filesystem materialization. Only directories and regular files are accepted. */
function legacyInspectArtifactArchive(archive) {
  const bytes = gunzipSync(readFileSync(archive)); const entries = []; const names = new Set(); let offset = 0;
  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512); if (header.length !== 512) throw new Error('Truncated tar header'); if (zeroBlock(header)) break;
    if (!validTarChecksum(header)) throw new Error('Invalid tar header checksum');
    const prefix = tarText(header.subarray(345, 500)), base = tarText(header.subarray(0, 100)), name = `${prefix}${prefix ? '/' : ''}${base}`;
    const type = tarText(header.subarray(156, 157)) || '0', size = parseOctal(header.subarray(124, 136)), mode = parseOctal(header.subarray(100, 108)), path = archivePath(name);
    if (!path && type !== '5') throw new Error('Artifact root must be a directory');
    if (!['0', '5'].includes(type)) throw new Error(`Artifact link or special entry is prohibited: ${name}`);
    if (type === '5' && size !== 0) throw new Error(`Directory with content is invalid: ${name}`);
    if (names.has(path)) throw new Error(`Duplicate artifact path: ${name}`); names.add(path);
    const dataStart = offset + 512, dataEnd = dataStart + size; if (dataEnd > bytes.length) throw new Error(`Truncated tar entry: ${name}`);
    entries.push({ path, type: type === '5' ? 'directory' : 'file', mode, data: bytes.subarray(dataStart, dataEnd) }); offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!entries.some((entry) => entry.path === '' && entry.type === 'directory')) throw new Error('Artifact root directory missing');
  return entries;
}

/** Safe reusable materializer: it never invokes a generic extractor on untrusted archive bytes. */
function legacyMaterializeVerifiedArtifact(archive, candidateRoot) {
  const rootPath = resolve(candidateRoot), parent = dirname(rootPath);
  try { lstatSync(rootPath); throw new Error('Artifact candidate root must not already exist'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Artifact candidate parent must be a real directory');
  mkdirSync(rootPath);
  const rootInfo = lstatSync(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Artifact candidate root creation was unsafe');
  const entries = inspectArtifactArchive(archive), root = join(rootPath, 'ocode-release');
  for (const entry of entries.filter((entry) => entry.type === 'directory').sort((a, b) => a.path.length - b.path.length)) { const target = entry.path ? join(root, entry.path) : root; mkdirSync(target, { recursive: true, mode: entry.mode & 0o777 }); chmodSync(target, entry.mode & 0o777); }
  for (const entry of entries.filter((entry) => entry.type === 'file')) { const target = join(root, entry.path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, entry.data, { flag: 'wx', mode: entry.mode & 0o777 }); chmodSync(target, entry.mode & 0o777); }
  return { root, entries };
}
function validateArtifactMetadata(root, release, artifact) {
  validateReleaseIdentity(release);
  if (!artifact || artifact.schema_version !== ARTIFACT_SCHEMA_VERSION || artifact.format !== ARTIFACT_FORMAT) throw new Error('Artifact schema invalid');
  if (artifact.release?.version !== release.version || artifact.release?.source_commit !== release.source_commit) throw new Error('Release/artifact identity mismatch');
  if (readFileSync(join(root, 'VERSION'), 'utf8') !== `${release.version}\n`) throw new Error('Artifact VERSION identity mismatch');
  if (!/^[0-9a-f]{64}$/.test(artifact.build_inputs?.package_lock_sha256 || '') || fileSHA(join(root, 'package-lock.json')) !== artifact.build_inputs.package_lock_sha256) throw new Error('Artifact lockfile identity mismatch');
  if (artifact.runtime?.sdk?.package !== '@opencode-ai/sdk' || typeof artifact.runtime.sdk.version !== 'string') throw new Error('Artifact SDK metadata invalid');
}
function legacyVerifyMaterializedPayload(root) {
  const release = readReleaseIdentity(root), artifact = JSON.parse(readFileSync(join(root, 'ARTIFACT.json'), 'utf8')); validateArtifactMetadata(root, release, artifact);
  const actual = list(root).filter((entry) => entry.path !== 'ARTIFACT.json');
  if (sha(JSON.stringify(actual)) !== artifact.payload?.manifest_sha256 || JSON.stringify(actual) !== JSON.stringify(artifact.payload.files)) throw new Error('Artifact payload manifest mismatch');
  const sdk = join(root, 'harness-runtime/node_modules/@opencode-ai/sdk/package.json'); if (!existsSync(sdk) || JSON.parse(readFileSync(sdk, 'utf8')).version !== artifact.runtime.sdk.version) throw new Error('Artifact SDK dependency mismatch');
  for (const required of ['harness-runtime/bin/harness.mjs', 'harness-runtime/bin/ocode.mjs', 'harness-runtime/lib/deploy.mjs', 'orientation/bin/orient.mjs', 'agents/manifest.json', 'profiles/free.json', 'doctrine/policy-version.json', 'opencode-config/opencode.json']) if (!existsSync(join(root, required))) throw new Error(`Artifact missing ${required}`);
  return { release, artifact };
}
export function buildReleaseArtifact({ sourceRoot, outputDir }) {
  const version = checkVersionMirrors(sourceRoot), release = inspectSourceIdentity(sourceRoot); if (!isExactReleaseIdentity(release)) throw new Error('OCODE_RELEASE_SOURCE_NOT_EXACT: release artifacts require a clean Git source');
  const runtimePkg = JSON.parse(readFileSync(join(sourceRoot, 'packages/harness-runtime/package.json'), 'utf8')), rootPkg = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')), sdkVersion = runtimePkg.dependencies?.['@opencode-ai/sdk'];
  if (!sdkVersion || rootPkg.dependencies?.['@opencode-ai/sdk'] !== sdkVersion) throw new Error('Runtime SDK declaration disagrees with root locked build dependency');
  const lockPath = join(sourceRoot, 'package-lock.json'), lockSHA = fileSHA(lockPath); if (readVersion(join(sourceRoot, 'VERSION')) !== version) throw new Error('Canonical version authority mismatch');
  if (existsSync(outputDir) && readdirSync(outputDir).length) throw new Error('Release output directory must be empty');
  const temp = mkdtempSync(join(tmpdir(), 'ocode-release-build-'));
  try {
    const dependencyRoot = join(temp, 'dependencies'); mkdirSync(dependencyRoot); copy(join(sourceRoot, 'package.json'), join(dependencyRoot, 'package.json')); copy(lockPath, join(dependencyRoot, 'package-lock.json'));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: dependencyRoot, stdio: 'inherit' });
    const sdkPackage = join(dependencyRoot, 'node_modules/@opencode-ai/sdk/package.json'); if (!existsSync(sdkPackage) || JSON.parse(readFileSync(sdkPackage, 'utf8')).version !== sdkVersion) throw new Error('Locked production SDK dependency is unavailable or mismatched');
    const root = join(temp, 'ocode-release'); mkdirSync(root); writeFileSync(join(root, 'VERSION'), `${version}\n`); writeReleaseIdentity(root, release); copy(lockPath, join(root, 'package-lock.json'));
    const runtime = join(root, 'harness-runtime'); mkdirSync(runtime); copy(join(sourceRoot, 'packages/harness-runtime/bin'), join(runtime, 'bin')); copy(join(sourceRoot, 'packages/harness-runtime/lib'), join(runtime, 'lib')); copy(join(sourceRoot, 'packages/harness-runtime/plugins'), join(runtime, 'plugins')); writeFileSync(join(runtime, 'package.json'), json(sanitizedRuntimeManifest(join(sourceRoot, 'packages/harness-runtime/package.json'), version))); copy(join(dependencyRoot, 'node_modules'), join(runtime, 'node_modules'), true); rmSync(join(runtime, 'node_modules', '.bin'), { recursive: true, force: true });
    const orientation = join(root, 'orientation'); mkdirSync(orientation); copy(join(sourceRoot, 'packages/orientation/bin'), join(orientation, 'bin')); copy(join(sourceRoot, 'packages/orientation/lib'), join(orientation, 'lib')); copy(join(sourceRoot, 'packages/orientation/package.json'), join(orientation, 'package.json'));
    for (const dir of ['agents', 'profiles', 'doctrine', 'opencode-config']) copy(join(sourceRoot, dir), join(root, dir)); copy(join(sourceRoot, 'runtime-compatibility.json'), join(root, 'runtime-compatibility.json')); copySkills(join(sourceRoot, 'skills'), join(root, 'skills'));
    const artifact = createArtifactManifest(root, release, lockSHA, sdkVersion); writeFileSync(join(root, 'ARTIFACT.json'), json(artifact)); assertNoContamination(root, [resolve(sourceRoot), homedir(), temp]);
    mkdirSync(outputDir, { recursive: true }); const name = `ocode-${version}+${release.source_commit.slice(0, 7)}.tar.gz`, archive = join(outputDir, name), temporaryArchive = join(temp, name);
    execFileSync('tar', ['--format', 'ustar', '-czf', temporaryArchive, '-C', temp, 'ocode-release'], { env: { ...process.env, COPYFILE_DISABLE: '1' } }); runtimeInspectArtifactArchive(temporaryArchive); publish(archive, readFileSync(temporaryArchive)); const archiveSHA = fileSHA(archive); publish(`${archive}.sha256`, `${archiveSHA}  ${name}\n`);
    return { archive, checksum: `${archive}.sha256`, archive_sha256: archiveSHA, artifact, release };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function verifyReleaseArtifact(archive) {
  return runtimeVerifyReleaseArtifact(archive);
}
