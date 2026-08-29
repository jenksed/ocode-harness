import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadAgentContracts } from './agent-contract.mjs';
import {
  assertModelAvailable,
  BindingError,
  createExecutionResolution,
  loadBindingProfile,
  reconcileExecutionBinding,
  reconcileExecutionSubject,
  serializeOpenCodeRuntimeOverlay,
  splitModelReference,
  validateProfileCompleteness,
} from './opencode-integration.mjs';
import { appendRecord, createLedgerRecord } from './ledger.mjs';
import { generateRunId, generateTaskId } from './identity.mjs';
import { createModelTelemetry, MODEL_FAILURE_CLASSES } from './model-telemetry.mjs';
import { assertTaskCapsuleHandoff, renderTaskCapsuleDelegationContext } from './task-capsule.mjs';
import { runOpenCodeSdkSession } from './opencode-sdk-execution.mjs';
import {
  createActivityExecutionContext,
  createRuntimeActivityProjector,
  finishActivityExecution,
  startActivityExecution,
} from './activity.mjs';
import { createRuntimePermissionProjection, createValidationWrapperEnvironment } from './command-admission.mjs';
import { qualifyRuntimeIdentity, runtimeIdentityExecutable } from './runtime-identity.mjs';

function prepareLowInterruptionRuntime({ baseDir, projectDir, contracts, environment }) {
  const projection = createRuntimePermissionProjection({ contracts, projectDir, environment });
  let env = { ...environment };
  if (projection.validation_registry) {
    env = createValidationWrapperEnvironment({
      baseDir, projectDir, registry: projection.validation_registry, environment: env,
      executables: projection.validation_executables,
    });
  }
  return { ...projection, environment: env };
}

function applyRuntimePermissions(config, projectedAgents) {
  config.agent = { ...(config.agent ?? {}) };
  for (const [role, projected] of Object.entries(projectedAgents)) {
    config.agent[role] = { ...(config.agent[role] ?? {}), permission: { ...(config.agent[role]?.permission ?? {}), ...projected.permission } };
  }
  return config;
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 120_000,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: [command, ...args],
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    duration_ms: Date.now() - started,
    spawn_error: result.error?.message || null,
  };
}

function controlledOpenCodeExecutable(options = {}) {
  if (options.runtimeIdentity) return runtimeIdentityExecutable(options.runtimeIdentity);
  throw new Error('OCODE_RUNTIME_IDENTITY_REQUIRED: OpenCode execution requires a qualified absolute executable identity');
}

export function runOpenCodeStreaming(command, args, options = {}) {
  const started = Date.now();
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const maxBytes = options.maxBuffer || 8 * 1024 * 1024;
    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolveResult({ command:[command,...args], exit_code:exitCode, signal, stdout, stderr, duration_ms:Date.now()-started, spawn_error:spawnError, termination: timedOut ? 'PROCESS_TIMEOUT' : signal ? 'PROCESS_ERROR' : 'NORMAL_EXIT' });
    };
    child.stdout.on('data', (chunk) => { if (stdout.length < maxBytes) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < maxBytes) stderr += chunk; });
    child.once('error', (error) => finish(null, null, error.message));
    child.once('close', (code, signal) => finish(code, signal));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); }, options.timeout || 120_000);
  });
}

export function parseOpenCodeEvents(stdout) {
  const events = [];
  for (const line of stdout.split('\n').filter((value) => value.trim())) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // OpenCode JSON mode should be line-delimited JSON. Preserve failure evidence
      // in stdout without converting an unparsable line into invented runtime facts.
    }
  }
  return events;
}

/** Extract only assistant text parts from OpenCode JSONL transport events. */
export function extractAssistantModelOutput(events) {
  const parts = [];
  for (const event of events) {
    const part = event?.properties?.part || event?.part;
    const isAssistantText = event?.type === 'text' && part?.type === 'text'
      || part?.type === 'text' && (event?.type?.includes('message') || event?.properties?.message?.role === 'assistant' || event?.role === 'assistant');
    if (isAssistantText && typeof part.text === 'string') parts.push(part.text);
    if (event?.role === 'assistant' && typeof event.text === 'string') parts.push(event.text);
  }
  return parts.length ? parts.join('') : null;
}

