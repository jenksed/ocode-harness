import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendActivityEvent, createActivityEvent, queryActivity } from '../packages/harness-runtime/lib/activity.mjs';
import { createWorkViewModel, renderActivityView, renderAgentsView, renderAwarenessBar } from '../packages/harness-runtime/lib/work-view.mjs';

const store = mkdtempSync(join(tmpdir(), 'ocode-work-view-'));
try {
  const add = (event_type, input = {}) => appendActivityEvent(store, createActivityEvent({
    event_type, workflow_id: 'work-view-workflow', status: input.status ?? 'STARTED', agent_role: input.agent_role ?? 'orchestrator', agent_instance_id: input.agent_instance_id ?? 'orchestrator-1', session_id: input.session_id ?? 'root-session', summary: input.summary ?? event_type,
    parent_agent_role: input.parent_agent_role ?? null, parent_session_id: input.parent_session_id ?? null, delegation_id: input.delegation_id ?? null,
  }));
  add('AGENT_STARTED');
  add('DELEGATION_CREATED', { agent_role: 'coder', agent_instance_id: 'coder-1', session_id: 'coder-session', parent_agent_role: 'orchestrator', parent_session_id: 'root-session', delegation_id: 'delegation-coder', status: 'CREATED' });
  add('AGENT_STARTED', { agent_role: 'coder', agent_instance_id: 'coder-1', session_id: 'coder-session', parent_agent_role: 'orchestrator', parent_session_id: 'root-session', delegation_id: 'delegation-coder' });
  add('APPROVAL_REQUIRED', { agent_role: 'coder', agent_instance_id: 'coder-1', session_id: 'coder-session', status: 'REQUIRED', summary: 'Native approval required' });
  add('VERIFICATION_STARTED', { agent_role: 'verifier', agent_instance_id: 'verifier-1', session_id: 'verify-session' });
  const activity = queryActivity(store, { workflow_id: 'work-view-workflow' });
  const view = createWorkViewModel(activity, { work_items: [{ id: 'todo-1', title: 'Todo persistence', status: 'claimed', owner: 'coder' }] });
  assert.equal(view.runtime_agents.some((agent) => agent.source === 'runtime_activity' && agent.agent_role === 'coder'), true);
  assert.equal(view.work_items[0].source, 'persistent_work_item');
  assert.match(renderAwarenessBar(view), /◆ Coder · active/);
  const defaultView = renderActivityView(activity);
  assert.match(defaultView, /OCODE WORK/);
  assert.match(defaultView, /◇ Orchestrator/);
  assert.match(defaultView, /◆ Coder/);
  assert.match(defaultView, /approval required/);
  const verbose = renderActivityView(activity, { visibility: 'verbose', work_items: view.work_items });
  assert.match(verbose, /WORK ITEMS/);
  assert.match(verbose, /Todo persistence · coder · claimed/);
  const trace = renderActivityView(activity, { visibility: 'trace' });
  assert.match(trace, /workflow=work-view-workflow/);
  const agents = renderAgentsView({ roles: [{ id: 'orchestrator' }, { id: 'coder' }, { id: 'reviewer' }] }, activity);
  assert.match(agents, /Orchestrator\s+active/);
  assert.match(agents, /Coder\s+active/);
  assert.match(agents, /Reviewer\s+configured/);
  console.log('✓ Unified WORK projection keeps runtime activity and persistent work-item state distinct');
  console.log('✓ Awareness, graph, default/verbose/trace views, and agents status render from authoritative activity');
} finally {
  rmSync(store, { recursive: true, force: true });
}

console.log('WORK_VIEW_PROJECTION_PROVEN');
