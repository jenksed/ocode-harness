import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executeGovernedRole } from '../packages/harness-runtime/lib/execution.mjs';
import { checkpointQualificationExecution } from '../packages/harness-runtime/lib/skill-qualification.mjs';
import { normalizeOpenCodeSdkEvent, runOpenCodeSdkSession } from '../packages/harness-runtime/lib/opencode-sdk-execution.mjs';

const root = resolve('.');
const projectDir = mkdtempSync(join(tmpdir(), 'ocode-sdk-test-'));
const profile = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root, 'profiles/free.json'), 'utf8'));
const allow = { decision: 'ALLOW', subject: { role: 'coder' } };

function fakeSdk({ events = [], messages, status = { s1: { type: 'busy' } }, promptError = null } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  let closed = 0;
  let aborted = 0;
  const assistantMessages = messages ?? [{
    info: { id: 'a1', sessionID: 's1', role: 'assistant', providerID: 'freellmapi', modelID: 'auto:coding', agent: 'coder' },
    parts: [{ id: 'p1', sessionID: 's1', messageID: 'a1', type: 'text', text: '{"ok":true}' }],
  }];
  const sdk = {
    async createOpencodeServer() {
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
  return { sdk, calls, get closed() { return closed; }, get aborted() { return aborted; } };
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
  prompt: 'bounded', config: {}, sdk: happy.sdk, timeout: 500,
});
assert.equal(result.termination, 'SESSION_IDLE');
assert.equal(result.completion_source, 'SESSION_IDLE_EVENT');
assert.equal(result.model_output, '{"ok":true}');
assert.equal(result.events.some((event) => event.type === 'tool_use'), true);
assert.equal(result.prompt_submissions, 1);
assert.equal(happy.calls.indexOf('event.subscribe') < happy.calls.indexOf('session.promptAsync'), true);
assert.equal(happy.closed, 1);
console.log('✓ SDK subscription precedes one prompt; wrong-session idle is ignored; matching idle returns messages and tool evidence');

const queried = fakeSdk({ status: { s1: { type: 'idle' } } });
const queryResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: queried.sdk, timeout: 500 });
assert.equal(queryResult.completion_source, 'SESSION_IDLE_QUERY');
assert.equal(queryResult.prompt_submissions, 1);
console.log('✓ Authoritative session-status query closes the event race without duplicate inference');

const stopped = fakeSdk({ events: [rawTool] });
const stoppedResult = await runOpenCodeSdkSession({
  projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: stopped.sdk, timeout: 500,
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
const errorResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: errored.sdk, timeout: 500 });
assert.equal(errorResult.termination, 'PROCESS_ERROR');
assert.match(errorResult.spawn_error, /OPENCODE_SDK_SESSION_ERROR/);
assert.equal(errored.aborted, 1);
assert.equal(errored.closed, 1);
console.log('✓ Matching session error wins over idle and cleanup always runs');

const waiting = fakeSdk();
const timeoutResult = await runOpenCodeSdkSession({ projectDir: root, role: 'coder', providerID: 'freellmapi', modelID: 'auto:coding', prompt: 'bounded', config: {}, sdk: waiting.sdk, timeout: 20 });
assert.equal(timeoutResult.termination, 'PROCESS_TIMEOUT');
assert.equal(waiting.closed, 1);
console.log('✓ Timeout before authoritative completion fails closed and aborts the session');

const governedFake = fakeSdk({ events: [{ type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } }] });
const governed = await executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'coder', profile,
  bindingSource: 'test', admissionDecision: allow, prompt: 'bounded', models: ['freellmapi/auto:coding'],
  sdk: governedFake.sdk, timeout: 500,
});
assert.equal(governed.transport, 'OPENCODE_SDK');
assert.equal(governed.reconciliation.state, 'MATCH');
assert.equal(governed.subject_reconciliation.state, 'MATCH');
assert.equal(governed.model_output, '{"ok":true}');
assert.equal(governed.ledger_record.execution_provenance.binding_reconciliation, 'MATCH');
const checkpoint = checkpointQualificationExecution({
  attempt_id: 'sdk-test', skill: { skill_id: 'tdd', skill_version: '1.0.0', skill_fingerprint: 'a'.repeat(64) },
  runtime: { session_id: governed.session_id, events: governed.events }, original_model_output: governed.model_output,
});
assert.equal(checkpoint.runtime.session_id, 's1');
console.log('✓ Governed result preserves binding, subject, ledger, output, events, and checkpoint compatibility');

const deniedFake = fakeSdk();
await assert.rejects(() => executeGovernedRole({
  transport: 'sdk', baseDir: root, projectDir, role: 'coder', profile,
  bindingSource: 'test', admissionDecision: { decision: 'DENY', subject: { role: 'coder' } },
  prompt: 'must not submit', models: ['freellmapi/auto:coding'], sdk: deniedFake.sdk,
}), /requires an allowed AdmissionDecision/);
assert.equal(deniedFake.calls.length, 0);
console.log('✓ M4 denial prevents server startup and prompt submission');

console.log('OPENCODE_SDK_EXECUTION_PROVEN');
