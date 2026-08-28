#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  OPTIONAL_RUNTIME_CAPABILITIES,
  REQUIRED_RUNTIME_CAPABILITIES,
  RUNTIME_CAPABILITY_STATES,
  createOpenCodeRuntimeIdentity,
  qualifyOpenCodeRuntime,
} from '../packages/harness-runtime/lib/opencode-runtime-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 2])) throw new Error('Usage: qualify-opencode-runtime.mjs [--output <path>]');
const outputPath = outputIndex === -1 ? null : resolve(process.argv[outputIndex + 1]);
const isolated = mkdtempSync(join(tmpdir(), 'ocode-runtime-qualification-'));
const paths = Object.fromEntries(['home', 'config', 'data', 'cache', 'state', 'opencode', 'project'].map((name) => [name, join(isolated, name)]));
for (const path of Object.values(paths)) mkdirSync(path, { recursive: true, mode: 0o700 });

// The SDK server inherits process.env. Replace rather than overlay the ambient
// environment so qualification cannot accidentally consume user config or auth.
const environment = {
  PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: paths.home, XDG_CONFIG_HOME: paths.config,
  XDG_DATA_HOME: paths.data, XDG_CACHE_HOME: paths.cache, XDG_STATE_HOME: paths.state,
  OPENCODE_CONFIG_DIR: paths.opencode, OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  // A writable system temporary directory is a process prerequisite, not user
  // configuration. Keep OpenCode's durable state under the isolated roots above.
  TMPDIR: tmpdir(),
};
const required = Object.fromEntries(REQUIRED_RUNTIME_CAPABILITIES.map((name) => [name, RUNTIME_CAPABILITY_STATES.UNKNOWN]));
const optional = Object.fromEntries(OPTIONAL_RUNTIME_CAPABILITIES.map((name) => [name, RUNTIME_CAPABILITY_STATES.UNKNOWN]));
const observations = [];

async function inControlledEnvironment(operation) {
  const original = { ...process.env };
  const cwd = process.cwd();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  process.chdir(paths.project);
  try { return await operation(); } finally {
    process.chdir(cwd);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

let runtime = null;
try {
  const executablePath = execFileSync('which', ['opencode'], { encoding: 'utf8', env: environment }).trim();
  const executableVersion = execFileSync('opencode', ['--version'], { encoding: 'utf8', env: environment }).trim();
  const sdkPackagePath = resolve(root, 'node_modules/@opencode-ai/sdk/package.json');
  const sdkVersion = JSON.parse(await (await import('node:fs/promises')).readFile(sdkPackagePath, 'utf8')).version;
  runtime = createOpenCodeRuntimeIdentity({ executablePath, executableVersion, sdkPackagePath, sdkVersion });
  const lifecycle = await inControlledEnvironment(async () => {
    let server;
    try {
      // Load the SDK only after isolation is active. The installed runtime may
      // inspect environment at module initialization as well as at spawn time.
      const { createOpencodeClient, createOpencodeServer } = await import('@opencode-ai/sdk');
      server = await createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 15_000, config: { agent: { coder: { model: 'freellmapi/auto:coding' } } } });
      required.server_start = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      required.sdk_endpoint = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      const client = createOpencodeClient({ baseUrl: server.url, directory: paths.project });
      const subscription = await client.event.subscribe({ query: { directory: paths.project } });
      required.event_subscribe = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      const created = await client.session.create({ query: { directory: paths.project }, body: { title: 'Ocode runtime qualification' } });
      if (created?.error || !created?.data?.id) throw new Error(`SESSION_CREATE_FAILED:${JSON.stringify(created?.error ?? null)}`);
      required.session_create = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      const aborted = await client.session.abort({ path: { id: created.data.id }, query: { directory: paths.project } });
      if (aborted?.error) throw new Error(`SESSION_ABORT_FAILED:${JSON.stringify(aborted.error)}`);
      required.session_abort = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      await subscription?.stream?.return?.();
      return { url: server.url, session_id_observed: true };
    } finally {
      if (server) {
        await server.close();
        required.clean_shutdown = RUNTIME_CAPABILITY_STATES.SUPPORTED;
      }
    }
  });
  observations.push({ id: 'isolated-sdk-managed-lifecycle', kind: 'observed-sdk', result: lifecycle });
} catch (error) {
  observations.push({ id: 'isolated-sdk-managed-lifecycle', kind: 'observed-sdk', result: { error: error?.message ?? String(error) } });
}

// The credential-free permission qualifier exercises the full lifecycle with a
// deterministic local provider. Consume only a version-matched retained record
// whose individual scenarios establish the required outcomes.
const permissionEvidencePath = resolve(root, 'qualification', 'opencode-1.18.21-permissions.json');
if (runtime && existsSync(permissionEvidencePath)) {
  const source = readFileSync(permissionEvidencePath, 'utf8');
  const retained = JSON.parse(source);
  const scenario = (id) => retained.scenarios?.find((entry) => entry.id === id);
  const lifecycleSupported = Object.values(retained.lifecycle ?? {}).length === 8
    && Object.values(retained.lifecycle).every((value) => value === 'SUPPORTED');
  const compatible = retained.runtime?.opencode === runtime.executable_version
    && retained.runtime?.sdk === runtime.sdk_version
    && lifecycleSupported
    && scenario('explicit-no-match-ask')?.permission_request_count === 1
    && scenario('explicit-no-match-ask')?.permission_reply?.id
    && scenario('reply-once-scope')?.permission_request_count === 2
    && scenario('reply-reject')?.tool_states?.at(-1) === 'error'
    && scenario('low-interruption-loop')?.tool_states?.filter((state) => state === 'completed').length === 4
    && retained.scenarios.every((entry) => entry.session_abort === 'SUPPORTED');
  if (compatible) {
    for (const name of REQUIRED_RUNTIME_CAPABILITIES) required[name] = RUNTIME_CAPABILITY_STATES.SUPPORTED;
    optional.permission_reply_session = RUNTIME_CAPABILITY_STATES.SUPPORTED;
    optional.bash_metadata = RUNTIME_CAPABILITY_STATES.SUPPORTED;
    observations.push({ id: 'retained-local-permission-qualification', kind: 'observed-sdk', result: { path: 'qualification/opencode-1.18.21-permissions.json', sha256: createHash('sha256').update(source).digest('hex') } });
  }
}
const qualification = runtime
  ? qualifyOpenCodeRuntime({ runtime, required, optional, observations })
  : { schema_version: 1, contract_version: 1, qualification_status: 'UNQUALIFIED', runtime: null, required, optional, observations };
const evidence = { ...qualification, adapter_fingerprint: null, isolation: { environment_controlled: true, project_config_disabled: true, runtime_home: 'temporary', credentials: 'none', config_content_present: false, canonical_seam: 'sdk_managed_server' } };
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence));
rmSync(isolated, { recursive: true, force: true });
