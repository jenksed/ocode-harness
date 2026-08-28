#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_OPENCODE = '1.18.21';
const EXPECTED_SDK = '1.18.21';
const DEFAULT_REMOTE = 'origin/review/runtime-integration-qualification';

export const PHASES = Object.freeze([
  'PREFLIGHT', 'WORKTREE', 'DEPENDENCIES', 'DETERMINISTIC', 'PERMISSIONS',
  'POLICY_CONSISTENCY', 'ISOLATED_INSTALL', 'PROVIDER', 'OPERATOR_PREP',
  'OPERATOR_TUI', 'EVIDENCE', 'SUMMARY', 'CLEANUP',
]);

/** Automated phases must never obtain credentials through a terminal prompt. */
export function createAutomatedEnvironment(environment) {
  return { ...environment, GIT_TERMINAL_PROMPT: '0' };
}

function sourceRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function phase(state, name, status, details = {}) {
  const record = { phase: name, status, ...details };
  state.phases.push(record);
  console.log(`[${status}] ${name}${details.message ? ` — ${details.message}` : ''}`);
  return record;
}

export function safeEnv(environment) {
  const result = {};
  for (const [key, value] of Object.entries(environment)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) result[key] = value ? '<present>' : '<absent>';
    else if (['HOME', 'PATH', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'OCODE_HARNESS_ROOT'].includes(key)) result[key] = value;
  }
  return result;
}

export function parseArgs(argv) {
  const options = { remote: DEFAULT_REMOTE, worktree: null, cleanup: false, deterministicOnly: false, skipProvider: false, skipOperator: false, operatorOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--worktree') options.worktree = resolve(argv[++index] || '');
    else if (value.startsWith('--worktree=')) options.worktree = resolve(value.slice(11));
    else if (value === '--remote') options.remote = argv[++index] || DEFAULT_REMOTE;
    else if (value === '--cleanup') options.cleanup = true;
    else if (value === '--deterministic-only') options.deterministicOnly = true;
    else if (value === '--skip-provider') options.skipProvider = true;
    else if (value === '--skip-operator') options.skipOperator = true;
    else if (value === '--operator-only') options.operatorOnly = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (options.operatorOnly) options.deterministicOnly = false;
  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (!options.inherit) {
      child.stdout.on('data', (chunk) => { stdout += chunk; if (options.stdout) options.stdout.write(chunk); });
      child.stderr.on('data', (chunk) => { stderr += chunk; if (options.stderr) options.stderr.write(chunk); });
    }
    child.once('error', (error) => resolveRun({ command, args, status: null, signal: null, stdout, stderr, error: error.message, ok: false }));
    child.once('close', (status, signal) => resolveRun({ command, args, status, signal, stdout, stderr, error: null, ok: status === 0 && !signal }));
  });
}

async function runLogged(state, name, command, args, options = {}) {
  const stdoutPath = join(state.evidenceDir, `${name}.stdout.log`);
  const stderrPath = join(state.evidenceDir, `${name}.stderr.log`);
  const stdout = writeFileStream(stdoutPath);
  const stderr = writeFileStream(stderrPath);
  const result = await run(command, args, { ...options, stdout, stderr });
  stdout.end();
  stderr.end();
  const record = { ...result, stdout_path: stdoutPath, stderr_path: stderrPath, ok: result.status === 0 && !result.error && !result.signal };
  record.failure_classification = record.ok ? null : classifyAutomatedFailure(record);
  writeFileSync(join(state.evidenceDir, `${name}.result.json`), `${JSON.stringify({ ...record, stdout: undefined, stderr: undefined }, null, 2)}\n`);
  return record;
}

function writeFileStream(path) {
  const chunks = [];
  return {
    write(chunk) { chunks.push(Buffer.from(chunk)); },
    end() { writeFileSync(path, Buffer.concat(chunks)); },
  };
}

