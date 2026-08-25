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
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { env } from 'node:process';
import { loadAgentContracts } from './agent-contract.mjs';
import { loadBindingProfile } from './opencode-integration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration paths
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

/**
 * Read version from VERSION file
 */
export function readVersion(versionPath) {
  if (!existsSync(versionPath)) {
    return null;
  }
  return readFileSync(versionPath, 'utf8').trim();
}

/**
 * Write version to VERSION file
 */
export function writeVersion(targetDir, version) {
  const versionPath = join(targetDir, 'VERSION');
  writeFileSync(versionPath, version + '\n', 'utf8');
}

/**
 * Find source repository by walking up from startDir
 * Looks for VERSION + installer/install.mjs + agents/ + packages/
 */
export function findSourceRepo(startDir) {
  let dir = resolve(startDir);
  const requiredComponents = [
    'VERSION',
    join('installer', 'install.mjs'),
    'agents',
    'packages',
  ];

  while (true) {
    let allFound = true;
    for (const component of requiredComponents) {
      if (!existsSync(join(dir, component))) {
        allFound = false;
        break;
      }
    }
    if (allFound) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Copy directory recursively with cpSync (Node 18+)
 */
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeOwned(existing, owned) {
  if (!isPlainObject(existing)) {
    return structuredClone(owned);
  }
  const merged = { ...existing };
  for (const [key, value] of Object.entries(owned)) {
    if (isPlainObject(value) && isPlainObject(existing[key])) {
      merged[key] = deepMergeOwned(existing[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function readMachineConfig(configPath = CONFIG.machineConfig) {
  if (!existsSync(configPath)) {
    return structuredClone(DEFAULT_MACHINE_CONFIG);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Malformed Ocode machine config at ${configPath}: ${err.message}`);
  }

  return deepMergeOwned(DEFAULT_MACHINE_CONFIG, parsed);
}

export function ensureMachineConfig(configPath = CONFIG.machineConfig) {
  if (existsSync(configPath)) {
    return readMachineConfig(configPath);
  }

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
      if (!Object.hasOwn(currentModels, model)) {
        delete mergedModels[model];
      }
    }
  }
  if (merged.provider?.freellmapi?.options) {
    delete merged.provider.freellmapi.options.apiKey;
  }
  return merged;
}

/**
 * Stage candidate from source to staging directory
 * Copies all components: orientation, harness-runtime, doctrine, agents, VERSION, opencode-config
 */
export function stageCandidate(sourceRoot, stagingDir, version) {
  console.log(`Staging candidate from ${sourceRoot} to ${stagingDir}...`);

  // Clean staging dir
  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  mkdirSync(stagingDir, { recursive: true });

  // Copy orientation package
  copyDir(join(sourceRoot, 'packages', 'orientation'), join(stagingDir, 'orientation'));

  // Copy harness-runtime package
  copyDir(join(sourceRoot, 'packages', 'harness-runtime'), join(stagingDir, 'harness-runtime'));

  // Copy root node_modules to harness-runtime for dependencies
  copyDir(join(sourceRoot, 'node_modules'), join(stagingDir, 'harness-runtime', 'node_modules'));

  // Copy doctrine
  copyDir(join(sourceRoot, 'doctrine'), join(stagingDir, 'doctrine'));

  // Copy agents
  copyDir(join(sourceRoot, 'agents'), join(stagingDir, 'agents'));

  // Copy deterministic execution profiles
  copyDir(join(sourceRoot, 'profiles'), join(stagingDir, 'profiles'));

  // Copy skills placeholder/owned skills when present
  copyDir(join(sourceRoot, 'skills'), join(stagingDir, 'skills'));

  // Copy opencode-config
  copyDir(join(sourceRoot, 'opencode-config'), join(stagingDir, 'opencode-config'));

  // Write VERSION
  writeVersion(stagingDir, version);

  console.log(`✓ Staged candidate version ${version}`);
  return stagingDir;
}

/**
 * Validate candidate by running doctor checks against staging directory
 */
export function validateCandidate(stagingDir) {
  console.log(`Validating candidate at ${stagingDir}...`);

  const checks = [];

  // Check orientation package
  const orientationDir = join(stagingDir, 'orientation');
  const orientationPackageJson = join(orientationDir, 'package.json');
  if (existsSync(orientationPackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(orientationPackageJson, 'utf8'));
      checks.push({ name: 'orientation package', ok: true, version: pkg.version });
    } catch (err) {
      checks.push({ name: 'orientation package', ok: false, error: err.message });
    }
  } else {
    checks.push({ name: 'orientation package', ok: false, error: 'not found' });
  }

  // Check orientation bin
  const orientBin = join(orientationDir, 'bin', 'orient.mjs');
  checks.push({ name: 'orientation bin', ok: existsSync(orientBin) });

  // Check orientation lib files
  const orientationLibs = ['orientation.mjs', 'probe.mjs', 'render.mjs'];
  for (const lib of orientationLibs) {
    const libPath = join(orientationDir, 'lib', lib);
    checks.push({ name: `orientation lib/${lib}`, ok: existsSync(libPath) });
  }

  // Check harness-runtime package
  const harnessRuntimeDir = join(stagingDir, 'harness-runtime');
  const harnessRuntimePackageJson = join(harnessRuntimeDir, 'package.json');
  if (existsSync(harnessRuntimePackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(harnessRuntimePackageJson, 'utf8'));
      checks.push({ name: 'harness-runtime package', ok: true, version: pkg.version });
    } catch (err) {
      checks.push({ name: 'harness-runtime package', ok: false, error: err.message });
    }
  } else {
    checks.push({ name: 'harness-runtime package', ok: false, error: 'not found' });
  }

  // Check harness-runtime lib files
  const harnessLibs = ['identity.mjs', 'lifecycle.mjs', 'ledger.mjs', 'evidence.mjs', 'composition.mjs', 'closeout.mjs', 'verify.mjs', 'governance.mjs', 'permission-projection.mjs', 'admission.mjs', 'agent-contract.mjs', 'opencode-integration.mjs', 'execution.mjs'];
  for (const lib of harnessLibs) {
    const libPath = join(harnessRuntimeDir, 'lib', lib);
    checks.push({ name: `harness-runtime lib/${lib}`, ok: existsSync(libPath) });
  }

  // Check harness-runtime bin
  const harnessBin = join(harnessRuntimeDir, 'bin', 'harness.mjs');
  checks.push({ name: 'harness-runtime bin/harness.mjs', ok: existsSync(harnessBin) });
  checks.push({ name: 'harness-runtime bin/ocode.mjs', ok: existsSync(join(harnessRuntimeDir, 'bin', 'ocode.mjs')) });

  // Check doctrine
  const doctrineDir = join(stagingDir, 'doctrine');
  const doctrineFiles = ['agentic-agile.md', 'resource-policy.md', 'policy-version.json'];
  for (const file of doctrineFiles) {
    const filePath = join(doctrineDir, file);
    checks.push({ name: `doctrine/${file}`, ok: existsSync(filePath) });
  }

  // Validate policy-version.json
  const policyVersionPath = join(doctrineDir, 'policy-version.json');
  if (existsSync(policyVersionPath)) {
    try {
      const manifest = JSON.parse(readFileSync(policyVersionPath, 'utf8'));
      const hasRequired = 'policy_version' in manifest && 'doctrine' in manifest && 'resources' in manifest;
      checks.push({ name: 'doctrine/policy-version.json valid', ok: hasRequired });
    } catch (err) {
      checks.push({ name: 'doctrine/policy-version.json valid', ok: false, error: err.message });
    }
  } else {
    checks.push({ name: 'doctrine/policy-version.json', ok: false, error: 'not found' });
  }

  // Check agents
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

  // Check skills directory is staged when repository has one
  checks.push({ name: 'skills directory', ok: existsSync(join(stagingDir, 'skills')) });

  // Check opencode-config
  const opencodeConfigPath = join(stagingDir, 'opencode-config', 'opencode.json');
  checks.push({ name: 'opencode-config/opencode.json', ok: existsSync(opencodeConfigPath) });

  // Check VERSION
  const versionPath = join(stagingDir, 'VERSION');
  const versionContent = readVersion(versionPath);
  checks.push({ name: 'VERSION file', ok: !!versionContent, version: versionContent });

  // Report results
  let allPassed = true;
  for (const check of checks) {
    if (check.ok) {
      if (check.version) {
        console.log(`  ✓ ${check.name}: ${check.version}`);
      } else {
        console.log(`  ✓ ${check.name}`);
      }
    } else {
      console.error(`  ✗ ${check.name}${check.error ? `: ${check.error}` : ''}`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log(`✓ Candidate validation passed`);
  } else {
    console.error(`✗ Candidate validation failed`);
  }

  return allPassed;
}

/**
 * Promote candidate from staging to target with atomic move and backup
 */
export function promoteCandidate(stagingDir, targetDir, backupDir) {
  console.log(`Promoting candidate from ${stagingDir} to ${targetDir}...`);

  // Create timestamped backup of current installation
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const versionedBackupDir = join(backupDir, timestamp);

  if (existsSync(targetDir)) {
    console.log(`  Backing up current installation to ${versionedBackupDir}...`);
    mkdirSync(backupDir, { recursive: true });
    cpSync(targetDir, versionedBackupDir, { recursive: true });
    console.log(`  ✓ Backup created`);
  }

  // Atomic promotion: remove target and move staging to target
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(stagingDir, targetDir, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });

  console.log(`✓ Candidate promoted to ${targetDir}`);
  return versionedBackupDir;
}

/**
 * Rollback to previous installation from backup
 */
export function rollbackCandidate(backupDir, targetDir) {
  console.log(`Rolling back from ${backupDir}...`);

  if (!existsSync(backupDir)) {
    throw new Error(`Backup directory not found: ${backupDir}`);
  }

  // Find latest backup
  const backups = readdirSync(backupDir)
    .filter(f => statSync(join(backupDir, f)).isDirectory())
    .sort()
    .reverse();

  if (backups.length === 0) {
    throw new Error('No backups available for rollback');
  }

  const latestBackup = join(backupDir, backups[0]);
  console.log(`  Restoring from ${latestBackup}...`);

  // Restore
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(latestBackup, targetDir, { recursive: true });

  // Remove consumed backup so subsequent rollbacks progress to earlier versions
  rmSync(latestBackup, { recursive: true, force: true });

  // Read restored version
  const restoredVersion = readVersion(join(targetDir, 'VERSION'));
  console.log(`✓ Rollback complete, restored version: ${restoredVersion || 'unknown'}`);

  return { backupUsed: latestBackup, restoredVersion };
}

/**
 * Install launchers (ocode, orient, harness) pointing to installed stable paths
 */
export function installLaunchers(targetDir) {
  console.log('Installing launchers...');

  const binDir = CONFIG.binDir;
  mkdirSync(binDir, { recursive: true });

  const orientationBin = join(targetDir, 'orientation', 'bin', 'orient.mjs');
  const harnessBin = join(targetDir, 'harness-runtime', 'bin', 'harness.mjs');
  const ocodeBin = join(targetDir, 'harness-runtime', 'bin', 'ocode.mjs');

  // orient launcher
  const orientLauncher = join(binDir, 'orient');
  const orientScript = `#!/bin/sh
set -eu
exec node "${orientationBin}" "\${1:-\${PWD}}"
`;
  writeFileSync(orientLauncher, orientScript, 'utf8');
  execSync(`chmod +x "${orientLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ orient -> ${orientLauncher}`);

  // ocode launcher
  const ocodeLauncher = join(binDir, 'ocode');
  const ocodeScript = `#!/bin/sh
set -eu
exec node "${ocodeBin}" "\${@}"
`;
  writeFileSync(ocodeLauncher, ocodeScript, 'utf8');
  execSync(`chmod +x "${ocodeLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ ocode -> ${ocodeLauncher}`);

  // harness launcher
  const harnessLauncher = join(binDir, 'harness');
  const harnessScript = `#!/bin/sh
set -eu
exec node "${harnessBin}" "\${@}"
`;
  writeFileSync(harnessLauncher, harnessScript, 'utf8');
  execSync(`chmod +x "${harnessLauncher}"`, { stdio: 'inherit' });
  console.log(`  ✓ harness -> ${harnessLauncher}`);
}

/**
 * Install agents to ~/.config/opencode/agents
 */
export function installAgents(sourceDir) {
  console.log('Installing agents...');

  const sourceAgentsDir = join(sourceDir, 'agents');
  const targetAgentsDir = CONFIG.agentsDir;

  if (!existsSync(sourceAgentsDir)) {
    throw new Error('Agents not found in source directory');
  }

  mkdirSync(targetAgentsDir, { recursive: true });

  const agentFiles = readdirSync(sourceAgentsDir).filter(f => f.endsWith('.md'));
  for (const agentFile of agentFiles) {
    cpSync(join(sourceAgentsDir, agentFile), join(targetAgentsDir, agentFile));
  }

  console.log(`  ✓ Installed ${agentFiles.length} agents to ${targetAgentsDir}`);
}

/**
 * Patch OpenCode config from staging
 */
export function patchOpenCodeConfig(stagingDir) {
  console.log('Patching OpenCode configuration...');

  const sourceConfig = join(stagingDir, 'opencode-config', 'opencode.json');
  if (!existsSync(sourceConfig)) {
    throw new Error('Source opencode.json not found in staging');
  }

  const sourceConfigData = JSON.parse(readFileSync(sourceConfig, 'utf8'));
  const machineConfig = ensureMachineConfig();
  const governedRoles = loadAgentContracts({ baseDir: stagingDir }).manifest.roles.map((role) => role.id);

  let existingConfig = {};
  if (existsSync(CONFIG.opencodeConfig)) {
    existingConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));
  }

  const mergedConfig = mergeOpenCodeConfig(existingConfig, sourceConfigData, machineConfig, governedRoles);

  mkdirSync(dirname(CONFIG.opencodeConfig), { recursive: true });
  writeFileSync(CONFIG.opencodeConfig, JSON.stringify(mergedConfig, null, 2), 'utf8');

  console.log('  ✓ Ensured Ocode machine config');
  console.log('  ✓ Patched opencode.json with Ocode-owned entries');
}

/**
 * Configure Git excludes
 */
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

    const hasHarnessExcludes = harnessExcludes.every(exclude => existingExcludes.includes(exclude));

    if (!hasHarnessExcludes) {
      writeFileSync(excludeFile, '\n' + harnessExcludes.join('\n') + '\n', 'utf8');
      console.log('  ✓ Added ocode-harness excludes to .git/info/exclude');
    } else {
      console.log('  ✓ ocode-harness excludes already present');
    }
  } catch (err) {
    console.log('  ✓ Not in a git repository or git command failed, skipping');
  }
}

/**
 * Run post-promotion doctor validation
 */
export function validatePostPromotion(targetDir) {
  console.log('Running post-promotion validation...');

  const checks = [];

  // Check launchers
  for (const launcher of ['orient', 'ocode', 'harness']) {
    try {
      const path = execSync(`which ${launcher}`, { encoding: 'utf8' }).trim();
      checks.push({ name: launcher, ok: true, path });
    } catch (err) {
      checks.push({ name: launcher, ok: false });
    }
  }

  // Check agents directory
  checks.push({ name: 'agents directory', ok: existsSync(CONFIG.agentsDir) });

  // Check orientation package
  checks.push({ name: 'orientation package', ok: existsSync(CONFIG.orientationDir) });

  // Check harness-runtime package
  checks.push({ name: 'harness-runtime package', ok: existsSync(CONFIG.harnessRuntimeDir) });
  checks.push({ name: 'execution profiles', ok: existsSync(join(targetDir, 'profiles', 'free.json')) && existsSync(join(targetDir, 'profiles', 'hybrid.json')) });

  // Check opencode config
  checks.push({ name: 'opencode configuration', ok: existsSync(CONFIG.opencodeConfig) });

  // Check VERSION file
  const versionPath = join(targetDir, 'VERSION');
  checks.push({ name: 'VERSION file', ok: existsSync(versionPath) });

  let allPassed = true;
  for (const check of checks) {
    if (check.ok) {
      console.log(`  ✓ ${check.name}${check.path ? `: ${check.path}` : ''}`);
    } else {
      console.error(`  ✗ ${check.name}`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('✓ Post-promotion validation passed');
  } else {
    console.error('✗ Post-promotion validation failed');
  }

  return allPassed;
}
