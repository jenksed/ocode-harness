import { spawnSync } from 'node:child_process';
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
  const result = run(options.opencode || 'opencode', ['models', provider], {
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

export function appendExecutionLedgerRecord({ ledgerPath, projectDir, resolution, reconciliation, subjectReconciliation, success, failureClassification, elapsedMs }) {
  const provenance = createExecutionProvenance({
    resolution,
    reconciliation,
    subjectReconciliation,
    success,
    failureClassification,
  });
  const record = createLedgerRecord({
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

export function executeGovernedRole(options) {
  const baseDir = resolve(options.baseDir);
  const projectDir = resolve(options.projectDir);
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
    opencode: options.opencode,
    cwd: projectDir,
    env: options.env || process.env,
    cache: options.catalogCache,
    models: options.models,
  });

  const overlay = serializeGovernedExecutionOverlay(
    loaded.profile,
    options.role,
    (options.env || process.env).OPENCODE_CONFIG_CONTENT,
  );
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
  const execution = run(options.opencode || 'opencode', args, {
    cwd: projectDir,
    env: { ...(options.env || process.env), OPENCODE_CONFIG_CONTENT: overlay },
    timeout: options.timeout || 120_000,
  });
  const events = parseOpenCodeEvents(execution.stdout);
  const modelOutput = extractAssistantModelOutput(events);
  const sessionID = events.find((event) => event.sessionID)?.sessionID || null;
  let exported = null;
  let exportResult = null;
  if (sessionID) {
    exportResult = run(options.opencode || 'opencode', ['export', sessionID, '--sanitize'], {
      cwd: projectDir,
      env: options.env || process.env,
      timeout: 30_000,
    });
    if (!exportResult.spawn_error && !exportResult.signal && exportResult.exit_code === 0) {
      exported = parseExport(exportResult.stdout);
    }
  }
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
  });

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
  };
}