/** Extract a usable final assistant text from an already-sanitized export. */
export function extractAssistantModelOutputFromExport(exported) {
  if (!exported || !Array.isArray(exported.messages)) return null;
  const values = [];
  for (const message of exported.messages) {
    if (message?.info?.role !== 'assistant') continue;
    for (const part of message.parts || []) {
      if (part?.type !== 'text' || typeof part.text !== 'string') continue;
      if (/^\[redacted:text:[^\]]+\]$/.test(part.text)) continue;
      values.push(part.text);
    }
  }
  return values.length ? values.at(-1) : null;
}

export function resolveAssistantModelOutput({ events, exported }) {
  return extractAssistantModelOutput(events) || extractAssistantModelOutputFromExport(exported);
}

function parseExport(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

export function discoverProviderModels(provider, options = {}) {
  const cache = options.cache;
  if (cache?.has(provider)) return cache.get(provider);
  const result = run(controlledOpenCodeExecutable(options), ['models', provider], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    timeout: options.timeout || 30_000,
  });
  if (result.spawn_error || result.signal || result.exit_code !== 0) {
    throw new BindingError(`Could not discover OpenCode models for provider ${provider}`, {
      provider,
      fallback: 'deny',
      problem: result.spawn_error || result.signal || `exit ${result.exit_code}`,
    });
  }
  const models = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${provider}/`));
  if (models.length === 0) {
    throw new BindingError(`OpenCode reported no models for provider ${provider}`, {
      provider,
      fallback: 'deny',
    });
  }
  if (cache) cache.set(provider, models);
  return models;
}

export function validateResolutionAvailability(resolution, options = {}) {
  const { provider } = splitModelReference(resolution.execution_policy.requested_model);
  const models = options.models || discoverProviderModels(provider, options);
  return assertModelAvailable(resolution, models);
}

export function validateProfileAvailability(profile, options = {}) {
  const cache = options.cache || new Map();
  for (const [role, model] of Object.entries(profile.bindings)) {
    const { provider } = splitModelReference(model, `Binding for ${role}`);
    const resolution = {
      subject: { role },
      execution_policy: { profile: profile.name, requested_model: model },
    };
    assertModelAvailable(resolution, discoverProviderModels(provider, { ...options, cache }));
  }
  return profile;
}

export function createExecutionProvenance({ resolution, reconciliation, subjectReconciliation, success, failureClassification }) {
  const subject = subjectReconciliation || {
    admitted_subject: resolution.subject.role,
    effective_subject: null,
    state: 'UNKNOWN',
    reason_code: 'SUBJECT_UNKNOWN',
  };
  return {
    schema_version: 1,
    subject: structuredClone(resolution.subject),
    execution_policy: structuredClone(resolution.execution_policy),
    validation: structuredClone(resolution.validation),
    effective_model: reconciliation.effective,
    binding_reconciliation: reconciliation.state,
    admitted_subject: subject.admitted_subject,
    effective_subject: subject.effective_subject,
    subject_reconciliation: subject.state,
    subject_reason_code: subject.reason_code,
    success,
    failure_classification: failureClassification || null,
  };
}

export function appendExecutionLedgerRecord({ ledgerPath, projectDir, resolution, reconciliation, subjectReconciliation, success, failureClassification, elapsedMs, modelTelemetry = null, telemetryContext = null }) {
  const provenance = createExecutionProvenance({
    resolution,
    reconciliation,
    subjectReconciliation,
    success,
    failureClassification,
  });
  const taskID = generateTaskId();
  const runID = generateRunId();
  let retainedTelemetry = modelTelemetry;
  if (!retainedTelemetry && telemetryContext?.taskCapsule) {
    const classified = MODEL_FAILURE_CLASSES.includes(failureClassification) ? failureClassification : failureClassification ? 'UNKNOWN' : null;
    retainedTelemetry = createModelTelemetry({
      run_id: runID,
      task_capsule_fingerprint: telemetryContext.taskCapsule.fingerprint,
      role: resolution.subject.role,
      capability: telemetryContext.capability || 'role.execution',
      requested_model: resolution.execution_policy.requested_model,
      effective_model: reconciliation.effective,
      effective_model_status: reconciliation.effective ? 'KNOWN' : 'UNKNOWN',
      adapter_fingerprint: telemetryContext.adapter_fingerprint ?? null,
      qualification_identity_fingerprint: telemetryContext.qualification_identity_fingerprint ?? null,
      execution_profile: resolution.execution_policy.profile,
      outcome: success ? 'SUCCESS' : 'FAILURE',
      acceptance_result: telemetryContext.acceptance_result ?? 'UNRESOLVED',
      reviewer_verdict: telemetryContext.reviewer_verdict ?? 'NONE',
      repair_cycles: telemetryContext.repair_cycles ?? 0,
      validation_results: telemetryContext.validation_results ?? [],
      failure_classification: classified,
      failure_attribution: ['INFRASTRUCTURE_FAILURE', 'PROVIDER_FAILURE'].includes(classified) ? 'NON_MODEL' : 'UNATTRIBUTED',
      elapsed_ms: elapsedMs,
      token_count: null,
      cost: null,
    });
  }
  const record = createLedgerRecord({
    task_id: taskID,
    run_id: runID,
    project_name: projectDir.split('/').filter(Boolean).at(-1) || 'unknown',
    project_root: projectDir,
    workflow: 'QUICK',
    status: success ? 'COMPLETE' : 'FAILED',
    agents_used: [resolution.subject.role],
    elapsed_ms: elapsedMs,
    infrastructure_failures: failureClassification === 'INFRASTRUCTURE_FAILURE'
      ? [{ role: resolution.subject.role, requested_model: resolution.execution_policy.requested_model }]
      : [],
    execution_provenance: provenance,
    model_telemetry: retainedTelemetry,
  });
  appendRecord(ledgerPath, record);
  return record;
}

export function serializeGovernedExecutionOverlay(profile, role, existingConfigContent) {
  const overlay = JSON.parse(serializeOpenCodeRuntimeOverlay(profile, existingConfigContent));
  // OpenCode 1.18.21 accepts --agent for primary agents only. Direct bounded
  // execution promotes only the selected role in this ephemeral overlay.
  overlay.agent[role].mode = 'primary';
  return JSON.stringify(overlay);
}

export function evaluateGovernedExecutionAcceptance({ runtimeSucceeded, reconciliation, subjectReconciliation }) {
  const success = runtimeSucceeded
    && reconciliation.state === 'MATCH'
    && subjectReconciliation.state === 'MATCH';
  const failureClassification = subjectReconciliation.state === 'MISMATCH'
    ? 'SUBJECT_MISMATCH'
    : reconciliation.state === 'MISMATCH'
      ? 'BINDING_MISMATCH'
      : runtimeSucceeded
        ? (subjectReconciliation.state === 'UNKNOWN'
          ? 'SUBJECT_UNVERIFIED'
          : reconciliation.state === 'UNKNOWN' ? 'INFRASTRUCTURE_FAILURE' : null)
        : 'INFRASTRUCTURE_FAILURE';
  return { success, failure_classification: failureClassification };
}

export function admittedSubjectForExecution(resolution, admissionDecision = null) {
  if (admissionDecision === null) {
    throw new BindingError('Governed execution requires an AdmissionDecision');
  }
  if (admissionDecision.decision !== 'ALLOW') {
    throw new BindingError('Governed execution requires an allowed AdmissionDecision');
  }
  if (admissionDecision.subject?.role !== resolution.subject.role) {
    throw new BindingError('AdmissionDecision subject does not match governed execution role');
  }
  return admissionDecision.subject.role;
}

/** Bind a workflow role to the immutable TaskCapsule it was admitted to execute. */
export function bindTaskCapsuleToExecution({ taskCapsule, expectedTaskCapsuleFingerprint, role, required = false } = {}) {
  if (!taskCapsule) {
    if (required) throw new BindingError('Governed task execution requires a TaskCapsule');
    return null;
  }
  const capsule = assertTaskCapsuleHandoff(taskCapsule, expectedTaskCapsuleFingerprint || taskCapsule.fingerprint);
  if (typeof role !== 'string' || !role) throw new BindingError('TaskCapsule execution role is required');
  return capsule;
}

/**
 * A repository-aware capsule is valid only in the repository state it
 * snapshots. This binds the capsule's repository-relative paths to the one
 * authoritative runtime projectDir without embedding another absolute-root
 * copy in the portable capsule.
 */
export function assertTaskCapsuleProjectRoot(taskCapsule, projectDir) {
  if (!taskCapsule?.repository_context) return taskCapsule;
  const active = resolve(projectDir);
  const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: active, encoding: 'utf8' });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: active, encoding: 'utf8' });
  const expected = taskCapsule.repository_context.snapshot;
  if (topLevel.error || topLevel.status !== 0 || head.error || head.status !== 0 || head.stdout.trim() !== expected.head) {
    throw new BindingError(`OCODE_PROJECT_ROOT_MISMATCH: TaskCapsule repository snapshot does not match active project ${active}`, {
      project_root: active,
      expected_head: expected.head,
      actual_head: head.status === 0 ? head.stdout.trim() : null,
      problem: 'TaskCapsule repository context must execute in its captured project root',
    });
  }
  return taskCapsule;
}

/** New workflow entrypoint: requires the machine-valid TaskCapsule contract. */
export function executeGovernedTask(options) {
  const taskCapsule = bindTaskCapsuleToExecution({ taskCapsule: options.taskCapsule, expectedTaskCapsuleFingerprint: options.taskCapsuleFingerprint, role: options.role, required: true });
  if (typeof options.prompt !== 'string' || !options.prompt.trim()) throw new BindingError('Governed task execution requires a role assignment prompt');
  const prompt = `${renderTaskCapsuleDelegationContext(taskCapsule)}\n\n## ROLE ASSIGNMENT\n${options.prompt.trim()}`;
  return executeGovernedRole({ ...options, prompt, requireTaskCapsule: true });
}

