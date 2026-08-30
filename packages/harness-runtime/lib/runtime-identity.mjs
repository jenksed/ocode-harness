/** Resolve and qualify the single OpenCode executable identity for one session. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimePackageRoot } from './runtime-paths.mjs';

export const RUNTIME_COMPATIBILITY_SCHEMA_VERSION = 1;
export const RUNTIME_COMPATIBILITY_CONTRACT_VERSION = 1;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function releaseRootFromRuntime() {
  let current = runtimePackageRoot();
  while (true) {
    const candidate = join(current, 'runtime-compatibility.json');
    if (existsSync(candidate)) return current;
    const parent = dirname(current);
    if (parent === current) fail('OCODE_RUNTIME_COMPATIBILITY_MISSING', 'runtime-compatibility.json is absent from the installed release');
    current = parent;
  }
}

export function readRuntimeCompatibility({ releaseRoot = releaseRootFromRuntime() } = {}) {
  const path = resolve(releaseRoot, 'runtime-compatibility.json');
  if (!existsSync(path)) fail('OCODE_RUNTIME_COMPATIBILITY_MISSING', `required compatibility metadata is missing: ${path}`);
  let compatibility;
  try {
    compatibility = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('OCODE_RUNTIME_COMPATIBILITY_INVALID', `cannot parse ${path}`);
  }
  if (!plain(compatibility)
    || compatibility.schema_version !== RUNTIME_COMPATIBILITY_SCHEMA_VERSION
    || compatibility.contract_version !== RUNTIME_COMPATIBILITY_CONTRACT_VERSION
    || typeof compatibility.compatibility_id !== 'string' || !compatibility.compatibility_id
    || !plain(compatibility.opencode) || typeof compatibility.opencode.required_version !== 'string' || !compatibility.opencode.required_version
    || !plain(compatibility.sdk) || compatibility.sdk.package !== '@opencode-ai/sdk' || typeof compatibility.sdk.required_version !== 'string' || !compatibility.sdk.required_version
    || !plain(compatibility.node) || !Number.isInteger(compatibility.node.minimum_major) || compatibility.node.minimum_major < 1
    || !plain(compatibility.platform) || !Array.isArray(compatibility.platform.supported) || compatibility.platform.supported.length === 0
    || compatibility.platform.supported.some((entry) => typeof entry !== 'string' || !entry)) {
    fail('OCODE_RUNTIME_COMPATIBILITY_INVALID', `required compatibility fields are invalid: ${path}`);
  }
  return { path, compatibility };
}

export function resolveOpenCodeExecutable({ environment = process.env } = {}) {
  const paths = String(environment.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of paths) {
    const candidate = resolve(directory, 'opencode');
    try {
      const info = statSync(candidate);
      if (!info.isFile() || (info.mode & 0o111) === 0) continue;
      const canonical = realpathSync(candidate);
      if (!isAbsolute(canonical)) continue;
      return canonical;
    } catch {
      // Keep searching PATH; a broken entry is never a durable identity.
    }
  }
  fail('OCODE_RUNTIME_EXECUTABLE_MISSING', 'no executable opencode was found on PATH');
}

function observedOpenCodeVersion(executablePath, environment) {
  const result = spawnSync(executablePath, ['--version'], { encoding: 'utf8', env: environment });
  if (result.error || result.status !== 0) {
    fail('OCODE_RUNTIME_EXECUTABLE_INVALID', `${executablePath} could not report its version`);
  }
  const version = result.stdout.trim();
  if (!version) fail('OCODE_RUNTIME_EXECUTABLE_INVALID', `${executablePath} reported an empty version`);
  return version;
}

function installedSdkIdentity() {
  let entryPath;
  try {
    entryPath = fileURLToPath(import.meta.resolve('@opencode-ai/sdk'));
  } catch {
    fail('OCODE_RUNTIME_SDK_MISSING', 'packaged @opencode-ai/sdk entrypoint is unavailable');
  }
  let current = dirname(entryPath), packagePath = null;
  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) { packagePath = candidate; break; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!packagePath) fail('OCODE_RUNTIME_SDK_MISSING', 'packaged @opencode-ai/sdk package metadata is unavailable');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    fail('OCODE_RUNTIME_SDK_INVALID', `cannot read packaged SDK metadata: ${packagePath}`);
  }
  if (pkg.name !== '@opencode-ai/sdk' || typeof pkg.version !== 'string' || !pkg.version) {
    fail('OCODE_RUNTIME_SDK_INVALID', `invalid packaged SDK metadata: ${packagePath}`);
  }
  return { package: pkg.name, version: pkg.version, package_path: realpathSync(packagePath) };
}

export function qualifyRuntimeIdentity({ releaseRoot, environment = process.env } = {}) {
  const metadata = readRuntimeCompatibility({ releaseRoot });
  const executablePath = resolveOpenCodeExecutable({ environment });
  const executableVersion = observedOpenCodeVersion(executablePath, environment);
  if (executableVersion !== metadata.compatibility.opencode.required_version) {
    fail('OCODE_RUNTIME_OPENCODE_VERSION_MISMATCH', `requires ${metadata.compatibility.opencode.required_version}; found ${executableVersion}`);
  }
  const sdk = installedSdkIdentity();
  if (sdk.package !== metadata.compatibility.sdk.package || sdk.version !== metadata.compatibility.sdk.required_version) {
    fail('OCODE_RUNTIME_SDK_MISMATCH', `requires ${metadata.compatibility.sdk.package}@${metadata.compatibility.sdk.required_version}; found ${sdk.package}@${sdk.version}`);
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < metadata.compatibility.node.minimum_major) {
    fail('OCODE_RUNTIME_NODE_UNSUPPORTED', `requires Node >=${metadata.compatibility.node.minimum_major}; found ${process.versions.node}`);
  }
  const platform = `${process.platform} ${process.arch}`;
  if (!metadata.compatibility.platform.supported.includes(platform)) {
    fail('OCODE_RUNTIME_PLATFORM_UNSUPPORTED', `${platform}; supported: ${metadata.compatibility.platform.supported.join(', ')}`);
  }
  return Object.freeze({
    schema_version: 1,
    compatibility: Object.freeze({
      path: metadata.path,
      id: metadata.compatibility.compatibility_id,
      contract_version: metadata.compatibility.contract_version,
      required_opencode_version: metadata.compatibility.opencode.required_version,
    }),
    executable: Object.freeze({ path: executablePath, version: executableVersion }),
    sdk: Object.freeze(sdk),
    node: Object.freeze({ version: process.versions.node, major: nodeMajor, minimum_major: metadata.compatibility.node.minimum_major }),
    platform: process.platform,
    architecture: process.arch,
  });
}

export function runtimeIdentityExecutable(identity) {
  const path = identity?.executable?.path;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('OCODE_RUNTIME_IDENTITY_INVALID: a qualified absolute executable path is required');
  return path;
}

/**
 * The packaged SDK exposes no executable option and launches `opencode` by
 * name for its local server. Restrict that lookup to a private alias for the
 * already-qualified canonical executable; callers must remove it after the
 * server has been launched.
 */
export function createVerifiedOpenCodeEnvironment(identity, environment = process.env) {
  const executable = runtimeIdentityExecutable(identity);
  const directory = mkdtempSync(join(tmpdir(), 'ocode-runtime-identity-'));
  const alias = join(directory, 'opencode');
  try {
    symlinkSync(executable, alias);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    executable,
    alias,
    environment: { ...environment, PATH: [directory, environment.PATH].filter(Boolean).join(delimiter) },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}
