/**
 * Runtime-shipped Phase-2 artifact authority.  Building lives in scripts/;
 * inspection, verification and safe materialization deliberately ship here.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readReleaseIdentity, validateReleaseIdentity } from './deploy.mjs';

export const ARTIFACT_SCHEMA_VERSION = 1;
export const ARTIFACT_FORMAT = 'ocode-release-artifact-v1';
// This is the shipped runtime module inventory, not a source-layout lookup.
// Keep it explicit so verification rejects a self-consistent but incomplete
// candidate payload before it can become an installed release.
export const RUNTIME_CLOSURE_REQUIRED_PATHS = Object.freeze([
  'harness-runtime/bin/harness.mjs',
  'harness-runtime/bin/ocode.mjs',
  'harness-runtime/bin/validation/command.mjs',
  'harness-runtime/bin/validation/cargo',
  'harness-runtime/bin/validation/go',
  'harness-runtime/bin/validation/mix',
  'harness-runtime/bin/validation/npm',
  'harness-runtime/bin/validation/python',
  'harness-runtime/bin/validation/pytest',
  'harness-runtime/package.json',
  'harness-runtime/lib/activity.mjs',
  'harness-runtime/lib/admission.mjs',
  'harness-runtime/lib/agent-contract.mjs',
  'harness-runtime/lib/artifact.mjs',
  'harness-runtime/lib/behavioral-adapters.mjs',
  'harness-runtime/lib/capability-resolution.mjs',
  'harness-runtime/lib/closeout.mjs',
  'harness-runtime/lib/command-admission.mjs',
  'harness-runtime/lib/composition.mjs',
  'harness-runtime/lib/deploy.mjs',
  'harness-runtime/lib/deterministic-skill-qualification.mjs',
  'harness-runtime/lib/deterministic-staging.mjs',
  'harness-runtime/lib/evidence.mjs',
  'harness-runtime/lib/execution.mjs',
  'harness-runtime/lib/governance.mjs',
  'harness-runtime/lib/identity.mjs',
  'harness-runtime/lib/interactive-activity.mjs',
  'harness-runtime/lib/interactive-configuration.mjs',
  'harness-runtime/lib/ledger.mjs',
  'harness-runtime/lib/lifecycle.mjs',
  'harness-runtime/lib/model-qualification.mjs',
  'harness-runtime/lib/model-telemetry.mjs',
  'harness-runtime/lib/opencode-integration.mjs',
  'harness-runtime/lib/opencode-runtime-contract.mjs',
  'harness-runtime/lib/opencode-sdk-execution.mjs',
  'harness-runtime/lib/permission-projection.mjs',
  'harness-runtime/lib/pre-execution-authority-guard.mjs',
  'harness-runtime/lib/release-store.mjs',
  'harness-runtime/lib/repository-snapshot.mjs',
  'harness-runtime/lib/runtime-paths.mjs',
  'harness-runtime/lib/skill-capsules.mjs',
  'harness-runtime/lib/skill-contract.mjs',
  'harness-runtime/lib/skill-projection.mjs',
  'harness-runtime/lib/skill-qualification.mjs',
  'harness-runtime/lib/skill-runtime.mjs',
  'harness-runtime/lib/task-capsule.mjs',
  'harness-runtime/lib/tdd-qualification.mjs',
  'harness-runtime/lib/tool-loop-control.mjs',
  'harness-runtime/lib/validation-registry.mjs',
  'harness-runtime/lib/verify.mjs',
  'harness-runtime/lib/wayfinding-runtime.mjs',
  'harness-runtime/lib/wayfinding.mjs',
  'harness-runtime/lib/work-view.mjs',
  'harness-runtime/plugins/pre-execution-authority-guard.mjs',
  'orientation/bin/orient.mjs',
  'agents/manifest.json',
  'profiles/free.json',
  'profiles/hybrid.json',
  'doctrine/policy-version.json',
  'opencode-config/opencode.json',
]);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fileSHA = (path) => sha(readFileSync(path));
const posix = (path) => path.split('\\').join('/');
function list(root, current = root, entries = []) { for (const name of readdirSync(current).sort()) { const path = join(current, name), info = lstatSync(path), rel = posix(relative(root, path)); if (info.isDirectory()) list(root, path, entries); else if (info.isFile()) entries.push({ path: rel, type: 'file', size: info.size, sha256: fileSHA(path), executable: Boolean(info.mode & 0o111) }); else throw new Error(`Artifact payload contains unsupported entry: ${rel}`); } return entries.sort((a, b) => a.path.localeCompare(b.path)); }
function safe(path) { if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe artifact path: ${path}`); }
function octal(value) { const text = value.toString('ascii').replace(/\0.*$/, '').trim(); if (!text) return 0; if (!/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric field'); return Number.parseInt(text, 8); }
function text(value) { return value.toString('utf8').replace(/\0.*$/, ''); }
function pathFor(name) { const clean = name.endsWith('/') ? name.slice(0, -1) : name; if (clean === 'ocode-release') return ''; if (!clean.startsWith('ocode-release/')) throw new Error(`Artifact root is invalid: ${name}`); const path = clean.slice(14); safe(path); return path; }
function validChecksum(header) { const expected = octal(header.subarray(148, 156)), copy = Buffer.from(header); copy.fill(0x20, 148, 156); return copy.reduce((sum, x) => sum + x, 0) === expected; }

export function inspectArtifactArchive(archive) { const bytes = gunzipSync(readFileSync(archive)); const entries = [], names = new Set(); let offset = 0; while (offset < bytes.length) { const h = bytes.subarray(offset, offset + 512); if (h.length !== 512) throw new Error('Truncated tar header'); if (h.every((x) => x === 0)) break; if (!validChecksum(h)) throw new Error('Invalid tar header checksum'); const name = `${text(h.subarray(345, 500))}${text(h.subarray(345, 500)) ? '/' : ''}${text(h.subarray(0, 100))}`, type = text(h.subarray(156, 157)) || '0', size = octal(h.subarray(124, 136)), mode = octal(h.subarray(100, 108)), path = pathFor(name); if ((!path && type !== '5') || !['0', '5'].includes(type) || (type === '5' && size !== 0)) throw new Error(`Artifact link or special entry is prohibited: ${name}`); if (names.has(path)) throw new Error(`Duplicate artifact path: ${name}`); names.add(path); const start = offset + 512, end = start + size; if (end > bytes.length) throw new Error(`Truncated tar entry: ${name}`); entries.push({ path, type: type === '5' ? 'directory' : 'file', mode, data: bytes.subarray(start, end) }); offset = start + Math.ceil(size / 512) * 512; } if (!entries.some((x) => x.path === '' && x.type === 'directory')) throw new Error('Artifact root directory missing'); return entries; }

/** Materializes only into a new child of a caller-trusted real parent. */
export function materializeVerifiedArtifact(archive, candidateRoot) { const candidate = resolve(candidateRoot), parent = dirname(candidate); try { lstatSync(candidate); throw new Error('Artifact candidate root must not already exist'); } catch (error) { if (error?.code !== 'ENOENT') throw error; } const p = lstatSync(parent); if (!p.isDirectory() || p.isSymbolicLink()) throw new Error('Artifact candidate parent must be a real directory'); mkdirSync(candidate); const c = lstatSync(candidate); if (!c.isDirectory() || c.isSymbolicLink()) throw new Error('Artifact candidate root creation was unsafe'); const entries = inspectArtifactArchive(archive), root = join(candidate, 'ocode-release'); for (const e of entries.filter((x) => x.type === 'directory').sort((a, b) => a.path.length - b.path.length)) { const target = e.path ? join(root, e.path) : root; mkdirSync(target, { recursive: true, mode: e.mode & 0o777 }); chmodSync(target, e.mode & 0o777); } for (const e of entries.filter((x) => x.type === 'file')) { const target = join(root, e.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, e.data, { flag: 'wx', mode: e.mode & 0o777 }); chmodSync(target, e.mode & 0o777); } return { root, entries }; }

