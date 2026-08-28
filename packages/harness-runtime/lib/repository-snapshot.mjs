import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const REPOSITORY_SNAPSHOT_SCHEMA_VERSION = 1;
export const CONTEXT_FACT_CLASSES = Object.freeze(['VERIFIED_FACT', 'ACCEPTED_DECISION', 'EVIDENCE', 'WORKING_OBSERVATION']);
const FACT_CLASSES = new Set(CONTEXT_FACT_CLASSES);

function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function string(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value.trim(); }
function path(value, label) { value = string(value, label); if (value.startsWith('/') || value.includes('\\') || value === '.' || value.split('/').includes('..')) throw new Error(`${label} must be a normalized repository-relative path`); return value; }
function fields(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); }
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function sortByPath(entries) { return [...entries].sort((left, right) => compare(left.path, right.path)); }
function stable(value) { return JSON.parse(canonicalJSONStringify(value)); }

function git(root, args, metrics) {
  metrics.git_commands += 1;
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`REPOSITORY_SNAPSHOT_GIT_FAILED: git ${args.join(' ')}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return result.stdout;
}

function trackedFiles(root, metrics) {
  return git(root, ['ls-files', '-z'], metrics).split('\0').filter(Boolean).sort();
}

function status(root, metrics) {
  const entries = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], metrics).split('\0').filter(Boolean);
  const changed = new Set(); const untracked = new Set();
  for (const entry of entries) {
    const code = entry.slice(0, 2); const file = entry.slice(3);
    if (code === '??') untracked.add(file);
    else changed.add(file);
  }
  return { dirty: entries.length > 0, changed_files: [...changed].sort(), untracked_files: [...untracked].sort() };
}

function readText(root, file, metrics) { metrics.file_reads += 1; return readFileSync(resolve(root, file), 'utf8'); }
function readJson(root, file, metrics) { try { return JSON.parse(readText(root, file, metrics)); } catch { return null; } }

function classifyAuthority(file) {
  const name = basename(file);
  if (name === 'AGENTS.md') return 'AGENT_INSTRUCTIONS';
  if (file === 'README.md') return 'REPOSITORY_GUIDE';
  if (file === 'VERSION') return 'RELEASE_IDENTITY';
  if (file === 'docs/architecture/repository-authority.md') return 'REPOSITORY_AUTHORITY';
  if (file.startsWith('docs/architecture/') && file.endsWith('.md')) return 'ARCHITECTURE_DECISION';
  if (name === 'package.json') return 'PACKAGE_MANIFEST';
  if (name === 'Cargo.toml' || name === 'pyproject.toml' || name === 'go.mod' || name === 'mix.exs') return 'PACKAGE_MANIFEST';
  return null;
}

export function discoverAuthorityFiles(repositoryRoot, { files = null } = {}) {
  const root = resolve(repositoryRoot); const candidates = files ?? [];
  return sortByPath(candidates.map((entry) => {
    const file = path(entry, 'authority path'); const authority_type = classifyAuthority(file);
    if (!authority_type) return null;
    const scope = dirname(file) === '.' ? '.' : dirname(file);
    return { path: file, authority_type, scope, provenance: { source_type: 'repository_file', source: file } };
  }).filter(Boolean));
}

export function nearestScopeAuthority(authorities, targetPath) {
  const target = path(targetPath, 'target path');
  return [...authorities]
    .filter((entry) => entry.authority_type === 'AGENT_INSTRUCTIONS' && (entry.scope === '.' || target === entry.scope || target.startsWith(`${entry.scope}/`)))
    .sort((left, right) => right.scope.length - left.scope.length || compare(left.path, right.path))[0] ?? null;
}

function packageTopology(root, files, metrics) {
  const manifests = files.filter((file) => basename(file) === 'package.json').sort();
  const packages = manifests.map((file) => {
    const pkg = readJson(root, file, metrics) ?? {};
    const scripts = Object.entries(pkg.scripts ?? {}).filter(([name]) => name === 'test' || name.startsWith('test:')).sort(([a], [b]) => compare(a, b)).map(([name, command]) => ({ name, command }));
    return { path: file, name: typeof pkg.name === 'string' ? pkg.name : null, version: typeof pkg.version === 'string' ? pkg.version : null, test_scripts: scripts };
  });
  return { package_manifests: packages, workspace_manifests: packages.filter((entry) => entry.path !== 'package.json') };
}

function fact(key, value, provenance, captured_state, truth_class = 'VERIFIED_FACT') {
  return { kind: 'repository_fact', truth_class, key, value, provenance, captured_state };
}

export function validateContextFact(value) {
  object(value, 'ContextFact'); fields(value, ['kind', 'truth_class', 'key', 'value', 'provenance', 'captured_state'], 'ContextFact');
  if (value.kind !== 'repository_fact') throw new Error('ContextFact kind invalid');
  if (!FACT_CLASSES.has(value.truth_class)) throw new Error('ContextFact truth_class invalid');
  string(value.key, 'ContextFact key'); object(value.provenance, 'ContextFact provenance'); fields(value.provenance, ['source_type', 'source', 'command'], 'ContextFact provenance');
  string(value.provenance.source_type, 'ContextFact provenance.source_type'); string(value.provenance.source, 'ContextFact provenance.source');
  if (value.provenance.command !== undefined && value.provenance.command !== null) string(value.provenance.command, 'ContextFact provenance.command');
  object(value.captured_state, 'ContextFact captured_state'); fields(value.captured_state, ['head', 'branch', 'dirty'], 'ContextFact captured_state');
  if (value.captured_state.head !== null) string(value.captured_state.head, 'ContextFact captured_state.head');
  if (value.captured_state.branch !== null) string(value.captured_state.branch, 'ContextFact captured_state.branch');
  if (typeof value.captured_state.dirty !== 'boolean') throw new Error('ContextFact captured_state.dirty invalid');
  return stable(value);
}

export function validateRepositorySnapshot(value) {
  object(value, 'RepositorySnapshot'); fields(value, ['schema_version', 'repository_root', 'branch', 'head', 'worktree', 'release', 'authority', 'topology', 'test_entrypoints', 'task_identity', 'facts', 'decisions', 'evidence'], 'RepositorySnapshot');
  if (value.schema_version !== REPOSITORY_SNAPSHOT_SCHEMA_VERSION) throw new Error('RepositorySnapshot schema_version invalid');
  if (value.repository_root !== '.') throw new Error('RepositorySnapshot repository_root must be .');
  string(value.branch, 'RepositorySnapshot branch'); if (!/^[0-9a-f]{40}$/.test(value.head)) throw new Error('RepositorySnapshot head invalid');
  object(value.worktree, 'RepositorySnapshot worktree'); fields(value.worktree, ['dirty', 'changed_files', 'untracked_files'], 'RepositorySnapshot worktree');
  if (typeof value.worktree.dirty !== 'boolean') throw new Error('RepositorySnapshot dirty invalid');
  for (const list of ['changed_files', 'untracked_files']) { if (!Array.isArray(value.worktree[list])) throw new Error(`RepositorySnapshot ${list} invalid`); value.worktree[list].forEach((entry) => path(entry, `RepositorySnapshot ${list}`)); }
  object(value.release, 'RepositorySnapshot release'); fields(value.release, ['version', 'source'], 'RepositorySnapshot release');
  if (value.release.version !== null) string(value.release.version, 'RepositorySnapshot release.version'); object(value.release.source, 'RepositorySnapshot release.source');
  for (const authority of value.authority) { object(authority, 'authority'); fields(authority, ['path', 'authority_type', 'scope', 'provenance'], 'authority'); path(authority.path, 'authority.path'); if (authority.scope !== '.') path(authority.scope, 'authority.scope'); object(authority.provenance, 'authority.provenance'); }
  for (const entry of value.facts) { const normalized = validateContextFact(entry); if (normalized.truth_class !== 'VERIFIED_FACT') throw new Error('RepositorySnapshot facts must be VERIFIED_FACT'); }
  for (const entry of value.decisions) { const normalized = validateContextFact(entry); if (normalized.truth_class !== 'ACCEPTED_DECISION') throw new Error('RepositorySnapshot decisions must be ACCEPTED_DECISION'); }
  for (const entry of value.evidence) { const normalized = validateContextFact(entry); if (normalized.truth_class !== 'EVIDENCE') throw new Error('RepositorySnapshot evidence must be EVIDENCE'); }
  return stable(value);
}

export function repositorySnapshotFingerprint(snapshot) {
  return createHash('sha256').update(canonicalJSONStringify(validateRepositorySnapshot(snapshot))).digest('hex');
}

export function createRepositorySnapshot({ repositoryRoot = process.cwd(), taskIdentity = null } = {}) {
  const started = process.hrtime.bigint(); const metrics = { git_commands: 0, file_reads: 0 };
  const requested = resolve(repositoryRoot);
  const root = git(requested, ['rev-parse', '--show-toplevel'], metrics).trim();
  const files = trackedFiles(root, metrics); const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], metrics).trim(); const head = git(root, ['rev-parse', 'HEAD'], metrics).trim(); const worktree = status(root, metrics);
  const authority = discoverAuthorityFiles(root, { files });
  const version = files.includes('VERSION') ? readText(root, 'VERSION', metrics).trim() || null : null;
  const topology = packageTopology(root, files, metrics);
  const test_entrypoints = [...new Set([...
    topology.package_manifests.flatMap((entry) => entry.test_scripts.map((script) => ({ path: entry.path, command: `npm run ${script.name}` }))),
    ...files.filter((file) => /^test\/.+\.(mjs|js|cjs)$/.test(file)).map((path) => ({ path, command: `node ${path}` })),
  ].map((entry) => canonicalJSONStringify(entry)))].map((entry) => JSON.parse(entry)).sort((a, b) => compare(canonicalJSONStringify(a), canonicalJSONStringify(b)));
  const captured_state = { head, branch, dirty: worktree.dirty };
  const facts = [
    fact('repository.root', '.', { source_type: 'git', source: 'rev-parse --show-toplevel', command: 'git rev-parse --show-toplevel' }, captured_state),
    fact('git.branch', branch, { source_type: 'git', source: 'HEAD', command: 'git rev-parse --abbrev-ref HEAD' }, captured_state),
    fact('git.head', head, { source_type: 'git', source: 'HEAD', command: 'git rev-parse HEAD' }, captured_state),
    fact('git.worktree', worktree, { source_type: 'git', source: 'worktree', command: 'git status --porcelain=v1 -z --untracked-files=all' }, captured_state),
    ...authority.map((entry) => fact(`authority.${entry.path}`, { authority_type: entry.authority_type, scope: entry.scope }, entry.provenance, captured_state)),
    ...topology.package_manifests.map((entry) => fact(`package.${entry.path}`, entry, { source_type: 'repository_file', source: entry.path }, captured_state)),
  ].sort((a, b) => compare(a.key, b.key));
  if (version !== null) facts.push(fact('repository.version', version, { source_type: 'repository_file', source: 'VERSION' }, captured_state));
  facts.sort((a, b) => compare(a.key, b.key));
  const decisions = authority.filter((entry) => ['REPOSITORY_AUTHORITY', 'ARCHITECTURE_DECISION'].includes(entry.authority_type)).map((entry) => fact(`decision.${entry.path}`, { authority_type: entry.authority_type, scope: entry.scope }, entry.provenance, captured_state, 'ACCEPTED_DECISION')).sort((a, b) => compare(a.key, b.key));
  const evidence = files.filter((file) => file.startsWith('qualification/') || /^skills\/[^/]+\/qualifications\/.+\.json$/.test(file)).map((file) => fact(`evidence.${file}`, { record_path: file }, { source_type: 'evidence_record', source: file }, captured_state, 'EVIDENCE')).sort((a, b) => compare(a.key, b.key));
  const snapshot = { schema_version: REPOSITORY_SNAPSHOT_SCHEMA_VERSION, repository_root: '.', branch, head, worktree, release: { version, source: { source_type: version === null ? 'absence' : 'repository_file', source: version === null ? 'VERSION' : 'VERSION' } }, authority, topology, test_entrypoints, task_identity: taskIdentity === null ? null : string(taskIdentity, 'taskIdentity'), facts, decisions, evidence };
  const normalized = validateRepositorySnapshot(snapshot); const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { snapshot: normalized, metrics: { ...metrics, serialized_bytes: Buffer.byteLength(canonicalJSONStringify(normalized), 'utf8'), elapsed_ms } };
}

export function createRepositoryTaskContext(snapshot, { observations = [], unknowns = [] } = {}) {
  const normalized = validateRepositorySnapshot(snapshot);
  const validateClass = (items, expected, label) => {
    if (!Array.isArray(items)) throw new Error(`${label} must be an array`);
    return items.map((item) => { const result = validateContextFact(item); if (result.truth_class !== expected) throw new Error(`${label} must contain ${expected}`); return result; });
  };
  const validatedObservations = validateClass(observations, 'WORKING_OBSERVATION', 'observations');
  if (!Array.isArray(unknowns) || unknowns.some((entry) => typeof entry !== 'string' || !entry.trim())) throw new Error('unknowns must be non-empty strings');
  return stable({ snapshot: normalized, verified_facts: normalized.facts, decisions: normalized.decisions, evidence: normalized.evidence, observations: validatedObservations, unknowns: [...unknowns].sort() });
}
