#!/usr/bin/env node
/**
 * ocode-harness installer
 * Deterministic installation of the ocode-harness runtime
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { env } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - respect HOME environment variable for test isolation
const HOME = env.HOME || homedir();
const CONFIG = {
  harnessRoot: join(HOME, '.local', 'share', 'ocode-harness'),
  binDir: join(HOME, '.local', 'bin'),
  agentsDir: join(HOME, '.config', 'opencode', 'agents'),
  opencodeConfig: join(HOME, '.config', 'opencode', 'opencode.json'),
  orientationDir: join(HOME, '.local', 'share', 'ocode-harness', 'orientation'),
  backupDir: join(HOME, '.local', 'share', 'ocode-harness', 'backups'),
};

/**
 * Preflight checks
 */
async function preflightChecks() {
  console.log('Running preflight checks...\n');

  // Check Node.js
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    console.log(`✓ Node.js: ${nodeVersion}`);
  } catch (err) {
    throw new Error('Node.js is required but not found in PATH');
  }

  // Check opencode
  try {
    const opencodeVersion = execSync('opencode --version', { encoding: 'utf8' }).trim();
    console.log(`✓ opencode: ${opencodeVersion}`);
  } catch (err) {
    throw new Error('opencode is required but not found in PATH');
  }

  // Check git
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
    console.log(`✓ git: ${gitVersion}`);
  } catch (err) {
    throw new Error('git is required but not found in PATH');
  }

  console.log();
}

/**
 * Backup existing managed config
 */
function backupExistingConfig() {
  console.log('Checking for existing managed configuration...\n');

  const backupFile = join(CONFIG.backupDir, `opencode-backup-${Date.now()}.json`);

  if (!existsSync(CONFIG.opencodeConfig)) {
    console.log('✓ No existing opencode configuration to backup');
    return null;
  }

  // Read existing config
  const existingConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));

  // Backup the entire file
  mkdirSync(CONFIG.backupDir, { recursive: true });
  writeFileSync(backupFile, JSON.stringify(existingConfig, null, 2), 'utf8');

  console.log(`✓ Backed up existing configuration to: ${backupFile}`);
  console.log('  You can restore this backup using: ocode-harness restore');
  console.log();

  return backupFile;
}

/**
 * Install harness runtime
 */
function installHarnessRuntime() {
  console.log('Installing harness runtime...\n');

  const sourceDir = resolve(__dirname, '..');

  // Create harness root directory
  mkdirSync(CONFIG.harnessRoot, { recursive: true });

  // Copy orientation package
  const orientationSrc = join(sourceDir, 'packages', 'orientation');
  const orientationDest = join(CONFIG.harnessRoot, 'orientation');

  if (existsSync(orientationDest)) {
    console.log('✓ Orientation package already installed');
  } else {
    // Create orientation subdirectories
    mkdirSync(join(orientationDest, 'lib'), { recursive: true });
    mkdirSync(join(orientationDest, 'bin'), { recursive: true });
    mkdirSync(join(orientationDest, 'test'), { recursive: true });

    // Copy orientation package
    copyFileSync(
      join(orientationSrc, 'package.json'),
      join(orientationDest, 'package.json')
    );
    copyFileSync(
      join(orientationSrc, 'README.md'),
      join(orientationDest, 'README.md')
    );

    // Copy lib directory
    copyFileSync(
      join(orientationSrc, 'lib', 'orientation.mjs'),
      join(orientationDest, 'lib', 'orientation.mjs')
    );
    copyFileSync(
      join(orientationSrc, 'lib', 'probe.mjs'),
      join(orientationDest, 'lib', 'probe.mjs')
    );
    copyFileSync(
      join(orientationSrc, 'lib', 'render.mjs'),
      join(orientationDest, 'lib', 'render.mjs')
    );

    // Copy bin directory
    copyFileSync(
      join(orientationSrc, 'bin', 'orient.mjs'),
      join(orientationDest, 'bin', 'orient.mjs')
    );

    // Copy test directory
    copyFileSync(
      join(orientationSrc, 'test', 'orient.test.mjs'),
      join(orientationDest, 'test', 'orient.test.mjs')
    );

    console.log('✓ Installed orientation package');
  }

  // Copy agents
  const agentsSrc = join(sourceDir, 'agents');
  const agentsDest = join(CONFIG.agentsDir);

  if (!existsSync(agentsDest)) {
    mkdirSync(agentsDest, { recursive: true });
  }

  const agentFiles = [
    'orchestrator.md',
    'planner.md',
    'coder.md',
    'verifier.md',
    'reviewer.md',
    'researcher.md',
    'judge.md',
  ];

  for (const agentFile of agentFiles) {
    const srcPath = join(agentsSrc, agentFile);
    const destPath = join(agentsDest, agentFile);

    if (existsSync(destPath)) {
      console.log(`✓ Agent ${agentFile} already installed`);
    } else {
      copyFileSync(srcPath, destPath);
      console.log(`✓ Installed agent: ${agentFile}`);
    }
  }

  console.log();
}

