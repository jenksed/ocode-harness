import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ACTIVITY_SCHEMA_VERSION = 1;
export const DEFAULT_ACTIVITY_RETENTION = 1_000;

export const ACTIVITY_EVENT_TYPES = Object.freeze([
  'WORKFLOW_STARTED', 'WORKFLOW_COMPLETED', 'WORKFLOW_BLOCKED',
  'AGENT_STARTED', 'AGENT_COMPLETED', 'AGENT_BLOCKED', 'AGENT_FAILED',
  'DELEGATION_CREATED', 'DELEGATION_STARTED', 'DELEGATION_RETURNED',
  'EFFECT_REQUESTED', 'EFFECT_CLASSIFIED', 'APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'EFFECT_EXECUTED', 'EFFECT_DENIED',
  'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'VERIFICATION_FAILED',
  'REVIEW_STARTED', 'REVIEW_ACCEPTED', 'REVIEW_REJECTED',
  'JUDGMENT_STARTED', 'JUDGMENT_COMPLETED',
]);

export const AGENT_DISPLAY_METADATA = Object.freeze({
  orchestrator: Object.freeze({ role_id: 'orchestrator', display_name: 'Orchestrator', short_label: 'Orchestrator', glyph: '◇' }),
  planner: Object.freeze({ role_id: 'planner', display_name: 'Planner', short_label: 'Plan', glyph: '△' }),
  coder: Object.freeze({ role_id: 'coder', display_name: 'Coder', short_label: 'Code', glyph: '◆' }),
  researcher: Object.freeze({ role_id: 'researcher', display_name: 'Researcher', short_label: 'Research', glyph: '◌' }),
  verifier: Object.freeze({ role_id: 'verifier', display_name: 'Verifier', short_label: 'Verify', glyph: '◎' }),
  reviewer: Object.freeze({ role_id: 'reviewer', display_name: 'Reviewer', short_label: 'Review', glyph: '◈' }),
  judge: Object.freeze({ role_id: 'judge', display_name: 'Judge', short_label: 'Judge', glyph: '◉' }),
  committer: Object.freeze({ role_id: 'committer', display_name: 'Committer', short_label: 'Commit', glyph: '■' }),
  wayfinder: Object.freeze({ role_id: 'wayfinder', display_name: 'Wayfinder', short_label: 'Wayfind', glyph: '◍' }),
});

const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_FIELDS = new Set([
  'schema_version', 'event_id', 'event_type', 'timestamp', 'workflow_id', 'session_id', 'agent_role', 'agent_instance_id',
  'parent_agent_role', 'parent_session_id', 'delegation_id', 'task_id', 'work_item_id', 'effect_request_id', 'status', 'summary', 'metadata',
]);
const TERMINAL_AGENT_EVENTS = new Set(['AGENT_COMPLETED', 'AGENT_BLOCKED', 'AGENT_FAILED']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value, field) {
  if (value !== null && value !== undefined && (typeof value !== 'string' || value.length === 0)) throw new Error(`Activity ${field} must be a non-empty string or null`);
  return value ?? null;
}

function boundedString(value, field, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`Activity ${field} must be a non-empty string up to ${max} characters`);
  return value;
}

function validateMetadata(value) {
  if (!plainObject(value)) throw new Error('Activity metadata must be an object');
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 8 * 1024) throw new Error('Activity metadata exceeds 8192 bytes');
  return structuredClone(value);
}

