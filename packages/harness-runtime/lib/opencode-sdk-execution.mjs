import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import { createVerifiedOpenCodeEnvironment } from './runtime-identity.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

function responseData(response, label) {
  if (response?.error) throw new Error(`${label}: ${JSON.stringify(response.error)}`);
  return response?.data;
}

function eventProperties(event) {
  return event?.properties ?? event?.data ?? null;
}

function eventSessionID(event) {
  const properties = eventProperties(event);
  return properties?.sessionID ?? properties?.part?.sessionID ?? properties?.info?.sessionID ?? null;
}

function isSessionIdle(event, sessionID) {
  if (eventSessionID(event) !== sessionID) return false;
  const properties = eventProperties(event);
  return event?.type === 'session.idle'
    || event?.type === 'session.status' && properties?.status?.type === 'idle';
}

function isSessionError(event, sessionID) {
  return event?.type === 'session.error' && eventSessionID(event) === sessionID;
}

/** Preserve SDK events while translating message parts to the established runtime shape. */
export function normalizeOpenCodeSdkEvent(event) {
  const properties = eventProperties(event);
  const part = properties?.part;
  if (event?.type === 'message.part.updated' && part?.type === 'tool') {
    return { type: 'tool_use', sessionID: part.sessionID ?? properties?.sessionID ?? null, part };
  }
  if (event?.type === 'message.part.updated' && part?.type === 'text') {
    return { type: 'text', sessionID: part.sessionID ?? properties?.sessionID ?? null, part };
  }
  return structuredClone(event);
}

export function extractAssistantOutputFromMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const assistant = messages.filter((message) => message?.info?.role === 'assistant').at(-1);
  if (!assistant) return null;
  const text = (assistant.parts ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string' && !part.ignored)
    .map((part) => part.text)
    .join('');
  return text || null;
}

export function sdkExecutionIdentity(messages) {
  const assistant = Array.isArray(messages)
    ? messages.filter((message) => message?.info?.role === 'assistant').at(-1)
    : null;
  const info = assistant?.info;
  return {
    provider_id: typeof info?.providerID === 'string' ? info.providerID : null,
    model_id: typeof info?.modelID === 'string' ? info.modelID : null,
    agent: typeof info?.agent === 'string' ? info.agent : null,
  };
}

