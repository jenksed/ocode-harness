#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  fingerprintBindingProfile,
  serializeOpenCodeRuntimeOverlay,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const agentID = 'ocode-m2-diagnostic';
const staticAgentID = 'ocode-m2-diagnostic-static';
const semanticContract = 'ocode.m2.diagnostic.v1';
const expectedResult = 'OCODE_M2_DIAGNOSTIC_OK';
const knownGoodVersion = '1.18.21';
const sourceAgent = join(
  repoRoot,
  'test',
  'fixtures',
  'opencode-integration',
  'agents',
  `${agentID}.md`,
);
const sourceStaticAgent = join(
  repoRoot,
  'test',
  'fixtures',
  'opencode-integration',
  'agents',
  `${staticAgentID}.md`,
);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotUserConfig() {
  const configDir = join(homedir(), '.config', 'opencode');
  const paths = ['config.json', 'opencode.json', 'opencode.jsonc'];
  return Object.fromEntries(
    paths.map((name) => {
      const path = join(configDir, name);
      return [name, existsSync(path) ? sha256File(path) : null];
    }),
  );
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 120_000,
  });

  return {
    command: [command, ...args].map(shellQuote).join(' '),
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    duration_ms: Date.now() - started,
    spawn_error: result.error?.message || null,
  };
}

