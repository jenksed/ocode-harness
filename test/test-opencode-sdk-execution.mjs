import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executeGovernedRole } from '../packages/harness-runtime/lib/execution.mjs';
import { checkpointQualificationExecution } from '../packages/harness-runtime/lib/skill-qualification.mjs';
import { normalizeOpenCodeSdkEvent, runOpenCodeSdkSession } from '../packages/harness-runtime/lib/opencode-sdk-execution.mjs';
import { activityStorePath, queryActivity } from '../packages/harness-runtime/lib/activity.mjs';
import { createTaskCapsule } from '../packages/harness-runtime/lib/task-capsule.mjs';

const root = resolve('.');
const runtimeIdentity = { executable: { path: process.execPath } };
const projectDir = mkdtempSync(join(tmpdir(), 'ocode-sdk-test-'));
writeFileSync(join(projectDir, 'package.json'), '{"scripts":{"test":"node -e \\"process.exit(0)\\""}}');
const profile = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root, 'profiles/free.json'), 'utf8'));
const allow = { decision: 'ALLOW', subject: { role: 'coder' } };
const taskCapsule = createTaskCapsule({ task_id: 'sdk-task', revision: 1, parent_fingerprint: null, objective: 'Exercise one governed SDK chain', authoritative_inputs: [{ id: 'fixture', kind: 'PATH', reference: 'fixture.txt', fingerprint: 'a'.repeat(64), description: 'Controlled fixture' }], scope: { include_paths: ['fixture.txt'], exclude_paths: [] }, non_goals: ['No unrelated work'], constraints: ['Preserve authority'], acceptance: [{ id: 'sdk-completes', requirement: 'Governed execution completes', required_evidence: ['sdk-event'] }], stop_conditions: ['Stop on runtime error'], context: { path_refs: ['fixture.txt'], evidence_refs: [], max_supplied_chars: 4096, max_expansions: 0 }, assumptions: [], provenance: { workflow_id: 'sdk-observable-workflow', run_id: null, session_id: null, role: 'orchestrator' } });

function fakeSdk({ events = [], messages, status = { s1: { type: 'busy' } }, promptError = null } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  let closed = 0;
  let aborted = 0;
  let serverOptions = null;
  let serverPath = null;
  let serverExecutable = null;
  const assistantMessages = messages ?? [{
    info: { id: 'a1', sessionID: 's1', role: 'assistant', providerID: 'freellmapi', modelID: 'auto:coding', agent: 'coder' },
    parts: [{ id: 'p1', sessionID: 's1', messageID: 'a1', type: 'text', text: '{"ok":true}' }],
  }];
  const sdk = {
    async createOpencodeServer(options) {
      serverOptions = options;
      serverPath = process.env.PATH;
      serverExecutable = realpathSync(join(serverPath.split(':')[0], 'opencode'));
      calls.push('server.start');
      return { url: 'http://sdk.invalid', close() { closed += 1; calls.push('server.close'); } };
    },
    createOpencodeClient() {
      return {
        event: {
          async subscribe() {
            calls.push('event.subscribe');
            return { stream: (async function* () {
              await gate;
              for (const event of events) yield event;
              await new Promise(() => {});
            })() };
          },
        },
        session: {
          async create() { calls.push('session.create'); return { data: { id: 's1' } }; },
          async promptAsync() { calls.push('session.promptAsync'); release(); return promptError ? { error: promptError } : { data: true }; },
          async status() { calls.push('session.status'); return { data: status }; },
          async messages() { calls.push('session.messages'); return { data: assistantMessages }; },
          async abort() { aborted += 1; calls.push('session.abort'); return { data: true }; },
        },
      };
    },
  };
  return { sdk, calls, get closed() { return closed; }, get aborted() { return aborted; }, get serverOptions() { return serverOptions; }, get serverPath() { return serverPath; }, get serverExecutable() { return serverExecutable; } };
}

const rawTool = { type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 's1', tool: 'skill', state: { status: 'completed', input: { name: 'tdd' } } } } };
assert.deepEqual(normalizeOpenCodeSdkEvent(rawTool), { type: 'tool_use', sessionID: 's1', part: rawTool.properties.part });

