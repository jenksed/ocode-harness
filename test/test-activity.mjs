import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVITY_SCHEMA_VERSION,
  ACTIVITY_EVENT_TYPES,
  AGENT_DISPLAY_METADATA,
  appendActivityEvent,
  createActivityEvent,
  createRuntimeActivityProjector,
  queryActivity,
} from '../packages/harness-runtime/lib/activity.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-activity-'));
const storePath = join(root, 'activity');
const workflowID = 'workflow-observable';

try {
  const record = (eventType, overrides = {}) => appendActivityEvent(storePath, createActivityEvent({
    event_type: eventType,
    workflow_id: workflowID,
    agent_role: 'orchestrator',
    ...overrides,
  }));

  record('WORKFLOW_STARTED', { status: 'STARTED' });
  record('AGENT_STARTED', { status: 'STARTED', agent_instance_id: 'orchestrator-1', session_id: 'session-root' });
  record('DELEGATION_CREATED', {
    status: 'CREATED', delegation_id: 'delegation-coder', agent_role: 'coder', agent_instance_id: 'coder-1',
    parent_agent_role: 'orchestrator', parent_session_id: 'session-root',
  });
  record('DELEGATION_STARTED', {
    status: 'STARTED', delegation_id: 'delegation-coder', agent_role: 'coder', agent_instance_id: 'coder-1',
    parent_agent_role: 'orchestrator', parent_session_id: 'session-root',
  });
  record('AGENT_STARTED', {
    status: 'STARTED', delegation_id: 'delegation-coder', agent_role: 'coder', agent_instance_id: 'coder-1',
    parent_agent_role: 'orchestrator', parent_session_id: 'session-root', session_id: 'session-coder',
  });
  record('DELEGATION_CREATED', {
    status: 'CREATED', delegation_id: 'delegation-verifier', agent_role: 'verifier', agent_instance_id: 'verifier-1',
    parent_agent_role: 'coder', parent_session_id: 'session-coder',
  });
  record('AGENT_STARTED', {
    status: 'STARTED', delegation_id: 'delegation-verifier', agent_role: 'verifier', agent_instance_id: 'verifier-1',
    parent_agent_role: 'coder', parent_session_id: 'session-coder',
  });
  record('VERIFICATION_STARTED', { status: 'STARTED', agent_role: 'verifier', agent_instance_id: 'verifier-1' });
  record('DELEGATION_CREATED', {
    status: 'CREATED', delegation_id: 'delegation-reviewer', agent_role: 'reviewer', agent_instance_id: 'reviewer-1',
    parent_agent_role: 'coder', parent_session_id: 'session-coder',
  });
  record('AGENT_STARTED', {
    status: 'STARTED', delegation_id: 'delegation-reviewer', agent_role: 'reviewer', agent_instance_id: 'reviewer-1',
    parent_agent_role: 'coder', parent_session_id: 'session-coder',
  });
  record('REVIEW_STARTED', { status: 'STARTED', agent_role: 'reviewer', agent_instance_id: 'reviewer-1' });
  record('AGENT_COMPLETED', { status: 'COMPLETED', agent_role: 'verifier', agent_instance_id: 'verifier-1' });
  record('VERIFICATION_COMPLETED', { status: 'COMPLETED', agent_role: 'verifier', agent_instance_id: 'verifier-1' });
  record('AGENT_COMPLETED', { status: 'COMPLETED', agent_role: 'reviewer', agent_instance_id: 'reviewer-1' });
  record('AGENT_BLOCKED', { status: 'BLOCKED', agent_role: 'coder', agent_instance_id: 'coder-1' });

  let result = queryActivity(storePath, { workflow_id: workflowID });
  assert.equal(ACTIVITY_SCHEMA_VERSION, 1);
  assert.equal(result.events[0].schema_version, 1);
  assert.equal(result.active_agents.some((agent) => agent.agent_role === 'orchestrator'), true);
  assert.equal(result.active_agents.some((agent) => agent.agent_role === 'coder'), false);
  assert.equal(result.recently_completed_agents.map((agent) => agent.agent_role).includes('verifier'), true);
  assert.equal(result.verification.status, 'COMPLETED');
  assert.equal(result.review.status, 'STARTED');
  assert.equal(result.workflow_graph.edges.filter((edge) => edge.parent_agent_role === 'coder').length, 2);
  assert.equal(result.workflow_graph.nodes.filter((node) => node.agent_role === 'verifier').length, 1);
  assert.equal(AGENT_DISPLAY_METADATA.reviewer.short_label, 'Review');
  console.log('✓ Workflow lifecycle, parallel delegation graph, active/recent views, and role metadata are derived from runtime records');

  const projector = createRuntimeActivityProjector({
    store_path: storePath, workflow_id: workflowID, session_id: 'session-root', agent_role: 'orchestrator', agent_instance_id: 'orchestrator-1',
  });
  projector({ type: 'permission.updated', properties: {
    id: 'permission-1', type: 'bash', sessionID: 'session-root', callID: 'call-1', title: 'Run command', metadata: {}, time: { created: 1 },
  } });
  projector({ type: 'permission.replied', properties: { sessionID: 'session-root', permissionID: 'permission-1', response: 'once' } });
  projector({ type: 'message.part.updated', properties: { part: {
    id: 'tool-1', sessionID: 'session-root', messageID: 'message-1', type: 'tool', callID: 'call-1', tool: 'bash',
    state: { status: 'completed', input: {}, output: 'sensitive command output', title: 'Run command', metadata: {}, time: { start: 1, end: 2 } },
  } } });
  result = queryActivity(storePath, { workflow_id: workflowID });
  assert.deepEqual(result.effects.event_types, ['EFFECT_REQUESTED', 'EFFECT_CLASSIFIED', 'APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'EFFECT_EXECUTED']);
  assert.equal(result.effects.events.some((event) => JSON.stringify(event).includes('sensitive command output')), false);
  assert.equal(result.effects.events.find((event) => event.event_type === 'EFFECT_EXECUTED').metadata.execution_owner, 'orchestrator');
  console.log('✓ Native permission and tool events preserve requestor/owner correlation without command output');

  const rejected = createRuntimeActivityProjector({ store_path: storePath, workflow_id: workflowID, session_id: 'session-root', agent_role: 'orchestrator' });
  rejected({ type: 'permission.updated', properties: { id: 'permission-2', type: 'bash', sessionID: 'session-root', callID: 'call-2', title: 'Run command', metadata: {}, time: { created: 1 } } });
  rejected({ type: 'permission.replied', properties: { sessionID: 'session-root', permissionID: 'permission-2', response: 'reject' } });
  result = queryActivity(storePath, { workflow_id: workflowID });
  assert.equal(result.effects.events.some((event) => event.event_type === 'APPROVAL_REJECTED'), true);
  assert.equal(result.effects.events.some((event) => event.event_type === 'EFFECT_DENIED'), true);
  console.log('✓ Native approval grants and rejections remain distinguishable');

  const reopened = queryActivity(storePath, { workflow_id: workflowID });
  assert.equal(reopened.events.length, result.events.length);
  writeFileSync(join(storePath, 'events', 'malformed.json'), '{not-json');
  const safe = queryActivity(storePath, { workflow_id: workflowID });
  assert.equal(safe.malformed_records, 1);
  assert.equal(safe.events.length, reopened.events.length);
  assert.throws(() => createActivityEvent({ event_type: 'NOT_REAL', workflow_id: workflowID }), /event_type/);
  assert.equal(ACTIVITY_EVENT_TYPES.includes('REVIEW_ACCEPTED'), true);
  console.log('✓ Durable reopen, malformed-record isolation, and explicit schema/event validation work');

  const boundedStore = join(root, 'bounded-activity');
  const bounded = (timestamp) => appendActivityEvent(boundedStore, createActivityEvent({
    event_type: 'AGENT_STARTED', workflow_id: 'bounded-workflow', status: 'STARTED', timestamp,
  }), { max_events: 2 });
  bounded('2026-01-01T00:00:00.000Z');
  bounded('2026-01-01T00:00:02.000Z');
  bounded('2026-01-01T00:00:01.000Z');
  const retained = queryActivity(boundedStore, { workflow_id: 'bounded-workflow' });
  assert.equal(retained.events.length, 2);
  assert.deepEqual(retained.events.map((event) => event.timestamp), [
    '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z',
  ]);
  console.log('✓ Activity retention preserves the exact newest bounded records without per-append rescans');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ACTIVITY_EVENT_MODEL_PROVEN');