/** Creates the closed, runtime-owned ActivityEvent v1 schema. */
export function createActivityEvent(input) {
  if (!plainObject(input)) throw new Error('Activity event must be an object');
  for (const key of Object.keys(input)) if (!EVENT_FIELDS.has(key)) throw new Error(`Unknown activity event field: ${key}`);
  const event = {
    schema_version: input.schema_version ?? ACTIVITY_SCHEMA_VERSION,
    event_id: input.event_id ?? randomUUID(),
    event_type: input.event_type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    workflow_id: input.workflow_id,
    session_id: input.session_id ?? null,
    agent_role: input.agent_role ?? null,
    agent_instance_id: input.agent_instance_id ?? null,
    parent_agent_role: input.parent_agent_role ?? null,
    parent_session_id: input.parent_session_id ?? null,
    delegation_id: input.delegation_id ?? null,
    task_id: input.task_id ?? null,
    work_item_id: input.work_item_id ?? null,
    effect_request_id: input.effect_request_id ?? null,
    status: input.status,
    summary: input.summary ?? `${input.event_type ?? 'ACTIVITY'} announced by runtime`,
    metadata: input.metadata ?? {},
  };
  if (event.schema_version !== ACTIVITY_SCHEMA_VERSION) throw new Error(`Unsupported activity schema_version: ${event.schema_version}`);
  if (!UUID_REGEX.test(event.event_id)) throw new Error('Activity event_id must be a UUID');
  if (!ACTIVITY_EVENT_TYPES.includes(event.event_type)) throw new Error(`Unknown activity event_type: ${event.event_type}`);
  if (!ISO8601_REGEX.test(event.timestamp)) throw new Error('Activity timestamp must be ISO-8601 UTC');
  boundedString(event.workflow_id, 'workflow_id', 256);
  for (const field of ['session_id', 'agent_instance_id', 'parent_session_id', 'delegation_id', 'task_id', 'work_item_id', 'effect_request_id']) nullableString(event[field], field);
  for (const field of ['agent_role', 'parent_agent_role']) {
    nullableString(event[field], field);
    if (event[field] !== null && !Object.hasOwn(AGENT_DISPLAY_METADATA, event[field])) throw new Error(`Unknown activity ${field}: ${event[field]}`);
  }
  boundedString(event.status, 'status', 64);
  boundedString(event.summary, 'summary');
  event.metadata = validateMetadata(event.metadata);
  return event;
}

export function activityStorePath(projectDir) {
  return resolve(projectDir, '.opencode', 'activity');
}

function eventsDirectory(storePath) {
  return resolve(storePath, 'events');
}

function eventFiles(storePath) {
  const directory = eventsDirectory(storePath);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
}

function readStoredEvents(storePath) {
  const directory = eventsDirectory(storePath);
  const records = [];
  let malformed_records = 0;
  for (const file of eventFiles(storePath)) {
    try {
      records.push({ file, event: createActivityEvent(JSON.parse(readFileSync(join(directory, file), 'utf8'))) });
    } catch {
      // An interrupted write or external damage must not make the operational view unavailable.
      malformed_records += 1;
    }
  }
  records.sort((left, right) => left.event.timestamp.localeCompare(right.event.timestamp) || left.file.localeCompare(right.file));
  return { events: records.map((record) => record.event), malformed_records };
}

function retainBounded(storePath, maxEvents) {
  const files = eventFiles(storePath);
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Activity retention must be a positive integer');
  if (files.length <= maxEvents) return;
  const records = files.map((file) => {
    try {
      return { file, event: createActivityEvent(JSON.parse(readFileSync(join(eventsDirectory(storePath), file), 'utf8'))) };
    } catch {
      return { file, event: null };
    }
  }).sort((left, right) => {
    if (left.event === null) return -1;
    if (right.event === null) return 1;
    return left.event.timestamp.localeCompare(right.event.timestamp) || left.event.event_id.localeCompare(right.event.event_id);
  });
  for (const record of records.slice(0, records.length - maxEvents)) unlinkSync(join(eventsDirectory(storePath), record.file));
}

