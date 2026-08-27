/**
 * deploy.mjs
 * Shared deployment primitives for stable/dev separation and deterministic promotion
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { env } from 'node:process';
import { loadAgentContracts } from './agent-contract.mjs';
import { loadBindingProfile } from './opencode-integration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CONFIG = {
  harnessRoot: join(homedir(), '.local', 'share', 'ocode-harness'),
  binDir: join(homedir(), '.local', 'bin'),
  agentsDir: join(homedir(), '.config', 'opencode', 'agents'),
  opencodeConfig: join(homedir(), '.config', 'opencode', 'opencode.json'),
  machineConfig: join(homedir(), '.config', 'ocode', 'config.json'),
  orientationDir: join(homedir(), '.local', 'share', 'ocode-harness', 'orientation'),
  harnessRuntimeDir: join(homedir(), '.local', 'share', 'ocode-harness', 'harness-runtime'),
  stagingDir: join(homedir(), '.local', 'share', 'ocode-harness-staging'),
  backupDir: join(homedir(), '.local', 'share', 'ocode-harness-backups'),
};

export const DEFAULT_MACHINE_CONFIG = {
  profile: 'hybrid',
  freellmapi: {
    base_url: 'http://127.0.0.1:3001/v1',
  },
  closeout: {
    push: false,
  },
};

export const RELEASE_IDENTITY_SCHEMA_VERSION = 1;
export const RELEASE_IDENTITY_FILENAME = 'RELEASE.json';

const LEGACY_OCODE_FREELLMAPI_MODELS = [
  'auto:smart',
  'auto:fast',
  'auto:balanced',
  'auto:orchestrator',
  'auto:planner',
  'auto:coder',
  'auto:reviewer',
  'auto:researcher',
  'auto:verifier',
  'auto:judge',
];

export function readVersion(versionPath) {
  if (!existsSync(versionPath)) return null;
  return readFileSync(versionPath, 'utf8').trim();
}

export function writeVersion(targetDir, version) {
  writeFileSync(join(targetDir, 'VERSION'), version + '\n', 'utf8');
}

function runGit(sourceRoot, args) {
  const result = spawnSync('git', ['-C', sourceRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export function validateReleaseIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('Release identity must be an object');
  }
  if (identity.schema_version !== RELEASE_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`Release identity schema_version must be ${RELEASE_IDENTITY_SCHEMA_VERSION}`);
  }
  if (typeof identity.version !== 'string' || !identity.version) {
    throw new Error('Release identity version must be a non-empty string');
  }
  if (identity.source_commit !== null
      && (typeof identity.source_commit !== 'string' || !/^[0-9a-f]{40}$/.test(identity.source_commit))) {
    throw new Error('Release identity source_commit must be a full lowercase Git SHA or null');
  }
  if (identity.source_ref !== null && (typeof identity.source_ref !== 'string' || !identity.source_ref)) {
    throw new Error('Release identity source_ref must be a non-empty string or null');
  }
  if (identity.source_dirty !== null && typeof identity.source_dirty !== 'boolean') {
    throw new Error('Release identity source_dirty must be boolean or null');
  }
  if (identity.source_commit === null && (identity.source_ref !== null || identity.source_dirty !== null)) {
    throw new Error('Release identity without a source_commit cannot claim a ref or dirty state');
  }
  return identity;
}

export function inspectSourceIdentity(sourceRoot, version) {
  if (typeof version !== 'string' || !version) {
    throw new Error('Cannot inspect release identity without a semantic version');
  }
  const sourceCommit = runGit(sourceRoot, ['rev-parse', '--verify', 'HEAD']);
  if (!sourceCommit || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    return validateReleaseIdentity({
      schema_version: RELEASE_IDENTITY_SCHEMA_VERSION,
      version,
      source_commit: null,
      source_ref: null,
      source_dirty: null,
    });
  }

  const rawRef = runGit(sourceRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const status = runGit(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status === null) throw new Error('Could not determine Git dirty state for release source');

  return validateReleaseIdentity({
    schema_version: RELEASE_IDENTITY_SCHEMA_VERSION,
    version,
    source_commit: sourceCommit,
    source_ref: rawRef || null,
    source_dirty: status.length > 0,
  });
}

export function assertPromotableSourceIdentity(identity) {
  validateReleaseIdentity(identity);
  if (identity.source_commit !== null && identity.source_dirty !== false) {
    throw new Error(
      'OCODE_RELEASE_SOURCE_DIRTY: refusing to promote a dirty Git checkout because commit SHA would not identify the installed bytes',
    );
  }
  return identity;
}

export function isExactReleaseIdentity(identity) {
  try {
    validateReleaseIdentity(identity);
  } catch {
    return false;
  }
  return identity.source_commit !== null && identity.source_dirty === false;
}

export function writeReleaseIdentity(targetDir, identity) {
  validateReleaseIdentity(identity);
  writeFileSync(
    join(targetDir, RELEASE_IDENTITY_FILENAME),
    `${JSON.stringify(identity, null, 2)}\n`,
    'utf8',
  );
  return identity;
}

export function readReleaseIdentity(targetDir) {
  const path = join(targetDir, RELEASE_IDENTITY_FILENAME);
  if (!existsSync(path)) return null;
  let identity;
  try {
    identity = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Malformed release identity at ${path}: ${error.message}`);
  }
  return validateReleaseIdentity(identity);
}

export function sameReleaseIdentity(left, right) {
  return isExactReleaseIdentity(left)
    && isExactReleaseIdentity(right)
    && left.version === right.version
    && left.source_commit === right.source_commit;
}

export function findSourceRepo(startDir) {
  let dir = resolve(startDir);
  const requiredComponents = ['VERSION', join('installer', 'install.mjs'), 'agents', 'packages'];

  while (true) {
    if (requiredComponents.every((component) => existsSync(join(dir, component)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeOwned(existing, owned) {
  if (!isPlainObject(existing)) return structuredClone(owned);
  const merged = { ...existing };
  for (const [key, value] of Object.entries(owned)) {
    if (isPlainObject(value) && isPlainObject(existing[key])) merged[key] = deepMergeOwned(existing[key], value);
    else merged[key] = value;
  }
  return merged;
}

export function readMachineConfig(configPath = CONFIG.machineConfig) {
  if (!existsSync(configPath)) return structuredClone(DEFAULT_MACHINE_CONFIG);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Malformed Ocode machine config at ${configPath}: ${err.message}`);
  }

  return deepMergeOwned(DEFAULT_MACHINE_CONFIG, parsed);
}

export function ensureMachineConfig(configPath = CONFIG.machineConfig) {
  if (existsSync(configPath)) return readMachineConfig(configPath);

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(DEFAULT_MACHINE_CONFIG, null, 2) + '\n', 'utf8');
  return readMachineConfig(configPath);
}

export function getFreellmapiBaseUrl(config = readMachineConfig()) {
  return config.freellmapi?.base_url || DEFAULT_MACHINE_CONFIG.freellmapi.base_url;
}

export function buildOwnedOpenCodeConfig(sourceConfigData, machineConfig = readMachineConfig(), governedRoles) {
  const ownedConfig = structuredClone(sourceConfigData);
  const baseURL = getFreellmapiBaseUrl(machineConfig);

  ownedConfig.provider ??= {};
  ownedConfig.provider.freellmapi ??= {};
  ownedConfig.provider.freellmapi.options ??= {};
  ownedConfig.provider.freellmapi.options.baseURL = baseURL;
  if (governedRoles) ownedConfig.task_allowlist = [...governedRoles];

  return ownedConfig;
}

export function mergeOpenCodeConfig(existingConfig, sourceConfigData, machineConfig = readMachineConfig(), governedRoles) {
  const ownedConfig = buildOwnedOpenCodeConfig(sourceConfigData, machineConfig, governedRoles);
  const merged = deepMergeOwned(existingConfig || {}, ownedConfig);
  const currentModels = ownedConfig.provider?.freellmapi?.models || {};
  const mergedModels = merged.provider?.freellmapi?.models;
  if (mergedModels) {
    for (const model of LEGACY_OCODE_FREELLMAPI_MODELS) {
      if (!Object.hasOwn(currentModels, model)) delete mergedModels[model];
    }
  }
  if (merged.provider?.freellmapi?.options) delete merged.provider.freellmapi.options.apiKey;
  return merged;
}

export function removeLegacyRequestEffectTools(opencodeConfigPath = CONFIG.opencodeConfig) {
  const toolsDir = join(dirname(opencodeConfigPath), 'tools');
  const removed = [];
  for (const name of ['request_effect.js', 'request_effect.mjs']) {
    const path = join(toolsDir, name);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    if (!source.includes('OCODE_HARNESS_ROOT') || !source.includes('approval-first-effect-tool')) continue;
    rmSync(path, { force: true });
    removed.push(path);
  }
  return removed;
}

export function stageCandidate(sourceRoot, stagingDir, version) {
  console.log(`Staging candidate from ${sourceRoot} to ${stagingDir}...`);

  if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  copyDir(join(sourceRoot, 'packages', 'orientation'), join(stagingDir, 'orientation'));
  copyDir(join(sourceRoot, 'packages', 'harness-runtime'), join(stagingDir, 'harness-runtime'));
  copyDir(join(sourceRoot, 'node_modules'), join(stagingDir, 'harness-runtime', 'node_modules'));
  copyDir(join(sourceRoot, 'doctrine'), join(stagingDir, 'doctrine'));
  copyDir(join(sourceRoot, 'agents'), join(stagingDir, 'agents'));
  copyDir(join(sourceRoot, 'profiles'), join(stagingDir, 'profiles'));
  copyDir(join(sourceRoot, 'skills'), join(stagingDir, 'skills'));
  copyDir(join(sourceRoot, 'opencode-config'), join(stagingDir, 'opencode-config'));
  writeVersion(stagingDir, version);

  console.log(`✓ Staged candidate version ${version}`);
  return stagingDir;
}

export function validateCandidate(stagingDir) {
  console.log(`Validating candidate at ${stagingDir}...`);
  const checks = [];

  const orientationDir = join(stagingDir, 'orientation');
  const orientationPackageJson = join(orientationDir, 'package.json');
  if (existsSync(orientationPackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(orientationPackageJson, 'utf8'));
      checks.push({ name: 'orientation package', ok: true, version: pkg.version });
    } catch (err) {
      checks.push({ name: 'orientation package', ok: false, error: err.message });
    }
  } else checks.push({ name: 'orientation package', ok: false, error: 'not found' });

  checks.push({ name: 'orientation bin', ok: existsSync(join(orientationDir, 'bin', 'orient.mjs')) });
  for (const lib of ['orientation.mjs', 'probe.mjs', 'render.mjs']) {
    checks.push({ name: `orientation lib/${lib}`, ok: existsSync(join(orientationDir, 'lib', lib)) });
  }

  const harnessRuntimeDir = join(stagingDir, 'harness-runtime');
  const harnessRuntimePackageJson = join(harnessRuntimeDir, 'package.json');
  if (existsSync(harnessRuntimePackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(harnessRuntimePackageJson, 'utf8'));
      checks.push({ name: 'harness-runtime package', ok: true, version: pkg.version });
    } catch (err) {
      checks.push({ name: 'harness-runtime package', ok: false, error: err.message });
    }
  } else checks.push({ name: 'harness-runtime package', ok: false, error: 'not found' });

  const harnessLibs = ['identity.mjs', 'lifecycle.mjs', 'ledger.mjs', 'evidence.mjs', 'composition.mjs', 'closeout.mjs', 'verify.mjs', 'governance.mjs', 'permission-projection.mjs', 'admission.mjs', 'agent-contract.mjs', 'opencode-integration.mjs', 'execution.mjs', 'skill-contract.mjs', 'skill-capsules.mjs', 'skill-projection.mjs', 'skill-runtime.mjs'];
  for (const lib of harnessLibs) checks.push({ name: `harness-runtime lib/${lib}`, ok: existsSync(join(harnessRuntimeDir, 'lib', lib)) });

  checks.push({ name: 'harness-runtime bin/harness.mjs', ok: existsSync(join(harnessRuntimeDir, 'bin', 'harness.mjs')) });
  checks.push({ name: 'harness-runtime bin/ocode.mjs', ok: existsSync(join(harnessRuntimeDir, 'bin', 'ocode.mjs')) });

  const doctrineDir = join(stagingDir, 'doctrine');
  for (const file of ['agentic-agile.md', 'resource-policy.md', 'policy-version.json']) {
    checks.push({ name: `doctrine/${file}`, ok: existsSync(join(doctrineDir, file)) });
  }

  const policyVersionPath = join(doctrineDir, 'policy-version.json');
  if (existsSync(policyVersionPath)) {
    try {
      const manifest = JSON.parse(readFileSync(policyVersionPath, 'utf8'));
      checks.push({ name: 'doctrine/policy-version.json valid', ok: 'policy_version' in manifest && 'doctrine' in manifest && 'resources' in manifest });
    } catch (err) {
      checks.push({ name: 'doctrine/policy-version.json valid', ok: false, error: err.message });
    }
  } else checks.push({ name: 'doctrine/policy-version.json', ok: false, error: 'not found' });

  const agentsDir = join(stagingDir, 'agents');
  try {
    const { manifest } = loadAgentContracts({ baseDir: stagingDir });
    checks.push({ name: `agents (manifest-derived ${manifest.roles.length})`, ok: true });
    for (const profileName of ['free', 'hybrid']) {
      loadBindingProfile(profileName, { profilesDir: join(stagingDir, 'profiles'), manifest });
      checks.push({ name: `profiles/${profileName}.json`, ok: true });
    }
  } catch (err) {
    checks.push({ name: 'manifest-derived agents and profiles', ok: false, error: err.message });
  }
  checks.push({ name: 'agents/manifest.json', ok: existsSync(join(agentsDir, 'manifest.json')) });
  checks.push({ name: 'skills directory', ok: existsSync(join(stagingDir, 'skills')) });
  checks.push({ name: 'opencode-config/opencode.json', ok: existsSync(join(stagingDir, 'opencode-config', 'opencode.json')) });

  const versionContent = readVersion(join(stagingDir, 'VERSION'));
  checks.push({ name: 'VERSION file', ok: !!versionContent, version: versionContent });

  let allPassed = true;
  for (const check of checks) {
    if (check.ok) console.log(`  ✓ ${check.name}${check.version ? `: ${check.version}` : ''}`);
    else {
      console.error(`  ✗ ${check.name}${check.error ? `: ${check.error}` : ''}`);
      allPassed = false;
    }
  }

  console[allPassed ? 'log' : 'error'](`${allPassed ? '✓' : '✗'} Candidate validation ${allPassed ? 'passed' : 'failed'}`);
  return allPassed;
}

export function promoteCandidate(stagingDir, targetDir, backupDir) {
  console.log(`Promoting candidate from ${stagingDir} to ${targetDir}...`);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const versionedBackupDir = join(backupDir, timestamp);

  if (existsSync(targetDir)) {
    console.log(`  Backing up current installation to ${versionedBackupDir}...`);
    mkdirSync(backupDir, { recursive: true });
    cpSync(targetDir, versionedBackupDir, { recursive: true });
    console.log('  ✓ Backup created');
  }

  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(stagingDir, targetDir, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });

  console.log(`✓ Candidate promoted to ${targetDir}`);
  return versionedBackupDir;
}

export function rollbackCandidate(backupDir, targetDir) {
  console.log(`Rolling back from ${backupDir}...`);
  if (!existsSync(backupDir)) throw new Error(`Backup directory not found: ${backupDir}`);

  const backups = readdirSync(backupDir)
    .filter((file) => statSync(join(backupDir, file)).isDirectory())
    .sort()
    .reverse();
  if (backups.length === 0) throw new Error('No backups available for rollback');

  const latestBackup = join(backupDir, backups[0]);
  console.log(`  Restoring from ${latestBackup}...`);

  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(latestBackup, targetDir, { recursive: true });
  rmSync(latestBackup, { recursive: true, force: true });

  const restoredVersion = readVersion(join(targetDir, 'VERSION'));
  console.log(`✓ Rollback complete, restored version: ${restoredVersion || 'unknown'}`);
  return { backupUsed: latestBackup, restoredVersion };
}

/**
 * Install stable launchers. `ocode` is the normal operator surface; the
 * `harness` launcher remains for deterministic/internal compatibility commands.
 */
