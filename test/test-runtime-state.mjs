import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendActivityEvent, activityStorePath, createActivityEvent, queryActivity } from '../packages/harness-runtime/lib/activity.mjs';
import { appendRecord, createLedgerRecord, getRecordByRunId } from '../packages/harness-runtime/lib/ledger.mjs';
import { resolveRuntimeState } from '../packages/harness-runtime/lib/runtime-state.mjs';
import { orient, writeOrientation } from '../packages/orientation/lib/orientation.mjs';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { installVerifiedArtifact } from '../packages/harness-runtime/lib/release-store.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'ocode-runtime-state-'));
const stateHome = join(root, 'state');
const environment = { ...process.env, XDG_STATE_HOME: stateHome, HOME: join(root, 'home') };
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
};
const gitStatus = (cwd) => {
  const result = spawnSync('git', ['status', '--porcelain=v1'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

try {
  const project = join(root, 'project');
  const linkedProject = join(root, 'project-link');
  git(root, 'init', '-q', project);
  git(project, 'config', 'user.email', 'runtime-state@example.invalid');
  git(project, 'config', 'user.name', 'Runtime State');
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'runtime-state-fixture', scripts: { test: 'node --version' } }));
  git(project, 'add', 'package.json');
  git(project, 'commit', '-qm', 'initial');
  symlinkSync(project, linkedProject);

  const state = resolveRuntimeState(project, { environment });
  const symlinkState = resolveRuntimeState(linkedProject, { environment });
  assert.equal(state.root, symlinkState.root, 'physical worktree identity is deterministic');
  assert.ok(state.root.startsWith(join(stateHome, 'ocode')), 'state remains under the configured Ocode state root');
  assert.equal(state.worktree_root, realpathSync(project));
  writeFileSync(join(project, 'next.txt'), 'next');
  git(project, 'add', 'next.txt'); git(project, 'commit', '-qm', 'ordinary head change');
  assert.equal(resolveRuntimeState(project, { environment }).root, state.root, 'identity does not depend on HEAD');
  console.log('✓ external root and stable worktree identity do not depend on HEAD or a project symlink');

  const second = join(root, 'project-second-worktree');
  git(project, 'worktree', 'add', '-q', '-b', 'runtime-state-second', second);
  const secondState = resolveRuntimeState(second, { environment });
  assert.notEqual(secondState.root, state.root, 'distinct worktrees receive distinct state');
  appendActivityEvent(activityStorePath(second, { environment }), createActivityEvent({ event_type: 'AGENT_STARTED', workflow_id: 'second-worktree', agent_role: 'orchestrator', status: 'STARTED', summary: 'separate worktree activity' }));
  assert.equal(queryActivity(secondState.activity).events.length, 1);
  assert.equal(queryActivity(state.activity).events.length, 0, 'worktree activity records cannot overwrite one another');

  const beforeRuntime = gitStatus(project);
  const orientation = await orient(project);
  await writeOrientation(project, orientation, { environment });
  assert.ok(existsSync(state.orientation_json));
  assert.ok(existsSync(state.orientation_markdown));

  const event = appendActivityEvent(activityStorePath(project, { environment }), createActivityEvent({
    event_type: 'AGENT_STARTED', workflow_id: 'runtime-state-workflow', agent_role: 'orchestrator', status: 'STARTED', summary: 'external activity',
  }));
  assert.equal(queryActivity(state.activity, { workflow_id: event.workflow_id }).events.length, 1);

  const runID = '77777777-7777-4777-8777-777777777777';
  appendRecord(state.ledger, createLedgerRecord({ run_id: runID, project_name: 'runtime-state-fixture', project_root: project }));
  assert.equal(getRecordByRunId(state.ledger, runID).run_id, runID);
  const secondRunID = '88888888-8888-4888-8888-888888888888';
  appendRecord(secondState.ledger, createLedgerRecord({ run_id: secondRunID, project_name: 'runtime-state-second', project_root: second }));
  assert.equal(getRecordByRunId(secondState.ledger, secondRunID).run_id, secondRunID);
  assert.equal(getRecordByRunId(state.ledger, secondRunID), null, 'worktree run records cannot overwrite one another');
  assert.equal(gitStatus(project), beforeRuntime, 'normal Ocode runtime initialization leaves a clean target repository unchanged');

  const projectOwnedOpenCode = join(root, 'project-owned-opencode');
  symlinkSync(projectOwnedOpenCode, join(project, '.opencode'));
  await writeOrientation(project, orientation, { environment });
  appendActivityEvent(activityStorePath(project, { environment }), createActivityEvent({ event_type: 'AGENT_COMPLETED', workflow_id: 'runtime-state-workflow', agent_role: 'orchestrator', status: 'COMPLETED', summary: 'symlink-safe activity' }));
  assert.equal(existsSync(join(projectOwnedOpenCode, 'orientation.json')), false, 'orientation ignores target .opencode symlinks');
  assert.equal(existsSync(join(projectOwnedOpenCode, 'activity')), false, 'activity ignores target .opencode symlinks');
  assert.equal(existsSync(join(projectOwnedOpenCode, 'run-ledger.jsonl')), false, 'ledger ignores target .opencode symlinks');
  console.log('✓ orientation, activity, and ledger persist under one external location and remain worktree-separated');

  const artifactSource = join(root, 'artifact-source');
  cpSync(repository, artifactSource, { recursive: true, filter: (path) => !['.git', 'node_modules', 'dist'].includes(relative(repository, path).split('/')[0]) });
  git(root, 'init', '-q', artifactSource);
  git(artifactSource, 'config', 'user.email', 'runtime-state-artifact@example.invalid');
  git(artifactSource, 'config', 'user.name', 'Runtime State Artifact');
  git(artifactSource, 'add', '-A'); git(artifactSource, 'commit', '-qm', 'artifact source');
  const artifactOutput = join(root, 'artifacts');
  const installed = installVerifiedArtifact({ archive: buildReleaseArtifact({ sourceRoot: artifactSource, outputDir: artifactOutput }).archive, installStore: join(root, 'install') });
  const installedOrient = join(installed.path, 'orientation', 'bin', 'orient.mjs');
  const installedProject = join(root, 'installed-project');
  git(root, 'init', '-q', installedProject);
  writeFileSync(join(installedProject, 'package.json'), JSON.stringify({ name: 'installed-state-fixture' }));
  const installedResult = spawnSync(process.execPath, [installedOrient, installedProject], { encoding: 'utf8', env: environment });
  assert.equal(installedResult.status, 0, installedResult.stderr);
  const installedState = resolveRuntimeState(installedProject, { environment });
  assert.ok(existsSync(installedState.orientation_json));
  assert.equal(existsSync(join(installedProject, '.opencode')), false);
  const installedLocator = await import(pathToFileURL(join(installed.path, 'harness-runtime', 'lib', 'runtime-state.mjs')).href);
  assert.equal(installedLocator.resolveRuntimeState(installedProject, { environment }).root, installedState.root);
  assert.match(readFileSync(installedState.orientation_json, 'utf8'), /installed-project/);
  const bin = join(root, 'installed-bin');
  const opencode = join(bin, 'opencode');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin, { recursive: true }));
  writeFileSync(opencode, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.18.21; exit 0; fi\nif [ "$1" = "models" ]; then printf "%s\\n" freellmapi/auto:default freellmapi/auto:planning freellmapi/auto:coding freellmapi/auto:wayfinder freellmapi/auto:research freellmapi/auto:verification freellmapi/auto:review freellmapi/auto:reasoning freellmapi/auto:utility; fi\n');
  chmodSync(opencode, 0o755);
  writeFileSync(join(root, 'machine.json'), JSON.stringify({ profile: 'free' }));
  const installedOcode = join(installed.path, 'harness-runtime', 'bin', 'ocode.mjs');
  const startup = spawnSync(process.execPath, [installedOcode, '.'], {
    cwd: installedProject,
    encoding: 'utf8',
    env: { ...environment, PATH: `${bin}:${process.env.PATH}`, OCODE_MACHINE_CONFIG: join(root, 'machine.json'), OCODE_DISABLE_INTERACTIVE_ACTIVITY_BRIDGE: '1' },
  });
  assert.equal(startup.status, 0, startup.stderr);
  assert.equal(existsSync(join(installedProject, '.opencode')), false, 'installed normal startup does not write target .opencode');
  assert.equal(queryActivity(installedState.activity).events.some((event) => event.event_type === 'WORKFLOW_STARTED'), true);
  console.log('✓ installed artifact normal startup persists orientation and activity through the same external state contract');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('DD1_RUNTIME_STATE_PROVEN');