/** Atomically persist one record; each event gets an immutable file so appends never rewrite a prior event. */
export function appendActivityEvent(storePath, event, { max_events = DEFAULT_ACTIVITY_RETENTION } = {}) {
  const validated = createActivityEvent(event);
  const directory = eventsDirectory(storePath);
  mkdirSync(directory, { recursive: true });
  // hrtime is only a storage ordering aid; timestamp remains the portable schema field.
  const stem = `${validated.timestamp.replace(/[:.]/g, '-')}-${process.hrtime.bigint().toString().padStart(20, '0')}-${validated.event_id}`;
  const target = join(directory, `${stem}.json`);
  const temporary = join(directory, `.${stem}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(validated)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, target);
  retainBounded(storePath, max_events);
  return validated;
}

export function readActivityEvents(storePath) {
  return readStoredEvents(storePath);
}

function latestByAgent(events, predicate) {
  const latest = new Map();
  for (const event of events.filter(predicate)) {
    const key = event.agent_instance_id || `${event.agent_role}:${event.session_id || 'unknown'}`;
    latest.set(key, event);
  }
  return [...latest.values()].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function deriveActiveAgents(events) {
  return latestByAgent(events, (event) => event.agent_role !== null && ['AGENT_STARTED', ...TERMINAL_AGENT_EVENTS].includes(event.event_type))
    .filter((event) => event.event_type === 'AGENT_STARTED');
}

export function deriveRecentlyCompletedAgents(events) {
  return latestByAgent(events, (event) => event.agent_role !== null && ['AGENT_STARTED', ...TERMINAL_AGENT_EVENTS].includes(event.event_type))
    .filter((event) => event.event_type === 'AGENT_COMPLETED');
}

export function deriveWorkflowGraph(events) {
  const nodes = new Map();
  const delegations = new Map();
  for (const event of events) {
    if (event.agent_role && event.agent_instance_id) {
      const node = nodes.get(event.agent_instance_id) || { agent_instance_id: event.agent_instance_id, agent_role: event.agent_role, session_id: event.session_id, status: null };
      node.session_id ||= event.session_id;
      if (event.event_type === 'AGENT_STARTED') node.status = 'ACTIVE';
      if (event.event_type === 'AGENT_COMPLETED') node.status = 'COMPLETED';
      if (event.event_type === 'AGENT_BLOCKED') node.status = 'BLOCKED';
      if (event.event_type === 'AGENT_FAILED') node.status = 'FAILED';
      nodes.set(event.agent_instance_id, node);
    }
    if (event.delegation_id && event.event_type === 'DELEGATION_CREATED') {
      delegations.set(event.delegation_id, {
        delegation_id: event.delegation_id,
        parent_agent_role: event.parent_agent_role,
        parent_session_id: event.parent_session_id,
        child_agent_role: event.agent_role,
        child_agent_instance_id: event.agent_instance_id,
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...delegations.values()] };
}

function latestOutcome(events, started, complete, failed) {
  const matching = events.filter((event) => [started, complete, failed].includes(event.event_type));
  const last = matching.at(-1);
  return { status: last?.event_type === complete ? 'COMPLETED' : last?.event_type === failed ? 'FAILED' : last?.event_type === started ? 'STARTED' : 'NOT_RUN', event: last ?? null };
}

export function queryActivity(storePath, { workflow_id = null, limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Activity query limit must be a positive integer');
  const stored = readStoredEvents(storePath);
  const scoped = workflow_id === null ? stored.events : stored.events.filter((event) => event.workflow_id === workflow_id);
  const events = scoped.slice(-limit);
  const effectEvents = scoped.filter((event) => event.effect_request_id !== null);
  return {
    schema_version: ACTIVITY_SCHEMA_VERSION,
    events,
    malformed_records: stored.malformed_records,
    active_agents: deriveActiveAgents(scoped),
    recently_completed_agents: deriveRecentlyCompletedAgents(scoped),
    workflow_graph: deriveWorkflowGraph(scoped),
    effects: { events: effectEvents, event_types: effectEvents.map((event) => event.event_type) },
    verification: latestOutcome(scoped, 'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'VERIFICATION_FAILED'),
    review: latestOutcome(scoped, 'REVIEW_STARTED', 'REVIEW_ACCEPTED', 'REVIEW_REJECTED'),
  };
}

function permissionProperties(event) {
  return event?.properties ?? event?.data ?? null;
}

function approvalGranted(response) {
  return ['allow', 'always', 'once', 'approved', 'grant'].includes(String(response).toLowerCase());
}

/**
 * Translate only native OpenCode permission/tool transport events. The projector
 * intentionally ignores assistant text and never persists command output.
 */
export function createRuntimeActivityProjector(context) {
  if (!context) return () => {};
  const requests = new Map();
  const emit = (event_type, input = {}) => appendActivityEvent(context.store_path, createActivityEvent({
    workflow_id: context.workflow_id,
    session_id: input.session_id ?? context.session_id ?? null,
    agent_role: context.agent_role ?? null,
    agent_instance_id: context.agent_instance_id ?? null,
    parent_agent_role: context.parent_agent_role ?? null,
    parent_session_id: context.parent_session_id ?? null,
    delegation_id: context.delegation_id ?? null,
    task_id: context.task_id ?? null,
    work_item_id: context.work_item_id ?? null,
    event_type,
    status: input.status,
    summary: input.summary,
    effect_request_id: input.effect_request_id ?? null,
    metadata: input.metadata ?? {},
  }), { max_events: context.max_events ?? DEFAULT_ACTIVITY_RETENTION });
  return (event) => {
    const properties = permissionProperties(event);
    if (event?.type === 'permission.updated' && properties?.id && properties?.type) {
      const request = { id: properties.id, call_id: properties.callID ?? null, operation_class: properties.type, session_id: properties.sessionID ?? context.session_id ?? null };
      requests.set(request.id, request);
      const metadata = { runtime_source: 'permission.updated', operation_class: request.operation_class, operation_identity: request.id, permission_id: request.id, tool_call_id: request.call_id, requesting_role: context.agent_role ?? null, execution_owner: context.execution_owner ?? context.agent_role ?? null };
      emit('EFFECT_REQUESTED', { status: 'REQUESTED', session_id: request.session_id, effect_request_id: request.id, summary: `Native permission requested for ${request.operation_class}`, metadata });
      emit('EFFECT_CLASSIFIED', { status: 'CLASSIFIED', session_id: request.session_id, effect_request_id: request.id, summary: `Native permission classified as ${request.operation_class}`, metadata });
      emit('APPROVAL_REQUIRED', { status: 'REQUIRED', session_id: request.session_id, effect_request_id: request.id, summary: 'Native approval required', metadata });
      return;
    }
    if (event?.type === 'permission.replied' && properties?.permissionID) {
      const request = requests.get(properties.permissionID);
      if (!request) return;
      const metadata = { runtime_source: 'permission.replied', operation_class: request.operation_class, operation_identity: request.id, permission_id: request.id, tool_call_id: request.call_id, requesting_role: context.agent_role ?? null, execution_owner: context.execution_owner ?? context.agent_role ?? null, native_response: String(properties.response) };
      if (approvalGranted(properties.response)) emit('APPROVAL_GRANTED', { status: 'GRANTED', session_id: properties.sessionID ?? request.session_id, effect_request_id: request.id, summary: 'Native approval granted', metadata });
      else {
        emit('APPROVAL_REJECTED', { status: 'REJECTED', session_id: properties.sessionID ?? request.session_id, effect_request_id: request.id, summary: 'Native approval rejected', metadata });
        emit('EFFECT_DENIED', { status: 'DENIED', session_id: properties.sessionID ?? request.session_id, effect_request_id: request.id, summary: 'Native effect denied', metadata });
      }
      return;
    }
    const part = properties?.part;
    if (event?.type === 'message.part.updated' && part?.type === 'tool' && part.callID) {
      const request = [...requests.values()].find((candidate) => candidate.call_id === part.callID);
      if (!request) return;
      const metadata = { runtime_source: 'message.part.updated', operation_class: request.operation_class, operation_identity: request.id, permission_id: request.id, tool_call_id: request.call_id, requesting_role: context.agent_role ?? null, execution_owner: context.execution_owner ?? context.agent_role ?? null, tool: part.tool };
      if (part.state?.status === 'completed') emit('EFFECT_EXECUTED', { status: 'EXECUTED', session_id: part.sessionID ?? request.session_id, effect_request_id: request.id, summary: 'Native effect executed', metadata });
      if (part.state?.status === 'error') emit('EFFECT_DENIED', { status: 'DENIED', session_id: part.sessionID ?? request.session_id, effect_request_id: request.id, summary: 'Native effect failed or was denied', metadata });
    }
  };
}

export function createActivityExecutionContext(options, { projectDir, role }) {
  if (options.activity === false) return null;
  const workflow_id = options.workflow_id ?? options.workflowId ?? randomUUID();
  const parent_agent_role = options.parent_agent_role ?? options.parentAgentRole ?? null;
  const delegation_id = options.delegation_id ?? options.delegationId ?? (parent_agent_role ? randomUUID() : null);
  return {
    store_path: options.activity_store_path ?? options.activityStorePath ?? activityStorePath(projectDir),
    workflow_id,
    owns_workflow: options.workflow_id === undefined && options.workflowId === undefined,
    agent_role: role,
    agent_instance_id: options.agent_instance_id ?? options.agentInstanceId ?? randomUUID(),
    parent_agent_role,
    parent_session_id: options.parent_session_id ?? options.parentSessionId ?? null,
    delegation_id,
    task_id: options.task_id ?? options.taskId ?? null,
    work_item_id: options.work_item_id ?? options.workItemId ?? null,
    execution_owner: options.execution_owner ?? options.executionOwner ?? role,
    max_events: options.activity_max_events ?? options.activityMaxEvents ?? DEFAULT_ACTIVITY_RETENTION,
  };
}

export function announceActivity(context, event_type, { status, summary, session_id = null, metadata = {} } = {}) {
  if (!context) return null;
  return appendActivityEvent(context.store_path, createActivityEvent({
    event_type, workflow_id: context.workflow_id, session_id, agent_role: context.agent_role, agent_instance_id: context.agent_instance_id,
    parent_agent_role: context.parent_agent_role, parent_session_id: context.parent_session_id, delegation_id: context.delegation_id,
    task_id: context.task_id, work_item_id: context.work_item_id, status, summary: summary ?? `${event_type} announced by runtime`, metadata,
  }), { max_events: context.max_events });
}

export function startActivityExecution(context) {
  if (!context) return;
  if (context.owns_workflow) announceActivity(context, 'WORKFLOW_STARTED', { status: 'STARTED', summary: 'Workflow started by runtime' });
  if (context.delegation_id) {
    announceActivity(context, 'DELEGATION_CREATED', { status: 'CREATED', summary: `Delegation created for ${context.agent_role}` });
    announceActivity(context, 'DELEGATION_STARTED', { status: 'STARTED', summary: `Delegation started for ${context.agent_role}` });
  }
  announceActivity(context, 'AGENT_STARTED', { status: 'STARTED', summary: `${context.agent_role} started by runtime` });
  if (context.agent_role === 'verifier') announceActivity(context, 'VERIFICATION_STARTED', { status: 'STARTED', summary: 'Verifier invocation started by runtime' });
  if (context.agent_role === 'reviewer') announceActivity(context, 'REVIEW_STARTED', { status: 'STARTED', summary: 'Reviewer invocation started by runtime' });
  if (context.agent_role === 'judge') announceActivity(context, 'JUDGMENT_STARTED', { status: 'STARTED', summary: 'Judge invocation started by runtime' });
}

export function finishActivityExecution(context, { success, session_id = null, failure_classification = null } = {}) {
  if (!context) return;
  const metadata = failure_classification ? { failure_classification } : {};
  const terminal = success ? 'AGENT_COMPLETED' : 'AGENT_FAILED';
  announceActivity(context, terminal, { status: success ? 'COMPLETED' : 'FAILED', session_id, summary: `${context.agent_role} ${success ? 'completed' : 'failed'} by runtime`, metadata });
  if (context.agent_role === 'verifier') announceActivity(context, success ? 'VERIFICATION_COMPLETED' : 'VERIFICATION_FAILED', { status: success ? 'COMPLETED' : 'FAILED', session_id, summary: `Verifier ${success ? 'completed' : 'failed'} by runtime`, metadata });
  if (context.agent_role === 'judge' && success) announceActivity(context, 'JUDGMENT_COMPLETED', { status: 'COMPLETED', session_id, summary: 'Judge completed by runtime' });
  if (context.delegation_id) announceActivity(context, 'DELEGATION_RETURNED', { status: success ? 'COMPLETED' : 'FAILED', session_id, summary: `Delegation returned from ${context.agent_role}`, metadata });
  if (context.owns_workflow) announceActivity(context, success ? 'WORKFLOW_COMPLETED' : 'WORKFLOW_BLOCKED', { status: success ? 'COMPLETED' : 'BLOCKED', session_id, summary: `Workflow ${success ? 'completed' : 'blocked'} by runtime`, metadata });
}