export function executeGovernedRole(options) {
  if (options.transport === 'sdk') return executeGovernedRoleSdk(options);
  if (options.streaming === true) return executeGovernedRoleStreaming(options);
  const baseDir = resolve(options.baseDir);
  const projectDir = resolve(options.projectDir);
  const runtimeIdentity = options.runtimeIdentity ?? qualifyRuntimeIdentity({ releaseRoot: baseDir, environment: options.env || process.env });
  const opencode = controlledOpenCodeExecutable({ runtimeIdentity });
  const taskCapsule = assertTaskCapsuleProjectRoot(bindTaskCapsuleToExecution({ taskCapsule: options.taskCapsule, expectedTaskCapsuleFingerprint: options.taskCapsuleFingerprint, role: options.role, required: options.requireTaskCapsule === true }), projectDir);
  const { manifest, contracts } = loadAgentContracts({ baseDir });
  const loaded = options.profile
    ? { profile: options.profile, source: options.bindingSource || `profiles/${options.profile.name}.json` }
    : loadBindingProfile(options.profileName, {
        profilesDir: resolve(baseDir, 'profiles'),
        manifest,
      });
  validateProfileCompleteness(loaded.profile, manifest);
  const contract = contracts.get(options.role);
  const resolution = createExecutionResolution({
    role: options.role,
    contract,
    profile: loaded.profile,
    bindingSource: options.bindingSource || `profiles/${loaded.profile.name}.json`,
  });
  const admissionDecision = options.admissionDecision || null;
  const admittedSubject = admittedSubjectForExecution(resolution, admissionDecision);
  validateResolutionAvailability(resolution, {
    runtimeIdentity,
    cwd: projectDir,
    env: options.env || process.env,
    cache: options.catalogCache,
    models: options.models,
  });

  const runtime = prepareLowInterruptionRuntime({ baseDir, projectDir, contracts, environment: options.env || process.env });
  const overlayConfig = applyRuntimePermissions(JSON.parse(serializeGovernedExecutionOverlay(
    loaded.profile,
    options.role,
    (options.env || process.env).OPENCODE_CONFIG_CONTENT,
  )), runtime.agents);
  const overlay = JSON.stringify(overlayConfig);
  const args = ['run'];
  if (options.pure !== false) args.push('--pure');
  args.push(
    '--agent',
    options.role,
    '--format',
    'json',
    '--dir',
    projectDir,
    options.prompt,
  );
  const activity = createActivityExecutionContext(options, { projectDir, role: options.role });
  const projectRuntimeEvent = createRuntimeActivityProjector(activity);
  startActivityExecution(activity);
  const execution = run(opencode, args, {
    cwd: projectDir,
    env: { ...runtime.environment, OPENCODE_CONFIG_CONTENT: overlay },
    timeout: options.timeout || 120_000,
  });
  const events = parseOpenCodeEvents(execution.stdout);
  events.forEach(projectRuntimeEvent);
  let modelOutput = extractAssistantModelOutput(events);
  const sessionID = events.find((event) => event.sessionID)?.sessionID || null;
  let exported = null;
  let exportResult = null;
  if (sessionID) {
    exportResult = run(opencode, ['export', sessionID, '--sanitize'], {
      cwd: projectDir,
      env: runtime.environment,
      timeout: 30_000,
    });
    if (!exportResult.spawn_error && !exportResult.signal && exportResult.exit_code === 0) {
      exported = parseExport(exportResult.stdout);
    }
  }
  modelOutput = resolveAssistantModelOutput({ events, exported });
  const reconciliation = reconcileExecutionBinding(resolution, exported);
  const subjectReconciliation = reconcileExecutionSubject(admittedSubject, exported);
  const runtimeSucceeded = !execution.spawn_error && !execution.signal && execution.exit_code === 0;
  const acceptance = evaluateGovernedExecutionAcceptance({
    runtimeSucceeded,
    reconciliation,
    subjectReconciliation,
  });
  const { success, failure_classification: failureClassification } = acceptance;
  const ledgerPath = options.ledgerPath || resolve(projectDir, '.opencode', 'run-ledger.jsonl');
  const record = appendExecutionLedgerRecord({
    ledgerPath,
    projectDir,
    resolution,
    reconciliation,
    subjectReconciliation,
    success,
    failureClassification,
    elapsedMs: execution.duration_ms,
    telemetryContext: taskCapsule ? { taskCapsule, capability: options.capability, adapter_fingerprint: options.adapterFingerprint, qualification_identity_fingerprint: options.qualificationIdentityFingerprint, acceptance_result: options.acceptanceResult, reviewer_verdict: options.reviewerVerdict, repair_cycles: options.repairCycles, validation_results: options.validationResults } : null,
  });
  finishActivityExecution(activity, { success, session_id: sessionID, failure_classification: failureClassification });

  return {
    resolution,
    execution,
    events,
    model_output: modelOutput,
    session_id: sessionID,
    exported,
    export_result: exportResult,
    reconciliation,
    subject_reconciliation: subjectReconciliation,
    admitted_subject: admittedSubject,
    admission_decision: admissionDecision,
    success,
    failure_classification: failureClassification,
    ledger_record: record,
    runtime_identity: runtimeIdentity,
  };
}