export function installLaunchers(targetDir) {
  console.log('Installing launchers...');
  const binDir = CONFIG.binDir;
  mkdirSync(binDir, { recursive: true });

  const orientationBin = join(targetDir, 'orientation', 'bin', 'orient.mjs');
  const harnessBin = join(targetDir, 'harness-runtime', 'bin', 'harness.mjs');
  const ocodeBin = join(targetDir, 'harness-runtime', 'bin', 'ocode.mjs');

  const orientLauncher = join(binDir, 'orient');
  writeFileSync(orientLauncher, `#!/bin/sh\nset -eu\nexec node "${orientationBin}" "\${1:-\${PWD}}"\n`, 'utf8');
  execSync(`chmod +x "${orientLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ orient -> ${orientLauncher}`);

  const ocodeLauncher = join(binDir, 'ocode');
  const ocodeScript = `#!/bin/sh
set -eu
case "\${1:-}" in
  version|update|rollback)
    exec node "${harnessBin}" "\$@"
    ;;
  --version|-V)
    exec node "${harnessBin}" version
    ;;
  *)
    exec node "${ocodeBin}" "\$@"
    ;;
esac
`;
  writeFileSync(ocodeLauncher, ocodeScript, 'utf8');
  execSync(`chmod +x "${ocodeLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ ocode -> ${ocodeLauncher}`);

  const harnessLauncher = join(binDir, 'harness');
  writeFileSync(harnessLauncher, `#!/bin/sh\nset -eu\nexec node "${harnessBin}" "\${@}"\n`, 'utf8');
  execSync(`chmod +x "${harnessLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ harness -> ${harnessLauncher} (compatibility/internal)`);
}

