#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const environment = {
  PATH: process.env.PATH, HOME: paths.home, XDG_CONFIG_HOME: paths.config, XDG_DATA_HOME: paths.data,
  XDG_CACHE_HOME: paths.cache, XDG_STATE_HOME: paths.state, OPENCODE_CONFIG_DIR: paths.opencode,
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_SERVER_PASSWORD: 'isolated-runtime-qualification',
};
const run = (args, timeout = 5_000) => {
  const result = spawnSync('opencode', args, { cwd: paths.project, env: environment, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 });
  return { args, exit_code: result.status, signal: result.signal, timed_out: result.error?.code === 'ETIMEDOUT', stdout: result.stdout || '', stderr: result.stderr || '', spawn_error: result.error?.message || null };
};
try {
  const executablePath = execFileSync('which', ['opencode'], { encoding: 'utf8' }).trim();
  const executableVersion = execFileSync('opencode', ['--version'], { encoding: 'utf8' }).trim();
  const sdkPackagePath = resolve(root, 'node_modules/@opencode-ai/sdk/package.json');
  const sdkVersion = JSON.parse(await (await import('node:fs/promises')).readFile(sdkPackagePath, 'utf8')).version;
  const debug = run(['debug', 'info']);
  const serve = run(['serve', '--hostname=127.0.0.1', '--port=0']);
  const listened = /opencode server listening on\s+https?:\/\//.test(`${serve.stdout}\n${serve.stderr}`);
  const required = Object.fromEntries(REQUIRED_RUNTIME_CAPABILITIES.map((name) => [name, RUNTIME_CAPABILITY_STATES.UNKNOWN]));
  required.server_start = listened ? RUNTIME_CAPABILITY_STATES.SUPPORTED : RUNTIME_CAPABILITY_STATES.UNKNOWN;
  const optional = Object.fromEntries(OPTIONAL_RUNTIME_CAPABILITIES.map((name) => [name, RUNTIME_CAPABILITY_STATES.UNKNOWN]));
  const qualification = qualifyOpenCodeRuntime({
    runtime: createOpenCodeRuntimeIdentity({ executablePath, executableVersion, sdkPackagePath, sdkVersion }),
    required, optional,
    observations: [
      { id: 'isolated-debug-info', kind: 'process', result: { exit_code: debug.exit_code, signal: debug.signal, spawn_error: debug.spawn_error } },
      { id: 'isolated-serve', kind: 'process', result: { exit_code: serve.exit_code, signal: serve.signal, timed_out: serve.timed_out, spawn_error: serve.spawn_error, listened } },
    ],
  });
  const evidence = { ...qualification, adapter_fingerprint: null, isolation: { project_config_disabled: true, runtime_home: 'temporary', credentials: 'none', config_content_present: false }, probe: { debug, serve } };
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