function requireSuccess(result, label) {
  assert.equal(result.spawn_error, null, `${label} failed to spawn: ${result.spawn_error}`);
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}`);
  assert.equal(
    result.exit_code,
    0,
    `${label} failed (exit ${result.exit_code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function parseJSONEvents(stdout, label) {
  const events = stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  assert(events.length > 0, `${label} produced no JSON events`);
  return events;
}

function parseExport(result, label) {
  requireSuccess(result, label);
  const start = result.stdout.indexOf('{');
  assert(start >= 0, `${label} did not return a JSON document`);
  return JSON.parse(result.stdout.slice(start));
}

function discoverModels(provider) {
  const result = run('opencode', ['models', provider]);
  requireSuccess(result, `OpenCode ${provider} model discovery`);
  const models = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${provider}/`));
  assert(models.length > 0, `OpenCode reported no ${provider} models`);
  return { result, models };
}

function chooseFreeLLMAPIModel(models) {
  return models.find((model) => model === 'freellmapi/auto:smart')
    || models.find((model) => model.startsWith('freellmapi/auto:'))
    || models[0];
}

function chooseOpenAIModel(models) {
  return models.find((model) => model.includes('-mini') && !model.endsWith('-fast'))
    || models.find((model) => !model.endsWith('-fast'))
    || models[0];
}

function executeDiagnostic(projectDir, profile, expectedModel, observedVersion, selectedAgentID = agentID) {
  const overlay = serializeOpenCodeRuntimeOverlay(profile);
  const args = [
    'run',
    '--pure',
    '--agent',
    selectedAgentID,
    '--format',
    'json',
    '--dir',
    projectDir,
    'Return the diagnostic contract result.',
  ];
  const invocation = `OPENCODE_CONFIG_CONTENT=${shellQuote(overlay)} ${[
    'opencode',
    ...args,
  ].map(shellQuote).join(' ')}`;
  const result = run('opencode', args, {
    cwd: projectDir,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: overlay },
  });
  requireSuccess(result, `${expectedModel} diagnostic`);

  const events = parseJSONEvents(result.stdout, `${expectedModel} diagnostic`);
  assert.equal(events.some((event) => event.type === 'error'), false, 'Success stream contains an error event');
  const sessionID = events.find((event) => event.sessionID)?.sessionID;
  assert(sessionID, 'JSON stream did not expose a session identity');
  const finalText = events
    .filter((event) => event.type === 'text')
    .map((event) => event.part?.text || '')
    .join('')
    .trim();
  assert.equal(finalText, expectedResult, 'Diagnostic semantic result changed');

  const exportResult = run('opencode', ['export', sessionID, '--sanitize'], { cwd: projectDir });
  const exported = parseExport(exportResult, `${expectedModel} sanitized session export`);
  const [providerID, ...modelParts] = expectedModel.split('/');
  const modelID = modelParts.join('/');
  assert.equal(exported.info.version, observedVersion);
  assert.equal(exported.info.agent, selectedAgentID);
  assert.equal(exported.info.model.providerID, providerID);
  assert.equal(exported.info.model.id, modelID);
  assert.equal(exported.info.summary?.files || 0, 0, 'Read-only diagnostic changed files');

  return {
    invocation,
    exit_code: result.exit_code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    json_event_types: events.map((event) => event.type),
    session_id: sessionID,
    agent: exported.info.agent,
    requested_model: `${exported.info.model.providerID}/${exported.info.model.id}`,
    final_result: finalText,
    files_changed: exported.info.summary?.files || 0,
    duration_ms: result.duration_ms,
  };
}

function executeNegativeDiagnostic(projectDir) {
  const unavailableModel = 'ocode-m2-missing/no-model';
  const profile = {
    schema_version: 1,
    name: 'm2_negative',
    bindings: { [agentID]: unavailableModel },
  };
  const overlay = serializeOpenCodeRuntimeOverlay(profile);
  const args = [
    'run',
    '--pure',
    '--agent',
    agentID,
    '--format',
    'json',
    '--dir',
    projectDir,
    'Return the diagnostic contract result.',
  ];
  const invocation = `OPENCODE_CONFIG_CONTENT=${shellQuote(overlay)} ${[
    'opencode',
    ...args,
  ].map(shellQuote).join(' ')}`;
  const result = run('opencode', args, {
    cwd: projectDir,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: overlay },
    timeout: 30_000,
  });
  assert.equal(result.spawn_error, null, `Negative diagnostic failed to spawn: ${result.spawn_error}`);
  assert.equal(result.signal, null, `Negative diagnostic terminated by ${result.signal}`);
  assert.notEqual(result.exit_code, 0, 'Unavailable provider/model unexpectedly succeeded');
  const events = parseJSONEvents(result.stdout, 'Negative diagnostic');
  const error = events.find((event) => event.type === 'error');
  assert(error, 'Negative diagnostic did not emit a machine-readable error event');

  return {
    invocation,
    exit_code: result.exit_code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    json_event_types: events.map((event) => event.type),
    session_id: error.sessionID || null,
    requested_model: unavailableModel,
    error_name: error.error?.name || null,
    error_message: error.error?.data?.message || null,
    duration_ms: result.duration_ms,
  };
}

const temporaryProject = mkdtempSync(join(tmpdir(), 'ocode-m2-acceptance-'));
let failed = false;

try {
  console.log('=== Ocode M2 Acceptance ===\n');
  assert(existsSync(sourceAgent), `Missing diagnostic source fixture: ${sourceAgent}`);
  assert(existsSync(sourceStaticAgent), `Missing static diagnostic source fixture: ${sourceStaticAgent}`);
  const installedAgentDir = join(temporaryProject, '.opencode', 'agents');
  mkdirSync(installedAgentDir, { recursive: true });
  const installedAgent = join(installedAgentDir, `${agentID}.md`);
  const installedStaticAgent = join(installedAgentDir, `${staticAgentID}.md`);
  copyFileSync(sourceAgent, installedAgent);
  copyFileSync(sourceStaticAgent, installedStaticAgent);
  const gitInit = run('git', ['init', '-q'], { cwd: temporaryProject });
  requireSuccess(gitInit, 'Temporary diagnostic project initialization');

  const sourceHash = sha256File(sourceAgent);
  const installedHash = sha256File(installedAgent);
  const sourceStaticHash = sha256File(sourceStaticAgent);
  const installedStaticHash = sha256File(installedStaticAgent);
  assert.equal(installedHash, sourceHash, 'Diagnostic source/install fingerprint drift');
  assert.equal(installedStaticHash, sourceStaticHash, 'Static diagnostic source/install fingerprint drift');
  assert.equal(
    readFileSync(sourceAgent, 'utf8'),
    readFileSync(sourceStaticAgent, 'utf8').replace(/^model:.*\n/m, ''),
    'Static and model-neutral diagnostics do not share the same semantic contract',
  );

  const versionResult = run('opencode', ['--version']);
  requireSuccess(versionResult, 'OpenCode version check');
  const version = versionResult.stdout.trim();
  assert(version, 'OpenCode returned an empty version');

  const beforeConfig = snapshotUserConfig();
  const freeDiscovery = discoverModels('freellmapi');
  const openAIDiscovery = discoverModels('openai');
  const freeModel = chooseFreeLLMAPIModel(freeDiscovery.models);
  const openAIModel = chooseOpenAIModel(openAIDiscovery.models);

  const freeProfile = {
    schema_version: 1,
    name: 'm2_free',
    bindings: { [agentID]: freeModel },
  };
  const hybridProfile = {
    schema_version: 1,
    name: 'm2_openai',
    bindings: { [agentID]: openAIModel },
  };
  const staticOverrideProfile = {
    schema_version: 1,
    name: 'm2_static_override',
    bindings: { [staticAgentID]: openAIModel },
  };

  const freeProof = executeDiagnostic(temporaryProject, freeProfile, freeModel, version);
  const openAIProof = executeDiagnostic(temporaryProject, hybridProfile, openAIModel, version);
  const staticOverrideProof = executeDiagnostic(
    temporaryProject,
    staticOverrideProfile,
    openAIModel,
    version,
    staticAgentID,
  );
  const negativeProof = executeNegativeDiagnostic(temporaryProject);
  const afterConfig = snapshotUserConfig();
  assert.deepEqual(afterConfig, beforeConfig, 'OpenCode runtime overlay mutated user config files');

  const evidence = {
    status: 'M2_PROVEN',
    tested_runtime: {
      opencode_version: version,
      known_good_version: knownGoodVersion,
      matches_known_good: version === knownGoodVersion,
      platform: `${process.platform}/${process.arch}`,
    },
    diagnostic_agent: {
      id: agentID,
      semantic_contract: semanticContract,
      source_sha256: sourceHash,
      installed_sha256: installedHash,
      identity_match: true,
      static_override_fixture: {
        id: staticAgentID,
        source_sha256: sourceStaticHash,
        installed_sha256: installedStaticHash,
        semantic_body_matches_neutral: true,
        markdown_model: 'freellmapi/auto:smart',
      },
    },
    binding_strategy: 'DESIGN_C_RUNTIME_CONFIG_OVERLAY',
    profiles: {
      free_sha256: fingerprintBindingProfile(freeProfile),
      openai_sha256: fingerprintBindingProfile(hybridProfile),
    },
    model_discovery: {
      freellmapi_command: freeDiscovery.result.command,
      freellmapi_selected: freeModel,
      openai_command: openAIDiscovery.result.command,
      openai_selected: openAIModel,
    },
    freellmapi: freeProof,
    openai: openAIProof,
    static_markdown_override: staticOverrideProof,
    negative_path: negativeProof,
    user_config_preserved: true,
    plugins_disabled_during_execution: true,
    temporary_project: process.env.OCODE_M2_KEEP_TEMP === '1' ? temporaryProject : '(removed)',
  };

  console.log(JSON.stringify(evidence, null, 2));
  console.log('\n✓ M2 acceptance passed');
} catch (error) {
  failed = true;
  console.error(`\n✗ M2 acceptance failed: ${error.message}`);
  if (error.stack) console.error(error.stack);
} finally {
  if (process.env.OCODE_M2_KEEP_TEMP !== '1') {
    rmSync(temporaryProject, { recursive: true, force: true });
  } else {
    console.log(`Temporary evidence retained at ${temporaryProject}`);
  }
}

if (failed) process.exit(1);