export function installAgents(sourceDir) {
  console.log('Installing agents...');
  const sourceAgentsDir = join(sourceDir, 'agents');
  const targetAgentsDir = CONFIG.agentsDir;
  if (!existsSync(sourceAgentsDir)) throw new Error('Agents not found in source directory');

  mkdirSync(targetAgentsDir, { recursive: true });
  const agentFiles = readdirSync(sourceAgentsDir).filter((file) => file.endsWith('.md'));
  for (const agentFile of agentFiles) cpSync(join(sourceAgentsDir, agentFile), join(targetAgentsDir, agentFile));
  console.log(`  ✓ Installed ${agentFiles.length} agents to ${targetAgentsDir}`);
}

export function patchOpenCodeConfig(stagingDir) {
  console.log('Patching OpenCode configuration...');
  const sourceConfig = join(stagingDir, 'opencode-config', 'opencode.json');
  if (!existsSync(sourceConfig)) throw new Error('Source opencode.json not found in staging');

  const sourceConfigData = JSON.parse(readFileSync(sourceConfig, 'utf8'));
  const machineConfig = ensureMachineConfig();
  const governedRoles = loadAgentContracts({ baseDir: stagingDir }).manifest.roles.map((role) => role.id);

  let existingConfig = {};
  if (existsSync(CONFIG.opencodeConfig)) existingConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));

  const mergedConfig = mergeOpenCodeConfig(existingConfig, sourceConfigData, machineConfig, governedRoles);
  mkdirSync(dirname(CONFIG.opencodeConfig), { recursive: true });
  writeFileSync(CONFIG.opencodeConfig, JSON.stringify(mergedConfig, null, 2), 'utf8');

  console.log('  ✓ Ensured Ocode machine config');
  console.log('  ✓ Patched opencode.json with Ocode-owned entries');
}

