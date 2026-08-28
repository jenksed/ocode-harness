import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRepositorySnapshot, createRepositoryTaskContext, nearestScopeAuthority, repositorySnapshotFingerprint, validateRepositorySnapshot } from '../packages/harness-runtime/lib/repository-snapshot.mjs';
import { createTaskCapsule, validateTaskCapsule } from '../packages/harness-runtime/lib/task-capsule.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-repository-truth-'));
const harnessRoot = resolve('.');
const cli = resolve(harnessRoot, 'packages/harness-runtime/bin/ocode.mjs');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

try {
  mkdirSync(join(root, 'packages', 'feature'), { recursive: true });
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  mkdirSync(join(root, 'qualification'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# root instructions\n');
  writeFileSync(join(root, 'packages', 'feature', 'AGENTS.md'), '# feature instructions\n');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  writeFileSync(join(root, 'VERSION'), '9.9.9\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { 'test:z': 'node z.mjs', test: 'node test.mjs' } }) + '\n');
  writeFileSync(join(root, 'packages', 'feature', 'package.json'), JSON.stringify({ name: 'feature', scripts: { 'test:unit': 'node unit.mjs' } }) + '\n');
  writeFileSync(join(root, 'packages', 'feature', 'source.mjs'), 'export const changed = false;\n');
  writeFileSync(join(root, 'docs', 'architecture', 'repository-authority.md'), '# decision\n');
  writeFileSync(join(root, 'qualification', 'run.json'), '{"result":"PASS"}\n');
  writeFileSync(join(root, 'test', 'snapshot.mjs'), 'process.exit(0)\n');
  git(['init']); git(['config', 'user.email', 'test@example.test']); git(['config', 'user.name', 'Test']); git(['add', '.']); git(['commit', '-m', 'fixture']); git(['branch', '-M', 'main']);

  const first = createRepositorySnapshot({ repositoryRoot: root, taskIdentity: 'context-fixture' });
  const second = createRepositorySnapshot({ repositoryRoot: root, taskIdentity: 'context-fixture' });
  assert.deepEqual(first.snapshot, second.snapshot);
  assert.equal(first.snapshot.worktree.dirty, false);
  assert.equal(first.snapshot.branch, 'main');
  assert.match(first.snapshot.head, /^[0-9a-f]{40}$/);
  assert.equal(first.snapshot.release.version, '9.9.9');
  assert.equal(first.snapshot.task_identity, 'context-fixture');
  assert.deepEqual(first.snapshot.authority.map((entry) => entry.path), [...first.snapshot.authority.map((entry) => entry.path)].sort());
  assert.equal(nearestScopeAuthority(first.snapshot.authority, 'packages/feature/source.mjs').path, 'packages/feature/AGENTS.md');
  assert.equal(nearestScopeAuthority(first.snapshot.authority, 'other/source.mjs').path, 'AGENTS.md');
  assert.ok(first.snapshot.facts.every((entry) => entry.truth_class === 'VERIFIED_FACT' && entry.provenance.source));
  assert.ok(first.snapshot.decisions.every((entry) => entry.truth_class === 'ACCEPTED_DECISION' && entry.provenance.source));
  assert.ok(first.snapshot.evidence.every((entry) => entry.truth_class === 'EVIDENCE' && entry.provenance.source));
  assert.ok(first.snapshot.test_entrypoints.some((entry) => entry.command === 'npm run test'));
  assert.ok(first.snapshot.test_entrypoints.some((entry) => entry.path === 'test/snapshot.mjs'));
  assert.equal(first.metrics.git_commands, 5);
  assert.ok(first.metrics.serialized_bytes > 0);
  assert.equal(repositorySnapshotFingerprint(first.snapshot), repositorySnapshotFingerprint(second.snapshot));
  assert.deepEqual(validateRepositorySnapshot(JSON.parse(JSON.stringify(first.snapshot))), first.snapshot);
  console.log('✓ clean repository snapshot is deterministic, provenance-backed, ordered, and provider-free');

  writeFileSync(join(root, 'packages', 'feature', 'source.mjs'), 'export const changed = true;\n');
  writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
  const dirty = createRepositorySnapshot({ repositoryRoot: root }).snapshot;
  assert.equal(dirty.worktree.dirty, true);
  assert.deepEqual(dirty.worktree.changed_files, ['packages/feature/source.mjs']);
  assert.deepEqual(dirty.worktree.untracked_files, ['untracked.txt']);
  assert.equal(dirty.facts.find((entry) => entry.key === 'git.worktree').value.dirty, true);
  console.log('✓ dirty snapshots report tracked changes and untracked files without changing fact authority');

  const observation = { kind: 'repository_fact', truth_class: 'WORKING_OBSERVATION', key: 'agent.note', value: 'needs review', provenance: { source_type: 'agent', source: 'fixture' }, captured_state: { head: dirty.head, branch: dirty.branch, dirty: true } };
  const repository_context = createRepositoryTaskContext(dirty, { observations: [observation], unknowns: ['No deployment record is present'] });
  assert.equal(repository_context.observations[0].truth_class, 'WORKING_OBSERVATION');
  assert.throws(() => createRepositoryTaskContext({ ...dirty, facts: [...dirty.facts, observation] }), /VERIFIED_FACT/);
  const capsule = createTaskCapsule({ task_id: 'repository-truth', revision: 1, parent_fingerprint: null, objective: 'Inspect fixture truth', authoritative_inputs: [{ id: 'fixture', kind: 'PATH', reference: 'README.md', fingerprint: 'a'.repeat(64), description: 'Fixture authority' }], scope: { include_paths: ['README.md'], exclude_paths: [] }, non_goals: ['Do not infer source contents'], constraints: ['Use repository facts only'], acceptance: [{ id: 'context-ready', requirement: 'Capsule carries repository context', required_evidence: ['snapshot'] }], stop_conditions: ['Stop after serialization'], context: { path_refs: ['README.md'], evidence_refs: [], max_supplied_chars: 100000, max_expansions: 0 }, assumptions: [], provenance: { workflow_id: null, run_id: null, session_id: null, role: 'orchestrator' }, repository_context: { snapshot: dirty, observations: [observation], unknowns: ['No deployment record is present'] } });
  const roundTrip = validateTaskCapsule(JSON.parse(JSON.stringify(capsule)));
  assert.deepEqual(roundTrip, capsule);
  assert.equal(capsule.schema_version, 2);
  assert.equal(capsule.repository_context.verified_facts.find((entry) => entry.key === 'git.head').value, dirty.head);
  assert.equal(capsule.repository_context.observations[0].truth_class, 'WORKING_OBSERVATION');
  console.log('✓ E2E fixture → snapshot → TaskCapsule v2 → JSON preserves HEAD, state, authority, provenance, and fact classes');

  const result = spawnSync(process.execPath, [cli, 'context', 'snapshot', '--json', '--task', 'cli-fixture'], { cwd: root, env: { ...process.env, OCODE_HARNESS_ROOT: harnessRoot, OCODE_MACHINE_CONFIG: join(root, 'missing-config.json') }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const cliSnapshot = JSON.parse(result.stdout);
  assert.equal(cliSnapshot.head, dirty.head);
  assert.equal(cliSnapshot.task_identity, 'cli-fixture');
  assert.equal(cliSnapshot.facts.find((entry) => entry.key === 'git.head').value, dirty.head);
  console.log('✓ ocode context snapshot --json works without provider or runtime access');
  console.log('REPOSITORY_SNAPSHOT_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
