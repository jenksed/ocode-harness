import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import {
  AGENT_DISPLAY_METADATA,
  createActivityExecutionContext,
  createRuntimeActivityProjector,
  finishActivityExecution,
  startActivityExecution,
} from './activity.mjs';
import { createVerifiedOpenCodeEnvironment, runtimeIdentityExecutable } from './runtime-identity.mjs';

function properties(event) {
  return event?.properties ?? event?.data ?? null;
}

/** SDK subscriptions may expose GlobalEvent envelopes; the projector accepts either shape. */
export function unwrapOpenCodeRuntimeEvent(event) {
  return event?.payload?.type ? event.payload : event;
}

function sessionInfo(event) {
  const info = properties(event)?.info;
  return info && typeof info.id === 'string' ? info : null;
}

function sessionID(event) {
  const data = properties(event);
  return data?.sessionID ?? data?.part?.sessionID ?? data?.info?.sessionID ?? null;
}

/** A semantic role is accepted only when OpenCode supplied the configured agent identity. */
export function roleFromOpenCodeAgent(agent) {
  return typeof agent === 'string' && Object.hasOwn(AGENT_DISPLAY_METADATA, agent) ? agent : null;
}

function errorSummary(event) {
  const error = properties(event)?.error;
  if (typeof error?.message === 'string') return error.message.slice(0, 256);
  return 'OPENCODE_SESSION_ERROR';
}

/**
 * Project native OpenCode server transport into ActivityEvent v1. It deliberately
 * does not receive terminal output or assistant text. Subtask agent IDs and
 * session.parentID are the only sources used for delegation/role attribution.
 */
export function createInteractiveActivityCapture({ projectDir, activity }) {
  const sessions = new Map();
  const contexts = new Map();
  const projectors = new Map();
  const pendingDelegations = new Map();
  const taskDelegations = new Map();
  const unboundChildren = new Map();
  const terminalSessions = new Map();
  let rootSessionID = null;
  let rootStarted = false;

  const queue = (map, key, value) => {
    const entries = map.get(key) ?? [];
    entries.push(value);
    map.set(key, entries);
  };

  const rootContext = () => activity;

  const startRoot = (id) => {
    if (rootStarted) return;
    rootStarted = true;
    if (id) activity.session_id = id;
    startActivityExecution(activity);
    if (id) {
      contexts.set(id, activity);
      projectors.set(id, createRuntimeActivityProjector(activity));
    }
  };

  const startChild = (child, delegation) => {
    if (contexts.has(child.id)) return;
    const parent = contexts.get(child.parentID) ?? rootContext();
    const role = delegation.role;
    const context = createActivityExecutionContext({
      workflow_id: activity.workflow_id,
      activity_store_path: activity.store_path,
      agent_instance_id: child.id,
      session_id: child.id,
      parent_agent_role: parent.agent_role,
      parent_session_id: child.parentID,
      delegation_id: delegation.id,
      execution_owner: role,
      activity_max_events: activity.max_events,
    }, { projectDir, role });
    contexts.set(child.id, context);
    projectors.set(child.id, createRuntimeActivityProjector(context));
    startActivityExecution(context);
    const terminal = terminalSessions.get(child.id);
    if (terminal) finishChild(child.id, terminal);
    reconcile(child.id);
  };

  const finishChild = (id, terminal) => {
    const context = contexts.get(id);
    if (!context || context === activity || terminal.finished) return;
    terminal.finished = true;
    finishActivityExecution(context, {
      success: terminal.success,
      session_id: id,
      failure_classification: terminal.failure_classification,
    });
  };

  const removeUnboundChild = (parentID, childID) => {
    const children = unboundChildren.get(parentID);
    if (!children) return;
    const remaining = children.filter((child) => child.id !== childID);
    if (remaining.length) unboundChildren.set(parentID, remaining);
    else unboundChildren.delete(parentID);
  };

  // OpenCode 1.18.21 represents delegation as a native task-tool part, not a
  // subtask part. The structured state supplies both configured semantic role
  // and child session identity; prompt/description/output are never inspected.
  const registerTaskDelegation = (part) => {
    const input = part?.state?.input;
    const metadata = part?.state?.metadata;
    const role = roleFromOpenCodeAgent(input?.subagent_type);
    const childSessionID = metadata?.sessionId;
    const parentSessionID = metadata?.parentSessionId ?? part?.sessionID;
    if (!role || typeof childSessionID !== 'string' || typeof parentSessionID !== 'string' || typeof part?.id !== 'string') return;
    const delegation = { id: part.id, role, parent_session_id: parentSessionID };
    taskDelegations.set(childSessionID, delegation);
    const child = sessions.get(childSessionID);
    if (!child || child.parentID && child.parentID !== parentSessionID) return;
    removeUnboundChild(parentSessionID, childSessionID);
    startChild(child, delegation);
  };

  // A subtask part and child session are separate server events. Pair only the
  // current causal pair; if either side is ambiguous, retain no role rather
  // than guessing or corrupting a parallel graph.
  const reconcile = (parentID) => {
    if (parentID !== rootSessionID && !contexts.has(parentID)) return;
    const delegations = pendingDelegations.get(parentID) ?? [];
    const children = unboundChildren.get(parentID) ?? [];
    while (delegations.length === 1 && children.length === 1) {
      const delegation = delegations.shift();
      const child = children.shift();
      startChild(child, delegation);
    }
    if (delegations.length) pendingDelegations.set(parentID, delegations);
    else pendingDelegations.delete(parentID);
    if (children.length) unboundChildren.set(parentID, children);
    else unboundChildren.delete(parentID);
  };

  const registerSession = (info) => {
    sessions.set(info.id, info);
    if (!info.parentID && rootSessionID === null) {
      rootSessionID = info.id;
      startRoot(info.id);
      reconcile(info.id);
      return;
    }
    if (!info.parentID) return;
    const delegation = taskDelegations.get(info.id);
    if (delegation && delegation.parent_session_id === info.parentID) {
      startChild(info, delegation);
      return;
    }
    queue(unboundChildren, info.parentID, info);
    reconcile(info.parentID);
  };

  const projectToSession = (event) => {
    const id = sessionID(event);
    const projector = projectors.get(id) ?? (id === rootSessionID ? projectors.get(rootSessionID) : null);
    projector?.(event);
  };

  const project = (input) => {
    const event = unwrapOpenCodeRuntimeEvent(input);
    if (!event?.type) return;
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const info = sessionInfo(event);
      if (info) registerSession(info);
      return;
    }
    if (event.type === 'message.part.updated') {
      const part = properties(event)?.part;
      if (part?.type === 'tool' && part.tool === 'task') registerTaskDelegation(part);
      if (part?.type === 'subtask' && typeof part.sessionID === 'string' && typeof part.id === 'string') {
        const role = roleFromOpenCodeAgent(part.agent);
        if (role) {
          queue(pendingDelegations, part.sessionID, { id: part.id, role });
          reconcile(part.sessionID);
        }
      }
      projectToSession(event);
      return;
    }
    if (event.type === 'session.idle' || event.type === 'session.status' && properties(event)?.status?.type === 'idle') {
      const id = sessionID(event);
      if (!id) return;
      const terminal = terminalSessions.get(id) ?? { success: true, failure_classification: null, finished: false };
      terminalSessions.set(id, terminal);
      finishChild(id, terminal);
      return;
    }
    if (event.type === 'session.error') {
      const id = sessionID(event);
      if (!id) return;
      const terminal = terminalSessions.get(id) ?? { success: false, failure_classification: errorSummary(event), finished: false };
      terminal.success = false;
      terminal.failure_classification ??= errorSummary(event);
      terminalSessions.set(id, terminal);
      finishChild(id, terminal);
      return;
    }
    projectToSession(event);
  };

  return {
    project,
    ensureRootStarted: () => startRoot(rootSessionID),
    snapshot: () => ({ root_session_id: rootSessionID, root_started: rootStarted, sessions: [...sessions.values()] }),
  };
}