/**
 * Install orient and ocode binaries
 */
function installBinaries() {
  console.log('Installing binaries...\n');

  // Ensure bin directory exists
  mkdirSync(CONFIG.binDir, { recursive: true });

  const sourceDir = resolve(__dirname, '..');

  // Create orient binary
  const orientBin = join(CONFIG.binDir, 'orient');
  const orientScript = `#!/bin/sh
set -eu
exec node "${CONFIG.orientationDir}/bin/orient.mjs" "\${1:-\${PWD}}"
`;

  writeFileSync(orientBin, orientScript, 'utf8');
  execSync(`chmod +x "${orientBin}"`, { stdio: 'inherit' });
  console.log(`✓ Installed orient to: ${orientBin}`);

  // Create ocode binary
  const ocodeBin = join(CONFIG.binDir, 'ocode');
  const ocodeScript = `#!/bin/sh
set -eu

REQUESTED="\${PWD}"

echo "=== PROJECT ORIENTATION ==="
orient "\${REQUESTED}"

dir="\${REQUESTED}"
PROJECT_ROOT=""
while true; do
  if [ -f "\${dir}/.opencode/orientation.json" ] && [ -f "\${dir}/.opencode/orientation.md" ]; then
    PROJECT_ROOT="\${dir}"
    break
  fi
  [ "\${dir}" = "/" ] && break
  dir="\$(dirname "\${dir}")"
done

if [ -z "\${PROJECT_ROOT}" ]; then
  echo "ERROR: orientation completed but no orientation artifact was found." >&2
  exit 1
fi

echo "=== ORIENTATION READY ==="
echo "project root: \${PROJECT_ROOT}"
echo "context:      \${PROJECT_ROOT}/.opencode/orientation.md"
echo

cd "\${PROJECT_ROOT}"
exec env OPENCODE_ENABLE_EXA=1 opencode "\${@}"
`;

  writeFileSync(ocodeBin, ocodeScript, 'utf8');
  execSync(`chmod +x "${ocodeBin}"`, { stdio: 'inherit' });
  console.log(`✓ Installed ocode to: ${ocodeBin}`);

  console.log();
}

/**
 * Patch OpenCode config
 */
function patchOpenCodeConfig(backupFile) {
  console.log('Patching OpenCode configuration...\n');

  const sourceConfig = resolve(__dirname, '..', 'opencode-config', 'opencode.json');

  if (!existsSync(sourceConfig)) {
    throw new Error('Source opencode.json not found');
  }

  // Read source config
  const sourceConfigData = JSON.parse(readFileSync(sourceConfig, 'utf8'));

  // Read existing config if it exists
  let existingConfig;
  if (existsSync(CONFIG.opencodeConfig)) {
    existingConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));
  } else {
    existingConfig = {};
  }

  // Merge configs (source overrides existing, but preserve unrelated user config)
  const mergedConfig = {
    ...existingConfig,
    ...sourceConfigData,
  };

  // Ensure subagent_depth is 1
  mergedConfig.subagent_depth = 1;

  // Write patched config
  writeFileSync(CONFIG.opencodeConfig, JSON.stringify(mergedConfig, null, 2), 'utf8');

  console.log('✓ Patched opencode.json');
  console.log('  - Set subagent_depth to 1');
  console.log('  - Preserved existing user configuration');
  console.log();
}

/**
 * Configure generated orientation Git excludes
 */
