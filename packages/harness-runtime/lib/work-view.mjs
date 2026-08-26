import { AGENT_DISPLAY_METADATA } from './activity.mjs';

const DEFAULT_EVENT_TYPES = new Set([
  'WORKFLOW_STARTED', 'WORKFLOW_COMPLETED', 'WORKFLOW_BLOCKED',
  'AGENT_STARTED', 'AGENT_COMPLETED', 'AGENT_BLOCKED', 'AGENT_FAILED',
  'APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'EFFECT_EXECUTED', 'EFFECT_DENIED',
  'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'VERIFICATION_FAILED', 'REVIEW_STARTED', 'REVIEW_ACCEPTED', 'REVIEW_REJECTED',
]);

export const WORK_VISIBILITY = Object.freeze(['default', 'verbose', 'trace']);

function label(role) {
  return AGENT_DISPLAY_METADATA[role]?.display_name ?? role ?? 'Unknown';
}

function glyph(role) {
  return AGENT_DISPLAY_METADATA[role]?.glyph ?? '•';
}

function stateGlyph(status) {
  return { ACTIVE: '●', COMPLETED: '✓', BLOCKED: '×', FAILED: '×', STARTED: '●', NOT_RUN: '○' }[status] ?? '○';
}

function duration(start, end) {
  if (!start || !end) return null;
  const elapsed = Date.parse(end) - Date.parse(start);
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s` : null;
}

/**
 * Read-only projection. Runtime activity and optional persistent work items stay
 * separate so a work item never manufactures an agent lifecycle claim.
 */
export function createWorkViewModel(activity, { work_items = [] } = {}) {
  const runtime_agents = [...activity.active_agents, ...activity.recently_completed_agents]
    .map((event) => ({
      source: 'runtime_activity', agent_role: event.agent_role, agent_instance_id: event.agent_instance_id,
      session_id: event.session_id, workflow_id: event.workflow_id,
      status: event.event_type === 'AGENT_STARTED' ? 'ACTIVE' : 'COMPLETED',
      display_name: label(event.agent_role), glyph: glyph(event.agent_role),
      task_id: event.task_id, work_item_id: event.work_item_id,
    }));
  const work = work_items.map((item) => ({
    source: 'persistent_work_item', id: item.id, title: item.title, status: item.status,
    owner: item.owner ?? null, blocked_reason: item.blocked_reason ?? null,
  }));
  return {
    source: 'projection', runtime_agents, work_items: work,
    graph: activity.workflow_graph, recent_events: activity.events,
    effects: activity.effects, verification: activity.verification, review: activity.review,
  };
}

export function renderAwarenessBar(view) {
  const active = view.runtime_agents.filter((agent) => agent.status === 'ACTIVE');
  if (active.length === 0) return 'WORK — ○ No active runtime agents';
  return `WORK — ${active.slice(0, 3).map((agent) => `${agent.glyph} ${agent.display_name} · active`).join('  ·  ')}`;
}

function renderNode(node, edges, nodes, prefix = '', seen = new Set()) {
  if (seen.has(node.agent_instance_id)) return [];
  seen.add(node.agent_instance_id);
  const children = edges.filter((edge) => edge.parent_agent_role === node.agent_role && (!edge.parent_session_id || edge.parent_session_id === node.session_id));
  const line = `${prefix}${glyph(node.agent_role)} ${label(node.agent_role)} ${stateGlyph(node.status)}`;
  return [line, ...children.flatMap((edge, index) => {
    const child = nodes.get(edge.child_agent_instance_id);
    return child ? renderNode(child, edges, nodes, `${prefix}${index === children.length - 1 ? '   └── ' : '   ├── '}`, seen) : [];
  })];
}

export function renderDelegationGraph(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.agent_instance_id, node]));
  const children = new Set(graph.edges.map((edge) => edge.child_agent_instance_id));
  const roots = graph.nodes.filter((node) => !children.has(node.agent_instance_id));
  const lines = roots.flatMap((node) => renderNode(node, graph.edges, nodes));
  return lines.length ? lines.join('\n') : '○ No runtime delegation recorded';
}

export function renderAnnouncement(event, visibility = 'default') {
  const role = event.agent_role ? `${glyph(event.agent_role)} ${label(event.agent_role)}` : null;
  const verbs = {
    AGENT_STARTED: 'started', AGENT_COMPLETED: 'complete', AGENT_BLOCKED: 'blocked', AGENT_FAILED: 'failed',
    VERIFICATION_STARTED: 'verification started', VERIFICATION_COMPLETED: 'verification complete', VERIFICATION_FAILED: 'verification failed',
    REVIEW_STARTED: 'review started', REVIEW_ACCEPTED: 'review accepted', REVIEW_REJECTED: 'review rejected',
    APPROVAL_REQUIRED: 'approval required', APPROVAL_GRANTED: 'approval granted', APPROVAL_REJECTED: 'approval rejected',
    EFFECT_EXECUTED: 'effect executed', EFFECT_DENIED: 'effect denied', WORKFLOW_BLOCKED: 'workflow blocked',
    WORKFLOW_STARTED: 'workflow started', WORKFLOW_COMPLETED: 'workflow complete',
  };
  const main = verbs[event.event_type] ?? event.event_type.toLowerCase().replaceAll('_', ' ');
  const prefix = ['AGENT_COMPLETED', 'VERIFICATION_COMPLETED', 'REVIEW_ACCEPTED', 'APPROVAL_GRANTED', 'EFFECT_EXECUTED', 'WORKFLOW_COMPLETED'].includes(event.event_type) ? '✓' : event.event_type.includes('BLOCKED') || event.event_type.includes('FAILED') || event.event_type.includes('REJECTED') || event.event_type.includes('DENIED') ? '×' : '↳';
  let output = `${prefix} ${role ? `${role} ` : ''}${main}`;
  if (visibility !== 'default') output += ` · ${event.summary}`;
  if (visibility === 'trace') output += ` [workflow=${event.workflow_id}${event.session_id ? ` session=${event.session_id}` : ''}]`;
  return output;
}

export function renderActivityView(activity, { visibility = 'default', work_items = [] } = {}) {
  if (!WORK_VISIBILITY.includes(visibility)) throw new Error(`Unknown work visibility: ${visibility}`);
  const view = createWorkViewModel(activity, { work_items });
  const lines = ['OCODE WORK', '', renderAwarenessBar(view), '', 'AGENTS', renderDelegationGraph(view.graph)];
  if (view.work_items.length) {
    lines.push('', 'WORK ITEMS');
    for (const item of view.work_items) lines.push(`${stateGlyph(String(item.status).toUpperCase())} ${item.title} · ${item.owner ?? 'unassigned'} · ${item.status}`);
  }
  const events = view.recent_events.filter((event) => visibility !== 'default' || DEFAULT_EVENT_TYPES.has(event.event_type)).slice(-12);
  lines.push('', 'RECENT');
  lines.push(...(events.length ? events.map((event) => renderAnnouncement(event, visibility)) : ['○ No runtime activity recorded']));
  if (visibility !== 'default') {
    lines.push('', `VERIFICATION · ${view.verification.status}`, `REVIEW · ${view.review.status}`);
  }
  return lines.join('\n');
}

export function renderAgentsView(manifest, activity) {
  const active = new Map(activity.active_agents.map((event) => [event.agent_role, event]));
  const recent = new Map(activity.recently_completed_agents.map((event) => [event.agent_role, event]));
  const lines = ['ROLE           STATUS      CURRENT'];
  for (const role of manifest.roles) {
    const now = active.get(role.id);
    const done = recent.get(role.id);
    const status = now ? 'active' : done ? 'recent' : 'configured';
    const current = now ? `workflow ${now.workflow_id.slice(0, 12)}` : done ? 'completed runtime session' : '-';
    lines.push(`${label(role.id).padEnd(14)} ${status.padEnd(11)} ${current}`);
  }
  return lines.join('\n');
}

export { duration };