export function verifyMaterializedPayload(root) { const release = readReleaseIdentity(root), artifact = JSON.parse(readFileSync(join(root, 'ARTIFACT.json'), 'utf8')); validateReleaseIdentity(release); if (artifact?.schema_version !== ARTIFACT_SCHEMA_VERSION || artifact.format !== ARTIFACT_FORMAT || artifact.release?.version !== release.version || artifact.release?.source_commit !== release.source_commit) throw new Error('Artifact metadata identity mismatch'); if (readFileSync(join(root, 'VERSION'), 'utf8') !== `${release.version}\n`) throw new Error('Artifact VERSION identity mismatch'); if (!/^[0-9a-f]{64}$/.test(artifact.build_inputs?.package_lock_sha256 || '') || fileSHA(join(root, 'package-lock.json')) !== artifact.build_inputs.package_lock_sha256) throw new Error('Artifact lockfile identity mismatch'); const actual = list(root).filter((x) => x.path !== 'ARTIFACT.json'); if (sha(JSON.stringify(actual)) !== artifact.payload?.manifest_sha256 || JSON.stringify(actual) !== JSON.stringify(artifact.payload.files)) throw new Error('Artifact payload manifest mismatch'); const sdk = join(root, 'harness-runtime/node_modules/@opencode-ai/sdk/package.json'); if (!existsSync(sdk) || JSON.parse(readFileSync(sdk, 'utf8')).version !== artifact.runtime?.sdk?.version) throw new Error('Artifact SDK dependency mismatch'); for (const required of RUNTIME_CLOSURE_REQUIRED_PATHS) if (!existsSync(join(root, required))) throw new Error(`Artifact missing runtime resource ${required}`); const manifest = JSON.parse(readFileSync(join(root, 'agents/manifest.json'), 'utf8')); for (const role of manifest.roles ?? []) { if (typeof role.file !== 'string' || !existsSync(join(root, 'agents', role.file))) throw new Error(`Artifact missing runtime agent contract ${role.file ?? 'unknown'}`); } return { release, artifact }; }
export function verifyReleaseArtifact(archive) { const checksum = `${archive}.sha256`; if (!existsSync(checksum)) throw new Error('Detached archive checksum missing'); const expected = readFileSync(checksum, 'utf8').trim().split(/\s+/)[0]; if (!/^[0-9a-f]{64}$/.test(expected) || fileSHA(archive) !== expected) throw new Error('Archive SHA-256 mismatch'); const temp = mkdtempSync(join(tmpdir(), 'ocode-release-verify-')); try { const { root } = materializeVerifiedArtifact(archive, join(temp, 'candidate')); return { ...verifyMaterializedPayload(root), archive_sha256: expected }; } finally { rmSync(temp, { recursive: true, force: true }); } }