/** Execute a governed assignment through OpenCode's authoritative session API. */
export async function executeGovernedRoleSdk(options) {
  const baseDir = resolve(options.baseDir);
  const projectDir = resolve(options.projectDir);
  const runtimeIdentity = options.runtimeIdentity ?? qualifyRuntimeIdentity({ releaseRoot: baseDir, environment: options.env || process.env });
  const taskCapsule = assertTaskCapsuleProjectRoot(bindTaskCapsuleToExecution({ taskCapsule: options.taskCapsule, expectedTaskCapsuleFingerprint: options.taskCapsuleFingerprint, role: options.role, required: options.requireTaskCapsule === true }), projectDir);
  const { manifest, contracts } = loadAgentContracts({ baseDir });
  const loaded = options.profile
    ? { profile: options.profile, source: options.bindingSource || `profiles/${options.profile.name}.json` }
    : loadBindingProfile(options.profileName, { profilesDir: resolve(baseDir, 'profiles'), manifest });
  validateProfileCompleteness(loaded.profile, manifest);
  const contract = contracts.get(options.role);
  const resolution = createExecutionResolution({
    role: options.role,
    contract,
    profile: loaded.profile,
    bindingSource: options.bindingSource || `profiles/${loaded.profile.name}.json`,
  });
  const admissionDecision = options.admissionDecision || null;
  const admittedSubject = admittedSubjectForExecution(resolution, admissionDecision);
  validateResolutionAvailability(resolution, {
    runtimeIdentity,
    cwd: projectDir,
    env: options.env || process.env,
    cache: options.catalogCache,
    models: options.models,
  });

  const runtime = prepareLowInterruptionRuntime({ baseDir, projectDir, contracts, environment: options.env || process.env });
  const config = applyRuntimePermissions(JSON.parse(serializeGovernedExecutionOverlay(
    loaded.profile,
    options.role,
    (options.env || process.env).OPENCODE_CONFIG_CONTENT,
  )), runtime.agents);
  const { provider, model } = splitModelReference(resolution.execution_policy.requested_model);
  const activity = createActivityExecutionContext(options, { projectDir, role: options.role });
  const projectRuntimeEvent = createRuntimeActivityProjector(activity);
  startActivityExecution(activity);
  const execution = await runOpenCodeSdkSession({
    projectDir,
    role: options.role,
    providerID: provider,
    modelID: model,
    prompt: options.prompt,
    config,
    env: runtime.environment,
    runtimeIdentity,
    timeout: options.timeout || 120_000,
    tools: options.sdkTools,
    sdk: options.sdk,
    title: options.title,
    methodEvidenceGate: options.methodEvidenceGate,
    onRuntimeEvent: projectRuntimeEvent,
  });
  const observed = execution.effective_identity?.provider_id
    || execution.effective_identity?.model_id
    || execution.effective_identity?.agent
    ? {
        info: {
          model: {
            providerID: execution.effective_identity.provider_id,
            id: execution.effective_identity.model_id,
          },
          agent: execution.effective_identity.agent,
        },
      }
    : null;
  const reconciliation = reconcileExecutionBinding(resolution, observed);
  const subjectReconciliation = reconcileExecutionSubject(admittedSubject, observed);
  const runtimeSucceeded = (execution.termination === 'SESSION_IDLE' || execution.termination === 'METHOD_PROVEN_SESSION_STOPPED')
    && execution.exit_code === 0
    && execution.completion_source !== null;
  const acceptance = evaluateGovernedExecutionAcceptance({
    runtimeSucceeded,
    reconciliation,
    subjectReconciliation,
  });
  const sdkFailureClassification = !acceptance.success && /(?:APIError|PROVIDER|chat\/completions|statusCode[^0-9]{0,12}(?:401|403|429|5\d\d))/i.test(execution.spawn_error ?? '')
    ? 'PROVIDER_FAILURE'
    : acceptance.failure_classification;
  const ledgerPath = options.ledgerPath || resolve(projectDir, '.opencode', 'run-ledger.jsonl');
  const record = appendExecutionLedgerRecord({
    ledgerPath,
    projectDir,
    resolution,
    reconciliation,
    subjectReconciliation,
    success: acceptance.success,
    failureClassification: sdkFailureClassification,
    elapsedMs: execution.duration_ms,
    telemetryContext: taskCapsule ? { taskCapsule, capability: options.capability, adapter_fingerprint: options.adapterFingerprint, qualification_identity_fingerprint: options.qualificationIdentityFingerprint, acceptance_result: options.acceptanceResult, reviewer_verdict: options.reviewerVerdict, repair_cycles: options.repairCycles, validation_results: options.validationResults } : null,
  });
  finishActivityExecution(activity, {
    success: acceptance.success,
    session_id: execution.session_id,
    failure_classification: sdkFailureClassification,
  });
  return {
    resolution,
    execution,
    events: execution.events,
    model_output: execution.model_output,
    session_id: execution.session_id,
    exported: null,
    export_result: null,
    session_messages: execution.messages,
    reconciliation,
    subject_reconciliation: subjectReconciliation,
    admitted_subject: admittedSubject,
    admission_decision: admissionDecision,
    success: acceptance.success,
    failure_classification: sdkFailureClassification,
    ledger_record: record,
    transport: 'OPENCODE_SDK',
    completion_source: execution.completion_source,
    runtime_identity: runtimeIdentity,
  };
}