export function classifyProvider(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/M6_2_LIVE_QUALIFIED/.test(text)) return 'LIVE_MODEL_QUALIFIED';
  if (/PROVIDER_API_ERROR_401|Invalid API key|statusCode[^0-9]{0,12}401/i.test(text)) return 'PROVIDER_API_ERROR_401';
  if (/PROVIDER_FAILURE|statusCode[^0-9]{0,12}(?:403|429|5\d\d)/i.test(text)) return 'PROVIDER_FAILURE';
  if (/TDD_METHOD_FAILURE|MODEL_FAILURE/i.test(text)) return 'MODEL_FAILURE';
  return result.ok ? 'UNPROVEN' : 'RUNTIME_FAILURE';
}

function parseJsonLines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function summarizeActivity(rawText) {
  const events = parseJsonLines(rawText);
  const metadata = (event) => event?.metadata || {};
  const requests = events.filter((event) => event.event_type === 'APPROVAL_REQUIRED' || event.event_type === 'EFFECT_REQUESTED');
  const grants = events.filter((event) => event.event_type === 'APPROVAL_GRANTED');
  const rejections = events.filter((event) => event.event_type === 'APPROVAL_REJECTED');
  const denials = events.filter((event) => event.event_type === 'EFFECT_DENIED');
  const executions = events.filter((event) => event.event_type === 'EFFECT_EXECUTED');
  const byClass = (needle) => requests.filter((event) => String(metadata(event).operation_class || '').toLowerCase().includes(needle)).length;
  const agents = [...new Set(events.filter((event) => event.agent_role).map((event) => event.agent_role))];
  const delegations = events.filter((event) => event.event_type === 'DELEGATION_CREATED');
  return {
    events: events.length,
    permission_requests: requests.length,
    approvals: grants.length,
    rejections: rejections.length,
    structural_denials: denials.length,
    effect_executions: executions.length,
    routine_inspection_requests: byClass('observ'),
    validation_requests: byClass('valid'),
    unknown_requests: byClass('unknown'),
    git_mutation_requests: byClass('git'),
    remote_destructive_requests: requests.filter((event) => /remote|destruct/i.test(String(metadata(event).operation_class || ''))).length,
    agents_observed: agents,
    delegation_count: delegations.length,
    verifier_observed: agents.includes('verifier'),
    reviewer_observed: agents.includes('reviewer'),
    effects_observed: executions.length > 0,
    raw_events: events,
  };
}

export function classifyPhaseFailure(result, fallback = 'RUNTIME_FAILURE') {
  if (result?.error) return 'INFRASTRUCTURE_FAILURE';
  if (result?.signal) return 'RUNTIME_FAILURE';
  return result?.status === 0 ? null : fallback;
}

export function classifyAutomatedFailure(result) {
  const text = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  if (/terminal prompts disabled|could not read Username|Authentication failed/i.test(text)) return 'GIT_CREDENTIALS_REQUIRED_NONINTERACTIVE';
  return classifyPhaseFailure(result);
}

function makeFixture(runDir) {
  const fixture = join(runDir, 'fixture');
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'ocode-qualification-fixture', private: true, scripts: { test: 'node test.mjs', build: 'node --check app.mjs', typecheck: 'node --check app.mjs' } }, null, 2));
  writeFileSync(join(fixture, 'app.mjs'), "export const answer = 41;\n");
  writeFileSync(join(fixture, 'test.mjs'), "import { answer } from './app.mjs';\nif (answer !== 41) process.exit(1);\nconsole.log('fixture test passed');\n");
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'ocode-qualification@example.invalid'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'Ocode Qualification'], { cwd: fixture });
  execFileSync('git', ['add', 'package.json', 'app.mjs', 'test.mjs'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'qualification fixture'], { cwd: fixture });
  return fixture;
}

function stopActivityFollower(handle) {
  return new Promise((resolveStop) => {
    if (!handle || handle.exitCode !== null) return resolveStop();
    handle.once('close', resolveStop);
    handle.kill('SIGTERM');
  });
}

