import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { activityStorePath, queryActivity } from '../packages/harness-runtime/lib/activity.mjs';

const root = resolve('.');
const project = mkdtempSync(join(tmpdir(), 'ocode-interactive-activity-'));
const bin = join(project, 'bin');
const config = join(project, 'config.json');
const cli = resolve(root, 'packages/harness-runtime/bin/ocode.mjs');

try {
  mkdirSync(bin, { recursive: true });
  writeFileSync(config, JSON.stringify({ profile: 'free' }));
  const writeExecutable = (name, source) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${source}\n`);
    chmodSync(path, 0o755);
  };
  writeExecutable('orient', 'mkdir -p "$1/.opencode"\nprintf "{}" > "$1/.opencode/orientation.json"\nprintf "orientation" > "$1/.opencode/orientation.md"');
  writeExecutable('opencode', 'if [ "$1" = "models" ]; then printf "%s\\n" freellmapi/auto:default freellmapi/auto:planning freellmapi/auto:coding freellmapi/auto:wayfinder freellmapi/auto:research freellmapi/auto:verification freellmapi/auto:review freellmapi/auto:reasoning freellmapi/auto:utility; fi\nexit 0');
  const result = spawnSync(process.execPath, [cli], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OCODE_HARNESS_ROOT: root, OCODE_MACHINE_CONFIG: config },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WORK — ◇ Orchestrator · active/);
  const activity = queryActivity(activityStorePath(project));
  assert.equal(activity.events.some((event) => event.event_type === 'WORKFLOW_STARTED' && event.agent_role === 'orchestrator'), true);
  assert.equal(activity.events.some((event) => event.event_type === 'AGENT_STARTED' && event.agent_role === 'orchestrator'), true);
  assert.equal(activity.events.some((event) => event.event_type === 'AGENT_COMPLETED' && event.agent_role === 'orchestrator'), true);
  console.log('✓ Normal ocode launcher emits runtime-owned primary workflow and orchestrator lifecycle activity');
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log('INTERACTIVE_ACTIVITY_CAPTURE_PROVEN');