function applyServerEnvironment(environment, start) {
  const keys = Object.keys(environment ?? {}).filter((key) => key !== 'OPENCODE_CONFIG_CONTENT');
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = String(environment[key]);
  }
  return Promise.resolve().then(start).finally(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export function attachArguments(serverURL, projectDir, args = []) {
  // Arguments have already been classified by operator-arguments.mjs. This
  // remains deliberately mechanical so no operator intent can disappear here.
  return ['attach', serverURL, '--dir', projectDir, ...args];
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, error: null }));
  });
}

// OpenCode 1.18.21 treats --port=0 as its default 4096. Select an explicit
// loopback ephemeral port so an ordinary Ocode session does not contend with a
// separately running OpenCode server.
function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error('OPENCODE_INTERACTIVE_PORT_UNAVAILABLE')));
    });
  });
}

/**
 * Start the normal TUI against a local OpenCode server while a separate SDK
 * subscriber observes the same runtime transport. The parent never writes to
 * the active TUI after launch, preserving OpenCode's terminal ownership.
 */
export async function runInteractiveOpenCode(options) {
  const sdk = options.sdk ?? { createOpencodeClient, createOpencodeServer };
  const spawnProcess = options.spawnProcess ?? spawn;
  const serverRuntime = createVerifiedOpenCodeEnvironment(options.runtimeIdentity, options.env);
  const abort = new AbortController();
  let server = null;
  let streamTask = null;
  const capture = createInteractiveActivityCapture({ projectDir: options.projectDir, activity: options.activity });
  try {
    const port = options.port ?? await reserveLoopbackPort();
    server = await applyServerEnvironment(serverRuntime.environment, () => sdk.createOpencodeServer({
      hostname: '127.0.0.1', port, timeout: 15_000, config: options.config,
    }));
    const client = sdk.createOpencodeClient({ baseUrl: server.url, directory: options.projectDir });
    const subscription = await client.event.subscribe({ query: { directory: options.projectDir }, signal: abort.signal });
    streamTask = (async () => {
      try {
        for await (const event of subscription.stream) capture.project(event);
      } catch (error) {
        if (!abort.signal.aborted) options.onObserverError?.(error);
      }
    })();
    const child = spawnProcess(runtimeIdentityExecutable(options.runtimeIdentity), attachArguments(server.url, options.projectDir, options.args), {
      cwd: options.projectDir, env: options.env, stdio: 'inherit',
    });
    const result = await waitForChild(child);
    capture.ensureRootStarted();
    return result;
  } finally {
    // Even an attach/server startup failure is a real interrupted primary
    // workflow, so retain a truthful lifecycle pair rather than an orphaned
    // terminal event.
    capture.ensureRootStarted();
    abort.abort();
    await streamTask?.catch(() => {});
    server?.close();
    serverRuntime.cleanup();
  }
}