export async function executeGovernedRoleStreaming(options) {
  const baseDir = resolve(options.baseDir), projectDir = resolve(options.projectDir);
  const runtimeIdentity = options.runtimeIdentity ?? qualifyRuntimeIdentity({ releaseRoot: baseDir, environment: options.env || process.env });
  const opencode = controlledOpenCodeExecutable({ runtimeIdentity });
  const taskCapsule = assertTaskCapsuleProjectRoot(bindTaskCapsuleToExecution({ taskCapsule: options.taskCapsule, expectedTaskCapsuleFingerprint: options.taskCapsuleFingerprint, role: options.role, required: options.requireTaskCapsule === true }), projectDir);
  const { manifest, contracts } = loadAgentContracts({ baseDir });
  const loaded = options.profile ? { profile: options.profile, source: options.bindingSource || `profiles/${options.profile.name}.json` } : loadBindingProfile(options.profileName, { profilesDir: resolve(baseDir, 'profiles'), manifest });
  validateProfileCompleteness(loaded.profile, manifest);
  const contract = contracts.get(options.role);
  const resolution = createExecutionResolution({ role: options.role, contract, profile: loaded.profile, bindingSource: options.bindingSource || `profiles/${loaded.profile.name}.json` });
  const admittedSubject = admittedSubjectForExecution(resolution, options.admissionDecision || null);
  validateResolutionAvailability(resolution, { runtimeIdentity, cwd: projectDir, env: options.env || process.env, cache: options.catalogCache, models: options.models });
  const runtime = prepareLowInterruptionRuntime({ baseDir, projectDir, contracts, environment: options.env || process.env });
  const overlay = JSON.stringify(applyRuntimePermissions(JSON.parse(serializeGovernedExecutionOverlay(loaded.profile, options.role, (options.env || process.env).OPENCODE_CONFIG_CONTENT)), runtime.agents));
  const args=['run']; if(options.pure!==false)args.push('--pure'); args.push('--agent',options.role,'--format','json','--dir',projectDir,options.prompt);
  const activity = createActivityExecutionContext(options, { projectDir, role: options.role });
  const projectRuntimeEvent = createRuntimeActivityProjector(activity);
  startActivityExecution(activity);
  const execution = await runOpenCodeStreaming(opencode, args, { cwd:projectDir, env:{...runtime.environment,OPENCODE_CONFIG_CONTENT:overlay}, timeout:options.timeout||120000 });
  const events=parseOpenCodeEvents(execution.stdout);
  events.forEach(projectRuntimeEvent);
  const sessionID=events.find((event)=>event.sessionID)?.sessionID||null;
  let exported=null, exportResult=null;
  if(sessionID){ exportResult=run(opencode,['export',sessionID,'--sanitize'],{cwd:projectDir,env:runtime.environment,timeout:30000}); if(!exportResult.spawn_error&&!exportResult.signal&&exportResult.exit_code===0)exported=parseExport(exportResult.stdout); }
  const reconciliation=reconcileExecutionBinding(resolution,exported), subjectReconciliation=reconcileExecutionSubject(admittedSubject,exported);
  const runtimeSucceeded=execution.termination==='NORMAL_EXIT'&&execution.exit_code===0;
  const acceptance=evaluateGovernedExecutionAcceptance({runtimeSucceeded,reconciliation,subjectReconciliation});
  const ledgerPath=options.ledgerPath||resolve(projectDir,'.opencode','run-ledger.jsonl');
  const record=appendExecutionLedgerRecord({ledgerPath,projectDir,resolution,reconciliation,subjectReconciliation,success:acceptance.success,failureClassification:acceptance.failure_classification,elapsedMs:execution.duration_ms,telemetryContext:taskCapsule?{taskCapsule,capability:options.capability,adapter_fingerprint:options.adapterFingerprint,qualification_identity_fingerprint:options.qualificationIdentityFingerprint,acceptance_result:options.acceptanceResult,reviewer_verdict:options.reviewerVerdict,repair_cycles:options.repairCycles,validation_results:options.validationResults}:null});
  finishActivityExecution(activity, { success: acceptance.success, session_id: sessionID, failure_classification: acceptance.failure_classification });
  return {resolution,execution,events,model_output:resolveAssistantModelOutput({events,exported}),session_id:sessionID,exported,export_result:exportResult,reconciliation,subject_reconciliation:subjectReconciliation,admitted_subject:admittedSubject,admission_decision:options.admissionDecision||null,success:acceptance.success,failure_classification:acceptance.failure_classification,ledger_record:record,runtime_identity:runtimeIdentity};
}