export function configureGitExcludes() {
  console.log('Configuring Git excludes...');
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (!gitRoot) {
      console.log('  ✓ Not in a git repository, skipping');
      return;
    }

    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');
    if (!existsSync(excludeFile)) {
      writeFileSync(excludeFile, '# ocode-harness generated excludes\n', 'utf8');
      console.log('  ✓ Created .git/info/exclude');
    }

    const existingExcludes = readFileSync(excludeFile, 'utf8');
    const harnessExcludes = [
      '# ocode-harness generated excludes',
      '.opencode/orientation.json',
      '.opencode/orientation.md',
      '.opencode/run-ledger.jsonl',
      '# Do not track orientation artifacts and run ledger',
    ];
    if (!harnessExcludes.every((exclude) => existingExcludes.includes(exclude))) {
      writeFileSync(excludeFile, '\n' + harnessExcludes.join('\n') + '\n', 'utf8');
      console.log('  ✓ Added ocode-harness excludes to .git/info/exclude');
    } else console.log('  ✓ ocode-harness excludes already present');
  } catch {
    console.log('  ✓ Not in a git repository or git command failed, skipping');
  }
}

export function validatePostPromotion(targetDir) {
  console.log('Running post-promotion validation...');
  const checks = [];

  for (const launcher of ['orient', 'ocode', 'harness']) {
    try {
      const path = execSync(`which ${launcher}`, { encoding: 'utf8' }).trim();
      checks.push({ name: launcher, ok: true, path });
    } catch {
      checks.push({ name: launcher, ok: false });
    }
  }

  checks.push({ name: 'agents directory', ok: existsSync(CONFIG.agentsDir) });
  checks.push({ name: 'orientation package', ok: existsSync(CONFIG.orientationDir) });
  checks.push({ name: 'harness-runtime package', ok: existsSync(CONFIG.harnessRuntimeDir) });
  checks.push({ name: 'execution profiles', ok: existsSync(join(targetDir, 'profiles', 'free.json')) && existsSync(join(targetDir, 'profiles', 'hybrid.json')) });
  checks.push({ name: 'opencode configuration', ok: existsSync(CONFIG.opencodeConfig) });
  checks.push({ name: 'VERSION file', ok: existsSync(join(targetDir, 'VERSION')) });

  let allPassed = true;
  for (const check of checks) {
    if (check.ok) console.log(`  ✓ ${check.name}${check.path ? `: ${check.path}` : ''}`);
    else {
      console.error(`  ✗ ${check.name}`);
      allPassed = false;
    }
  }

  console[allPassed ? 'log' : 'error'](`${allPassed ? '✓' : '✗'} Post-promotion validation ${allPassed ? 'passed' : 'failed'}`);
  return allPassed;
}