const happy = fakeSdk({ events: [
  { type: 'session.status', properties: { sessionID: 'wrong', status: { type: 'idle' } } },
  rawTool,
  { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
] });
const result = await runOpenCodeSdkSession({
  projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding',
  prompt: 'bounded', config: {}, sdk: happy.sdk, runtimeIdentity, timeout: 500,
});
assert.equal(result.termination, 'SESSION_IDLE');
assert.equal(result.completion_source, 'SESSION_IDLE_EVENT');
assert.equal(result.model_output, '{"ok":true}');
assert.equal(result.events.some((event) => event.type === 'tool_use'), true);
assert.equal(result.prompt_submissions, 1);
assert.equal(happy.calls.indexOf('event.subscribe') < happy.calls.indexOf('session.promptAsync'), true);
assert.equal(happy.closed, 1);
assert.equal(happy.serverExecutable, realpathSync(process.execPath));
console.log('✓ SDK server PATH is bound to the qualified executable alias');
console.log('✓ SDK subscription precedes one prompt; wrong-session idle is ignored; matching idle returns messages and tool evidence');

const queried = fakeSdk({ status: { s1: { type: 'idle' } } });
const queryResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: queried.sdk, runtimeIdentity, timeout: 500 });
assert.equal(queryResult.completion_source, 'SESSION_IDLE_QUERY');
assert.equal(queryResult.prompt_submissions, 1);
console.log('✓ Authoritative session-status query closes the event race without duplicate inference');

const stopped = fakeSdk({ events: [rawTool] });
const stoppedResult = await runOpenCodeSdkSession({
  projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: stopped.sdk, runtimeIdentity, timeout: 500,
  methodEvidenceGate: ({ events }) => events.some((event) => event.type === 'tool_use') ? { method_evidence_sufficient: true, proof: 'runtime' } : null,
});
assert.equal(stoppedResult.termination, 'METHOD_PROVEN_SESSION_STOPPED');
assert.equal(stoppedResult.completion_source, 'METHOD_EVIDENCE_SUFFICIENT');
assert.equal(stopped.aborted, 1);
assert.equal(stoppedResult.events.filter((event) => event.type === 'tool_use').length, 1);
assert.deepEqual(stoppedResult.method_evidence, { method_evidence_sufficient: true, proof: 'runtime' });
console.log('✓ Runtime evidence gate aborts the SDK method session and preserves pre-stop events');

const errored = fakeSdk({ events: [
  { type: 'session.error', properties: { sessionID: 's1', error: { name: 'failure' } } },
  { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
] });
const errorResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: errored.sdk, runtimeIdentity, timeout: 500 });
assert.equal(errorResult.termination, 'PROCESS_ERROR');
assert.match(errorResult.spawn_error, /OPENCODE_SDK_SESSION_ERROR/);
assert.equal(errored.aborted, 1);
assert.equal(errored.closed, 1);
console.log('✓ Matching session error wins over idle and cleanup always runs');

const providerFailure = fakeSdk({ events: [
  { type: 'session.error', properties: { sessionID: 's1', error: { name: 'APIError', statusCode: 401, message: 'Invalid API key', url: 'http://127.0.0.1:3001/v1/chat/completions' } } },
] });
const providerFailureResult = await executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'coder', profile,
  bindingSource: 'test', admissionDecision: allow, prompt: 'bounded', models: ['freellmapi/auto:coding'],
  sdk: providerFailure.sdk, timeout: 500,
  taskCapsule, taskCapsuleFingerprint: taskCapsule.fingerprint, requireTaskCapsule: true,
  capability: 'implementation.change', workflowId: 'sdk-provider-failure-workflow',
});
assert.equal(providerFailureResult.success, false);
assert.equal(providerFailureResult.failure_classification, 'PROVIDER_FAILURE');
assert.equal(providerFailureResult.ledger_record.model_telemetry.failure_classification, 'PROVIDER_FAILURE');
assert.equal(providerFailureResult.ledger_record.model_telemetry.failure_attribution, 'NON_MODEL');
console.log('✓ Provider API failures remain separate from model capability failures');

const waiting = fakeSdk();
const timeoutResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: waiting.sdk, runtimeIdentity, timeout: 20 });
assert.equal(timeoutResult.termination, 'PROCESS_TIMEOUT');
assert.equal(waiting.closed, 1);
console.log('✓ Timeout before authoritative completion fails closed and aborts the session');