function configureGitExcludes() {
  console.log('Configuring Git excludes...\n');

  // Check if we're in a git repository
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    if (!gitRoot) {
      console.log('✓ Not in a git repository, skipping git excludes configuration');
      console.log();
      return;
    }

    // Check if .git/info/exclude exists
    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');

    if (!existsSync(excludeFile)) {
      // Create the file
      writeFileSync(excludeFile, '# ocode-harness generated excludes\n', 'utf8');
      console.log('✓ Created .git/info/exclude');
    } else {
      // Read existing excludes
      const existingExcludes = readFileSync(excludeFile, 'utf8');

      // Add ocode-harness excludes if not already present
      const harnessExcludes = [
        '# ocode-harness generated excludes',
        '.opencode/orientation.json',
        '.opencode/orientation.md',
        '# Do not track orientation artifacts',
      ];

      const hasHarnessExcludes = harnessExcludes.every(exclude => existingExcludes.includes(exclude));

      if (!hasHarnessExcludes) {
        // Append to existing file
        writeFileSync(excludeFile, '\n' + harnessExcludes.join('\n') + '\n', 'utf8');
        console.log('✓ Added ocode-harness excludes to .git/info/exclude');
      } else {
        console.log('✓ ocode-harness excludes already present in .git/info/exclude');
      }
    }

    console.log();
  } catch (err) {
    // Not in git repo or git command failed
    console.log('✓ Not in a git repository or git command failed, skipping git excludes configuration');
    console.log();
  }
}

/**
 * Validate installation
 */
function validateInstallation() {
  console.log('Validating installation...\n');

  const checks = [];

  // Check orient binary
  try {
    const orientPath = execSync('which orient', { encoding: 'utf8' }).trim();
    checks.push({ name: 'orient', path: orientPath, ok: true });
  } catch (err) {
    checks.push({ name: 'orient', path: null, ok: false });
  }

  // Check ocode binary
  try {
    const ocodePath = execSync('which ocode', { encoding: 'utf8' }).trim();
    checks.push({ name: 'ocode', path: ocodePath, ok: true });
  } catch (err) {
    checks.push({ name: 'ocode', path: null, ok: false });
  }

  // Check agents directory
  const agentsDirExists = existsSync(CONFIG.agentsDir);
  checks.push({ name: 'agents directory', path: CONFIG.agentsDir, ok: agentsDirExists });

  // Check orientation package
  const orientationDirExists = existsSync(CONFIG.orientationDir);
  checks.push({ name: 'orientation package', path: CONFIG.orientationDir, ok: orientationDirExists });

  // Check opencode config
  const opencodeConfigExists = existsSync(CONFIG.opencodeConfig);
  checks.push({ name: 'opencode configuration', path: CONFIG.opencodeConfig, ok: opencodeConfigExists });

  // Report results
  for (const check of checks) {
    if (check.ok) {
      console.log(`✓ ${check.name}: ${check.path}`);
    } else {
      console.error(`✗ ${check.name}: not found`);
    }
  }

  console.log();

  // Return overall status
  return checks.every(check => check.ok);
}

/**
 * Main installation function
 */
async function main() {
  console.log('=== ocode-harness Installer ===\n');
  console.log(`Installation directory: ${CONFIG.harnessRoot}`);
  console.log(`Binaries directory: ${CONFIG.binDir}`);
  console.log(`Agents directory: ${CONFIG.agentsDir}`);
  console.log(`Configuration: ${CONFIG.opencodeConfig}`);
  console.log();

  try {
    // Preflight checks
    await preflightChecks();

    // Backup existing config
    const backupFile = backupExistingConfig();

    // Install harness runtime
    installHarnessRuntime();

    // Install binaries
    installBinaries();

    // Patch OpenCode config
    patchOpenCodeConfig(backupFile);

    // Configure Git excludes
    configureGitExcludes();

    // Validate installation
    const isValid = validateInstallation();

    if (isValid) {
      console.log('=== Installation Complete ===\n');
      console.log('✓ All checks passed');
      console.log();
      console.log('Next steps:');
      console.log('  1. Add ~/.local/bin to your PATH if not already present');
      console.log('  2. Run "orient ." in your project directory to generate orientation');
      console.log('  3. Run "ocode" to start the harness');
      console.log();
      if (backupFile) {
        console.log('Backup created at: ' + backupFile);
        console.log('To restore: ocode-harness restore');
      }
    } else {
      console.log('=== Installation Complete but with Issues ===\n');
      console.log('Some checks failed. Please review the output above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n✗ Installation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run installation
main();