function applySpawnEnvironment(environment, start) {
  const keys = Object.keys(environment ?? {}).filter((key) => key !== 'OPENCODE_CONFIG_CONTENT');
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve().then(start).finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/**
 * Execute one OpenCode turn through the installed server/session contract.
 * The event subscription is active before prompt submission and only a matching
 * session idle state can complete the turn.
 */
export async function runOpenCodeSdkSession(options) {
  const started = Date.now();
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const sdk = options.sdk ?? { createOpencodeClient, createOpencodeServer };
  const serverRuntime = createVerifiedOpenCodeEnvironment(options.runtimeIdentity, options.env);
  const abort = new AbortController();
  let server = null;
  let client = null;
  let sessionID = null;
  let promptAccepted = false;
  let promptSubmissions = 0;
  let completionSource = null;
  let methodCompletion = null;
  let methodEvidence = null;
  let controlledStopStarted = false;
  let cleanupComplete = false;
  const sdkEvents = [];
  const normalizedEvents = [];
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const timeout = setTimeout(() => rejectCompletion(new Error('OPENCODE_SDK_SESSION_TIMEOUT')), timeoutMs);

  try {
    server = await applySpawnEnvironment(serverRuntime.environment, () => sdk.createOpencodeServer({
      hostname: '127.0.0.1',
      port: 0,
      timeout: Math.min(timeoutMs, 15_000),
      config: options.config,
    }));
    client = sdk.createOpencodeClient({ baseUrl: server.url, directory: options.projectDir });
    const subscription = await client.event.subscribe({
      query: { directory: options.projectDir },
      signal: abort.signal,
    });
    void (async () => {
      try {
        for await (const event of subscription.stream) {
          sdkEvents.push(structuredClone(event));
          // Qualification gates receive the same normalized history as before,
          // but normalization now occurs once per transport event rather than
          // once per event for every gate evaluation.
          normalizedEvents.push(normalizeOpenCodeSdkEvent(event));
          // Observability callbacks consume native transport events only. A
          // persistence failure must not alter the governed runtime outcome.
          try { await options.onRuntimeEvent?.(event); } catch { /* best-effort operational telemetry */ }
          if (!sessionID || eventSessionID(event) !== sessionID) continue;
          if (isSessionError(event, sessionID)) {
            rejectCompletion(new Error(`OPENCODE_SDK_SESSION_ERROR:${JSON.stringify(eventProperties(event)?.error ?? null)}`));
            return;
          }
          if (!controlledStopStarted && typeof options.methodEvidenceGate === 'function') {
            const evaluated = await options.methodEvidenceGate({
              event: normalizedEvents.at(-1),
              events: normalizedEvents,
              session_id: sessionID,
            });
            if (evaluated?.method_evidence_sufficient === true) {
              controlledStopStarted = true;
              methodEvidence = structuredClone(evaluated);
              await client.session.abort({ path: { id: sessionID }, query: { directory: options.projectDir } });
              methodCompletion = 'METHOD_PROVEN_SESSION_STOPPED';
              completionSource = 'METHOD_EVIDENCE_SUFFICIENT';
              resolveCompletion();
              return;
            }
          }
          if (promptAccepted && isSessionIdle(event, sessionID)) {
            completionSource = 'SESSION_IDLE_EVENT';
            resolveCompletion();
            return;
          }
        }
        if (!abort.signal.aborted) rejectCompletion(new Error('OPENCODE_SDK_EVENT_STREAM_ENDED'));
      } catch (error) {
        if (!abort.signal.aborted) rejectCompletion(error);
      }
    })();

    const created = responseData(await client.session.create({
      query: { directory: options.projectDir },
      body: { title: options.title ?? 'Ocode governed execution' },
    }), 'OPENCODE_SDK_SESSION_CREATE_FAILED');
    sessionID = created?.id ?? null;
    if (!sessionID) throw new Error('OPENCODE_SDK_SESSION_ID_MISSING');

    promptSubmissions += 1;
    responseData(await client.session.promptAsync({
      path: { id: sessionID },
      query: { directory: options.projectDir },
      body: {
        model: { providerID: options.providerID, modelID: options.modelID },
        agent: options.role,
        tools: options.tools,
        parts: [{ type: 'text', text: options.prompt }],
      },
    }), 'OPENCODE_SDK_PROMPT_FAILED');
    promptAccepted = true;

    const status = responseData(await client.session.status({
      query: { directory: options.projectDir },
    }), 'OPENCODE_SDK_STATUS_FAILED');
    if (status?.[sessionID]?.type === 'idle') {
      completionSource = 'SESSION_IDLE_QUERY';
      resolveCompletion();
    }
    await completion;

    const messages = responseData(await client.session.messages({
      path: { id: sessionID },
      query: { directory: options.projectDir },
    }), 'OPENCODE_SDK_MESSAGES_FAILED');
    const identity = sdkExecutionIdentity(messages);
    return {
      command: ['opencode-sdk', 'session.promptAsync'],
      transport: 'OPENCODE_SDK',
      termination: methodCompletion ?? 'SESSION_IDLE',
      completion_source: completionSource,
      exit_code: 0,
      signal: null,
      spawn_error: null,
      duration_ms: Date.now() - started,
      session_id: sessionID,
      events: sdkEvents.map(normalizeOpenCodeSdkEvent),
      sdk_events: sdkEvents,
      messages,
      model_output: extractAssistantOutputFromMessages(messages),
      effective_identity: identity,
      method_completion: methodCompletion,
      method_evidence: methodEvidence,
      prompt_submissions: promptSubmissions,
      cleanup: { subscription_aborted: true, server_closed: true },
    };
  } catch (error) {
    if (sessionID && client?.session?.abort) {
      try {
        await client.session.abort({ path: { id: sessionID }, query: { directory: options.projectDir } });
      } catch {
        // The server may already be unavailable; original failure remains authoritative.
      }
    }
    return {
      command: ['opencode-sdk', 'session.promptAsync'],
      transport: 'OPENCODE_SDK',
      termination: error?.message === 'OPENCODE_SDK_SESSION_TIMEOUT' ? 'PROCESS_TIMEOUT' : 'PROCESS_ERROR',
      completion_source: null,
      exit_code: null,
      signal: null,
      spawn_error: error?.message ?? String(error),
      duration_ms: Date.now() - started,
      session_id: sessionID,
      events: sdkEvents.map(normalizeOpenCodeSdkEvent),
      sdk_events: sdkEvents,
      messages: [],
      model_output: null,
      effective_identity: { provider_id: null, model_id: null, agent: null },
      method_completion: methodCompletion,
      method_evidence: methodEvidence,
      prompt_submissions: promptSubmissions,
      cleanup: { subscription_aborted: true, server_closed: true },
    };
  } finally {
    clearTimeout(timeout);
    abort.abort();
    try { server?.close(); } finally {
      serverRuntime.cleanup();
      cleanupComplete = true;
    }
    // Kept as an internal assertion so every returned result promises completed cleanup.
    if (!cleanupComplete) throw new Error('OPENCODE_SDK_CLEANUP_FAILED');
  }
}