const governedFake = fakeSdk({ events: [
  { type: 'permission.updated', properties: { id: 'permission-sdk', type: 'bash', sessionID: 's1', callID: 'call-sdk', title: 'Run command', metadata: {}, time: { created: 1 } } },
  { type: 'permission.replied', properties: { sessionID: 's1', permissionID: 'permission-sdk', response: 'once' } },
  { type: 'message.part.updated', properties: { part: { id: 'tool-sdk', sessionID: 's1', messageID: 'm-sdk', type: 'tool', callID: 'call-sdk', tool: 'bash', state: { status: 'completed', input: {}, output: 'must not persist', title: 'Run command', metadata: {}, time: { start: 1, end: 2 } } } } },
  { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
] });
const governed = await executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'coder', profile,
  bindingSource: 'test', admissionDecision: allow, prompt: 'bounded', models: ['freellmapi/auto:coding'],
  sdk: governedFake.sdk, timeout: 500,
  taskCapsule, taskCapsuleFingerprint: taskCapsule.fingerprint, requireTaskCapsule: true, capability: 'implementation.change', validationResults: ['fixture:PASS'],
  workflowId: 'sdk-observable-workflow', parentAgentRole: 'orchestrator', parentSessionId: 'parent-session', delegationId: 'sdk-coder-delegation',
});
assert.equal(governed.transport, 'OPENCODE_SDK');
assert.equal(governed.reconciliation.state, 'MATCH');
assert.equal(governed.subject_reconciliation.state, 'MATCH');
assert.equal(governed.model_output, '{"ok":true}');
assert.equal(governed.ledger_record.execution_provenance.binding_reconciliation, 'MATCH');
assert.equal(governed.ledger_record.model_telemetry.task_capsule_fingerprint, taskCapsule.fingerprint);
assert.equal(governed.ledger_record.model_telemetry.capability, 'implementation.change');
assert.equal(governed.ledger_record.model_telemetry.acceptance_result, 'UNRESOLVED');
assert.equal(governedFake.serverOptions.config.agent.coder.permission.bash['npm test'], 'allow');
assert.equal(governedFake.serverOptions.config.agent.coder.permission.bash['*>*'], 'deny');
const activity = queryActivity(activityStorePath(projectDir), { workflow_id: 'sdk-observable-workflow' });
assert.equal(activity.events.some((event) => event.event_type === 'DELEGATION_CREATED'), true);
assert.equal(activity.events.some((event) => event.event_type === 'AGENT_STARTED' && event.agent_role === 'coder'), true);
assert.equal(activity.events.some((event) => event.event_type === 'AGENT_COMPLETED' && event.agent_role === 'coder'), true);
assert.equal(activity.workflow_graph.edges[0].parent_agent_role, 'orchestrator');
assert.equal(activity.workflow_graph.edges[0].child_agent_role, 'coder');
assert.equal(activity.effects.event_types.includes('APPROVAL_GRANTED'), true);
assert.equal(activity.effects.event_types.includes('EFFECT_EXECUTED'), true);
assert.equal(JSON.stringify(activity.effects).includes('must not persist'), false);
const reviewerFake = fakeSdk({
  events: [{ type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } }],
  messages: [{ info: { id: 'review-1', sessionID: 's1', role: 'assistant', providerID: 'freellmapi', modelID: 'auto:review', agent: 'reviewer' }, parts: [{ id: 'review-text', sessionID: 's1', messageID: 'review-1', type: 'text', text: 'model prose is not a verdict' }] }],
});
await executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'reviewer', profile,
  bindingSource: 'test', admissionDecision: { decision: 'ALLOW', subject: { role: 'reviewer' } }, prompt: 'independent review', models: ['freellmapi/auto:review'], sdk: reviewerFake.sdk, timeout: 500,
  workflowId: 'sdk-observable-workflow', parentAgentRole: 'coder', parentSessionId: 's1', delegationId: 'sdk-review-delegation',
  taskCapsule, taskCapsuleFingerprint: taskCapsule.fingerprint, requireTaskCapsule: true, capability: 'adversarial-review', reviewerVerdict: 'NONE',
});
const reviewActivity = queryActivity(activityStorePath(projectDir), { workflow_id: 'sdk-observable-workflow' });
assert.equal(reviewActivity.events.some((event) => event.event_type === 'REVIEW_STARTED' && event.agent_role === 'reviewer'), true);
assert.equal(reviewActivity.events.some((event) => event.event_type === 'REVIEW_ACCEPTED'), false);
assert.equal(reviewActivity.review.status, 'STARTED');
const checkpoint = checkpointQualificationExecution({
  attempt_id: 'sdk-test', skill: { skill_id: 'tdd', skill_version: '1.0.0', skill_fingerprint: 'a'.repeat(64) },
  runtime: { session_id: governed.session_id, events: governed.events }, original_model_output: governed.model_output,
});
assert.equal(checkpoint.runtime.session_id, 's1');
console.log('✓ Governed result preserves binding, subject, ledger, output, runtime activity correlation, and checkpoint compatibility');

const deniedFake = fakeSdk();
await assert.rejects(() => executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'coder', profile,
  bindingSource: 'test', admissionDecision: { decision: 'DENY', subject: { role: 'coder' } },
  prompt: 'must not submit', models: ['freellmapi/auto:coding'], sdk: deniedFake.sdk,
}), /requires an allowed AdmissionDecision/);
assert.equal(deniedFake.calls.length, 0);
console.log('✓ M4 denial prevents server startup and prompt submission');

console.log('OPENCODE_SDK_EXECUTION_PROVEN');
