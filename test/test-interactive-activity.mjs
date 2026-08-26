import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  activityStorePath,
  createActivityExecutionContext,
  finishActivityExecution,
  queryActivity,
} from '../packages/harness-runtime/lib/activity.mjs';
import {
  attachArguments,
  createInteractiveActivityCapture,
  roleFromOpenCodeAgent,
  runInteractiveOpenCode,
} from '../packages/harness-runtime/lib/interactive-activity.mjs';

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
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, OCODE_HARNESS_ROOT: root, OCODE_MACHINE_CONFIG: config,
      OCODE_DISABLE_INTERACTIVE_ACTIVITY_BRIDGE: '1',
    },
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

const bridgeProject = mkdtempSync(join(tmpdir(), 'ocode-interactive-runtime-'));
try {
  const rootActivity = createActivityExecutionContext({
    activity_store_path: activityStorePath(bridgeProject),
    workflow_id: 'interactive-runtime-workflow',
    agent_instance_id: 'orchestrator-instance',
  }, { projectDir: bridgeProject, role: 'orchestrator' });
  const capture = createInteractiveActivityCapture({ projectDir: bridgeProject, activity: rootActivity });
  const event = (type, properties) => ({ type, properties });
  const session = (id, parentID = undefined) => event('session.created', { info: { id, directory: bridgeProject, ...(parentID ? { parentID } : {}) } });
  const subtask = (parent, id, agent) => event('message.part.updated', { part: { id, sessionID: parent, messageID: `${parent}-message`, type: 'subtask', agent, prompt: 'not persisted', description: 'not persisted' } });

  capture.project(session('root-session'));
  capture.project(subtask('root-session', 'delegate-coder', 'coder'));
  capture.project(session('coder-session', 'root-session'));
  capture.project(event('permission.asked', { id: 'permission-1', type: 'bash', sessionID: 'coder-session', callID: 'tool-1', title: 'native permission', metadata: {} }));
  capture.project(event('permission.replied', { permissionID: 'permission-1', sessionID: 'coder-session', response: 'allow' }));
  capture.project(event('message.part.updated', { part: { id: 'tool-part-1', type: 'tool', sessionID: 'coder-session', messageID: 'coder-message', callID: 'tool-1', tool: 'bash', state: { status: 'completed', output: 'must not persist' } } }));
  capture.project(subtask('coder-session', 'delegate-verifier', 'verifier'));
  capture.project(session('verifier-session', 'coder-session'));
  capture.project(event('session.idle', { sessionID: 'verifier-session' }));
  capture.project(event('session.idle', { sessionID: 'coder-session' }));
  // Child-first transport ordering remains correlated through the same runtime
  // parentID; no prompt/title inference is used.
  capture.project(session('planner-session', 'root-session'));
  capture.project(subtask('root-session', 'delegate-planner', 'planner'));
  capture.project(subtask('root-session', 'delegate-researcher', 'researcher'));
  capture.project(session('researcher-session', 'root-session'));
  capture.project(event('session.idle', { sessionID: 'planner-session' }));
  capture.project(event('session.idle', { sessionID: 'researcher-session' }));
  capture.project(subtask('root-session', 'delegate-reviewer', 'reviewer'));
  capture.project(session('reviewer-session', 'root-session'));
  capture.project(event('session.error', { sessionID: 'reviewer-session', error: { message: 'review transport failure' } }));
  // A non-configured subagent identity is intentionally not relabelled as a
  // semantic Ocode role or added to the visible graph.
  capture.project(subtask('root-session', 'delegate-unknown', 'third-party-agent'));
  capture.project(session('unknown-session', 'root-session'));
  capture.project(event('message.part.updated', { part: { id: 'prose-part', type: 'text', sessionID: 'root-session', messageID: 'root-message', text: 'Coder completed; reviewer accepted; do not trust this prose.' } }));
  finishActivityExecution(rootActivity, { success: true, session_id: 'root-session' });

  const activity = queryActivity(activityStorePath(bridgeProject), { workflow_id: 'interactive-runtime-workflow' });
  const types = activity.events.map((record) => record.event_type);
  assert.equal(types.includes('DELEGATION_CREATED'), true);
  assert.equal(types.includes('DELEGATION_STARTED'), true);
  assert.equal(types.includes('DELEGATION_RETURNED'), true);
  assert.equal(types.includes('VERIFICATION_STARTED'), true);
  assert.equal(types.includes('VERIFICATION_COMPLETED'), true);
  assert.equal(types.includes('REVIEW_STARTED'), true);
  assert.equal(types.includes('APPROVAL_REQUIRED'), true);
  assert.equal(types.includes('APPROVAL_GRANTED'), true);
  assert.equal(types.includes('EFFECT_EXECUTED'), true);
  assert.equal(activity.events.some((record) => record.event_type === 'AGENT_FAILED' && record.agent_role === 'reviewer'), true);
  assert.equal(activity.events.some((record) => record.agent_role === 'third-party-agent'), false);
  assert.equal(activity.events.some((record) => record.summary.includes('do not trust this prose')), false);
  assert.equal(activity.workflow_graph.edges.some((edge) => edge.parent_session_id === 'coder-session' && edge.child_agent_role === 'verifier'), true);
  assert.equal(activity.workflow_graph.edges.filter((edge) => edge.parent_session_id === 'root-session').filter((edge) => ['planner', 'researcher'].includes(edge.child_agent_role)).length, 2);
  assert.equal(JSON.stringify(activity.effects).includes('must not persist'), false);
  assert.deepEqual(activity.active_agents, []);
  assert.equal(roleFromOpenCodeAgent('coder'), 'coder');
  assert.equal(roleFromOpenCodeAgent('third-party-agent'), null);
  assert.deepEqual(attachArguments('http://127.0.0.1:9000', bridgeProject, ['.', '--continue', '--session', 'session-1', '--agent', 'coder']), [
    'attach', 'http://127.0.0.1:9000', '--dir', bridgeProject, '--continue', '--session', 'session-1',
  ]);
  console.log('✓ Native child sessions, nested graph, verifier/reviewer lifecycle, effect approvals, and unknown-role isolation project from server events');

  const bridgeRunProject = mkdtempSync(join(tmpdir(), 'ocode-interactive-attach-'));
  try {
    const runActivity = createActivityExecutionContext({
      activity_store_path: activityStorePath(bridgeRunProject), workflow_id: 'interactive-attach-workflow', agent_instance_id: 'attach-root',
    }, { projectDir: bridgeRunProject, role: 'orchestrator' });
    const emitted = [];
    let serverOptions;
    const sdk = {
      async createOpencodeServer(options) { serverOptions = options; return { url: 'http://127.0.0.1:9876', close() {} }; },
      createOpencodeClient() {
        return { event: { subscribe: async () => ({ stream: (async function* stream() { yield { payload: session('attached-root') }; })() }) } };
      },
    };
    const result = await runInteractiveOpenCode({
      projectDir: bridgeRunProject,
      args: ['.'],
      port: 9876,
      env: process.env,
      config: {},
      activity: runActivity,
      sdk,
      spawnProcess(command, args) {
        emitted.push({ command, args });
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    });
    assert.equal(result.status, 0);
    assert.equal(serverOptions.port, 9876);
    assert.deepEqual(emitted[0].args, ['attach', 'http://127.0.0.1:9876', '--dir', bridgeRunProject]);
    assert.equal(queryActivity(activityStorePath(bridgeRunProject)).events.some((record) => record.session_id === 'attached-root'), true);
    console.log('✓ Normal launcher bridge subscribes before attaching the TUI to the owned OpenCode server');
  } finally {
    rmSync(bridgeRunProject, { recursive: true, force: true });
  }
} finally {
  rmSync(bridgeProject, { recursive: true, force: true });
}