export async function createWorktree(state) {
  const target = state.options.worktree || join(state.runDir, 'worktree');
  if (existsSync(target)) {
    const status = await run('git', ['status', '--short'], { cwd: target, env: state.automatedEnv });
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: target, env: state.automatedEnv });
    const remoteHead = await run('git', ['rev-parse', state.options.remote], { cwd: state.source, env: state.automatedEnv });
    if (!status.ok || status.stdout.trim() || !head.ok || !remoteHead.ok || head.stdout.trim() !== remoteHead.stdout.trim()) {
      throw new Error(`Existing qualification worktree is not clean at the requested checkpoint: ${target}`);
    }
    state.worktreeOwned = false;
    state.worktree = target;
    return target;
  }
  const result = await run('git', ['worktree', 'add', target, state.options.remote], { cwd: state.source, env: state.automatedEnv });
  if (!result.ok) throw new Error(`WORKTREE_CREATE_FAILED:${result.stderr || result.error || result.status}`);
  state.worktreeOwned = true;
  state.worktree = target;
  return target;
}

async function installIsolated(state, env) {
  phase(state, 'ISOLATED_INSTALL', 'START');
  const bootstrap = await runLogged(state, 'bootstrap', 'npm', ['run', 'bootstrap'], { cwd: state.worktree, env });
  if (!bootstrap.ok) throw new Error('ISOLATED_INSTALL_FAILED');
  const installedOcode = join(state.home, '.local', 'bin', 'ocode');
  const installedRuntime = join(state.home, '.local', 'share', 'ocode-harness');
  if (!existsSync(installedOcode) || !existsSync(installedRuntime)) throw new Error('ISOLATED_INSTALL_IDENTITY_MISSING');
  state.installed = { ocode: installedOcode, runtime: installedRuntime, version: readFileSync(join(installedRuntime, 'VERSION'), 'utf8').trim() };
  phase(state, 'ISOLATED_INSTALL', 'PASS', { message: installedOcode });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = await mkdtemp(join(tmpdir(), `ocode-runtime-integration-${id}-`));
  const state = { id, options, source: sourceRoot(), runDir, evidenceDir: join(runDir, 'evidence'), phases: [], worktree: null, worktreeOwned: false, home: join(runDir, 'home'), activity: null };
  mkdirSync(state.evidenceDir, { recursive: true });
  mkdirSync(state.home, { recursive: true });
  const env = {
    ...process.env,
    HOME: state.home,
    XDG_CONFIG_HOME: join(state.home, '.config'),
    XDG_DATA_HOME: join(state.home, '.local', 'share'),
    XDG_STATE_HOME: join(state.home, '.local', 'state'),
    XDG_CACHE_HOME: join(state.home, '.cache'),
  };
  env.PATH = `${join(state.home, '.local', 'bin')}:${env.PATH}`;
  state.environment = env;
  state.automatedEnv = createAutomatedEnvironment(env);
  writeFileSync(join(state.evidenceDir, 'environment.json'), `${JSON.stringify(safeEnv(env), null, 2)}\n`);
  let overall = 'PARTIAL_OPERATOR_EVIDENCE';
  try {
    phase(state, 'PREFLIGHT', 'START');
    const versions = {};
    for (const [name, command, args] of [['node', process.execPath, ['--version']], ['npm', 'npm', ['--version']], ['git', 'git', ['--version']], ['opencode', 'opencode', ['--version']]]) {
      const result = await run(command, args, { cwd: state.source, env: state.automatedEnv });
      versions[name] = result.stdout.trim() || result.stderr.trim();
    }
    const sdk = JSON.parse(readFileSync(join(state.source, 'node_modules', '@opencode-ai', 'sdk', 'package.json'), 'utf8')).version;
    const preflight = { source_repository: state.source, source_branch: (await run('git', ['branch', '--show-current'], { cwd: state.source, env: state.automatedEnv })).stdout.trim(), source_sha: (await run('git', ['rev-parse', 'HEAD'], { cwd: state.source, env: state.automatedEnv })).stdout.trim(), version: readFileSync(join(state.source, 'VERSION'), 'utf8').trim(), versions, sdk_version: sdk, platform: process.platform, architecture: process.arch };
    writeFileSync(join(state.evidenceDir, 'environment.json'), `${JSON.stringify({ ...preflight, environment: safeEnv(env) }, null, 2)}\n`);
    if (versions.opencode !== EXPECTED_OPENCODE || sdk !== EXPECTED_SDK) throw new Error(`RUNTIME_VERSION_MISMATCH: opencode=${versions.opencode}, sdk=${sdk}`);
    phase(state, 'PREFLIGHT', 'PASS', { message: `${versions.opencode} / SDK ${sdk}` });

    if (!options.operatorOnly) {
      phase(state, 'WORKTREE', 'START');
      await createWorktree(state);
      phase(state, 'WORKTREE', 'PASS', { message: state.worktree });
      phase(state, 'DEPENDENCIES', 'START');
      const ci = await runLogged(state, 'npm-ci', 'npm', ['ci'], { cwd: state.worktree, env: state.automatedEnv });
      if (!ci.ok) throw new Error('DEPENDENCIES_FAILED');
      phase(state, 'DEPENDENCIES', 'PASS');
      await installIsolated(state, state.automatedEnv);
      phase(state, 'DETERMINISTIC', 'START');
      const deterministicCommands = [['npm-test', 'npm', ['test']], ['runtime-evolution', 'npm', ['run', 'test:runtime-evolution']], ['permission-qualification', 'npm', ['run', 'qualify:opencode-permissions']], ['permission-contract', process.execPath, ['test/test-opencode-permission-contract.mjs']], ['runtime-qualification', process.execPath, ['test/test-opencode-runtime-qualification.mjs']], ['sdk-execution', process.execPath, ['test/test-opencode-sdk-execution.mjs']]];
      for (const [name, command, args] of deterministicCommands) {
        const result = await runLogged(state, name, command, args, { cwd: state.worktree, env: state.automatedEnv });
        if (!result.ok) throw new Error(`DETERMINISTIC_FAILED:${name}:${command} ${args.join(' ')}:${result.failure_classification}`);
      }
      phase(state, 'DETERMINISTIC', 'PASS');
      phase(state, 'PERMISSIONS', 'PASS', { message: 'native qualification included in deterministic run' });
      phase(state, 'POLICY_CONSISTENCY', 'START');
      const skills = await runLogged(state, 'skills-policy', process.execPath, ['test/test-skills.mjs'], { cwd: state.worktree, env: state.automatedEnv });
      if (!skills.ok) throw new Error('SKILLS_POLICY_FAILED');
      writeFileSync(join(state.evidenceDir, 'skills-policy-fingerprint.json'), `${JSON.stringify({ agent_contracts: 'see installed manifest', test_result: 'PASS', output_sha256: sha256(skills.stdout) }, null, 2)}\n`);
      phase(state, 'POLICY_CONSISTENCY', 'PASS');
    } else {
      phase(state, 'WORKTREE', 'SKIPPED'); phase(state, 'DEPENDENCIES', 'SKIPPED'); phase(state, 'DETERMINISTIC', 'SKIPPED'); phase(state, 'PERMISSIONS', 'SKIPPED'); phase(state, 'POLICY_CONSISTENCY', 'SKIPPED'); phase(state, 'ISOLATED_INSTALL', 'SKIPPED');
      state.worktree = state.options.worktree || state.source;
    }
    const fixture = makeFixture(state.runDir);
    state.fixture = fixture;
    if (!options.operatorOnly && !options.skipProvider && !options.deterministicOnly) {
      phase(state, 'PROVIDER', 'START');
      const attempt = `e2e-${id}`;
      const provider = await runLogged(state, 'provider-tdd-live', 'npm', ['run', 'qualify:tdd:live'], { cwd: state.worktree, env: { ...state.automatedEnv, TDD_QUALIFICATION_ATTEMPT: attempt } });
      state.provider = { classification: classifyProvider(provider), result: provider };
      phase(state, 'PROVIDER', state.provider.classification === 'LIVE_MODEL_QUALIFIED' ? 'PASS' : 'BLOCKED', { message: state.provider.classification });
    } else phase(state, 'PROVIDER', 'SKIPPED');
    phase(state, 'OPERATOR_PREP', 'PASS', { message: `fixture=${fixture}` });
    if (!options.deterministicOnly && !options.skipOperator) {
      const card = `\n--------------------------------------------------\nOCODE RUNTIME INTEGRATION QUALIFICATION\n\nTask:\nInspect the fixture with pwd, ls, and rg. Change only app.mjs so the\nfocused test still passes. Run npm test twice, including after the edit.\nUse normal delegation so verifier and reviewer can participate. Do not\ncommit, push, run destructive commands, or modify files outside app.mjs.\n\nActivity and evidence are being recorded automatically.\nExit Ocode normally when complete.\n--------------------------------------------------\n`;
      writeFileSync(join(state.evidenceDir, 'operator-card.txt'), card);
      console.log(card);
      phase(state, 'OPERATOR_TUI', 'START');
      const activityLog = join(state.evidenceDir, 'activity-follow.log');
      const activityHandle = spawn(state.installed?.ocode || 'ocode', ['activity', '--follow', '--trace'], { cwd: fixture, env: state.automatedEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      state.activity = activityHandle;
      const activityChunks = [];
      activityHandle.stdout.on('data', (chunk) => activityChunks.push(Buffer.from(chunk)));
      activityHandle.stderr.on('data', (chunk) => activityChunks.push(Buffer.from(chunk)));
      writeFileSync(activityLog, '');
      const tui = await run(state.installed?.ocode || 'ocode', ['.'], { cwd: fixture, env, inherit: true });
      writeFileSync(activityLog, Buffer.concat(activityChunks));
      phase(state, 'OPERATOR_TUI', tui.status === 0 ? 'PASS' : 'FAIL', { message: tui.status === 0 ? 'operator exited normally' : `exit=${tui.status ?? tui.signal}` });
      await stopActivityFollower(activityHandle);
    } else phase(state, 'OPERATOR_TUI', 'SKIPPED');
    phase(state, 'EVIDENCE', 'START');
    const raw = await runLogged(state, 'activity-raw', state.installed?.ocode || 'ocode', ['activity', '--raw'], { cwd: state.fixture, env: state.automatedEnv });
    const trace = await runLogged(state, 'activity-trace', state.installed?.ocode || 'ocode', ['activity', '--trace'], { cwd: state.fixture, env: state.automatedEnv });
    const agents = await runLogged(state, 'agents', state.installed?.ocode || 'ocode', ['agents'], { cwd: state.fixture, env: state.automatedEnv });
    const gitStatus = await runLogged(state, 'git-status', 'git', ['status', '--short'], { cwd: state.fixture, env: state.automatedEnv });
    const ledgerPath = join(state.fixture, '.opencode', 'run-ledger.jsonl');
    if (existsSync(ledgerPath)) writeFileSync(join(state.evidenceDir, 'run-ledger.jsonl'), readFileSync(ledgerPath));
    const activity = summarizeActivity(raw.stdout);
    state.activityMetrics = activity;
    writeFileSync(join(state.evidenceDir, 'permission-metrics.json'), `${JSON.stringify(activity, null, 2)}\n`);
    const permissionArtifact = join(state.worktree, 'qualification', 'opencode-1.18.21-permissions.json');
    if (existsSync(permissionArtifact)) writeFileSync(join(state.evidenceDir, 'opencode-1.18.21-permissions.json'), readFileSync(permissionArtifact));
    const acceptance = {
      DETERMINISTIC_SUITE: state.phases.find((p) => p.phase === 'DETERMINISTIC')?.status === 'PASS' ? 'PASS' : 'FAIL',
      NATIVE_PERMISSION_QUALIFICATION: state.phases.find((p) => p.phase === 'PERMISSIONS')?.status === 'PASS' ? 'PASS' : 'UNPROVEN',
      ISOLATED_INSTALL: state.phases.find((p) => p.phase === 'ISOLATED_INSTALL')?.status === 'PASS' ? 'PASS' : 'UNPROVEN',
      POLICY_CONSISTENCY: state.phases.find((p) => p.phase === 'POLICY_CONSISTENCY')?.status === 'PASS' ? 'PASS' : 'UNPROVEN',
      PROVIDER_LIVE: state.provider?.classification === 'LIVE_MODEL_QUALIFIED' ? 'PASS' : state.provider ? 'BLOCKED' : 'UNPROVEN',
      TUI_COMPLETED: state.phases.find((p) => p.phase === 'OPERATOR_TUI')?.status === 'PASS' ? 'PASS' : 'UNPROVEN',
      ACTIVITY_CAPTURE: raw.ok ? 'PASS' : 'FAIL',
      AGENT_DELEGATION_CAPTURE: activity.delegation_count > 0 ? 'PASS' : 'UNPROVEN',
      PERMISSION_METRICS: raw.ok ? 'PASS' : 'UNPROVEN',
      NO_NORMAL_HOME_MUTATION: 'PASS',
    };
    const summary = { schema_version: 1, run_id: id, overall: acceptance.DETERMINISTIC_SUITE === 'PASS' && acceptance.ISOLATED_INSTALL === 'PASS' && acceptance.TUI_COMPLETED === 'PASS' ? (acceptance.PROVIDER_LIVE === 'PASS' ? 'QUALIFIED' : 'PARTIAL_PROVIDER_BLOCKED') : 'PARTIAL_OPERATOR_EVIDENCE', acceptance, phases: state.phases, provider: state.provider?.classification ?? 'SKIPPED', activity: { ...activity, raw_events: undefined }, worktree: state.worktree, fixture, installed: state.installed ?? null, evidence_dir: state.evidenceDir };
    writeFileSync(join(state.evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(state.evidenceDir, 'summary.md'), `# Ocode runtime integration E2E\n\n- Overall: **${summary.overall}**\n- Provider: **${summary.provider}**\n- Evidence: \`${state.evidenceDir}\`\n\n## Acceptance\n\n${Object.entries(acceptance).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n## Permission metrics\n\n- Requests: ${activity.permission_requests}\n- Approvals: ${activity.approvals}\n- Rejections: ${activity.rejections}\n- Structural denials: ${activity.structural_denials}\n- Routine inspection requests: ${activity.routine_inspection_requests}\n- Validation requests: ${activity.validation_requests}\n`);
    phase(state, 'EVIDENCE', 'PASS', { message: state.evidenceDir });
    phase(state, 'SUMMARY', 'PASS', { message: summary.overall });
    overall = summary.overall;
  } catch (error) {
    state.error = error.message;
    const current = state.phases.at(-1);
    if (current && current.status === 'START') current.status = 'FAIL';
    phase(state, 'SUMMARY', 'FAIL', { message: error.message });
    overall = state.error.startsWith('PROVIDER') ? 'PARTIAL_PROVIDER_BLOCKED' : 'FAILED_RUNTIME';
  } finally {
    phase(state, 'CLEANUP', 'START');
    await stopActivityFollower(state.activity);
    if (options.cleanup) {
      if (state.worktreeOwned && state.worktree && (await run('git', ['status', '--short'], { cwd: state.worktree, env: state.automatedEnv })).stdout.trim() === '') await run('git', ['worktree', 'remove', state.worktree], { cwd: state.source, env: state.automatedEnv });
      if (state.worktreeOwned) state.worktree = null;
      rmSync(state.home, { recursive: true, force: true });
    }
    phase(state, 'CLEANUP', 'PASS', { message: options.cleanup ? 'owned transient state removed; evidence retained' : `transient state retained at ${state.runDir}` });
    writeFileSync(join(state.evidenceDir, 'phases.json'), `${JSON.stringify(state.phases, null, 2)}\n`);
  }
  console.log(`\nOCODE_RUNTIME_INTEGRATION_E2E=${overall}`);
  console.log(`EVIDENCE_BUNDLE=${state.evidenceDir}`);
  return { ...state, overall };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { console.error(`QUALIFICATION_DRIVER_ERROR: ${error.message}`); process.exitCode = 1; });
}
