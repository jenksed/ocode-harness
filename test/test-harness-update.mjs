#!/usr/bin/env node
/**
 * test-harness-update.mjs
 * Test harness update command with staged promotion
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create isolated temp HOME for testing
const testHome = join(tmpdir(), `ocode-harness-test-update-${Date.now()}`);
const testBinDir = join(testHome, '.local', 'bin');
const testConfigDir = join(testHome, '.config', 'opencode');
const testShareDir = join(testHome, '.local', 'share');
const testHarnessRoot = join(testShareDir, 'ocode-harness');
const testStagingDir = join(testShareDir, 'ocode-harness-staging');
const testBackupDir = join(testShareDir, 'ocode-harness-backups');

// Create a fake source repository
const testSourceDir = join(testHome, 'source-repo');
const testSourceAgentsDir = join(testSourceDir, 'agents');
const testSourceOrientationDir = join(testSourceDir, 'packages', 'orientation');
const testSourceHarnessRuntimeDir = join(testSourceDir, 'packages', 'harness-runtime');
const testSourceDoctrineDir = join(testSourceDir, 'doctrine');
const testSourceOpencodeConfigDir = join(testSourceDir, 'opencode-config');
const testSourceInstallerDir = join(testSourceDir, 'installer');
const testSourceSkillsDir = join(testSourceDir, 'skills');
const testSourceProfilesDir = join(testSourceDir, 'profiles');

console.log('=== Test Harness Update ===\n');
console.log(`Test HOME: ${testHome}`);
console.log(`Test Source: ${testSourceDir}`);

// Copy original source files to test source repo
const sourceDir = resolve(__dirname, '..');
const agentsDir = join(sourceDir, 'agents');
const orientationDir = join(sourceDir, 'packages', 'orientation');
const harnessRuntimeDir = join(sourceDir, 'packages', 'harness-runtime');
const doctrineDir = join(sourceDir, 'doctrine');
const opencodeConfigDir = join(sourceDir, 'opencode-config');
const profilesDir = join(sourceDir, 'profiles');

// Create source repo structure
mkdirSync(testSourceAgentsDir, { recursive: true });
mkdirSync(testSourceOrientationDir, { recursive: true });
mkdirSync(join(testSourceOrientationDir, 'lib'), { recursive: true });
mkdirSync(join(testSourceOrientationDir, 'bin'), { recursive: true });
mkdirSync(testSourceHarnessRuntimeDir, { recursive: true });
mkdirSync(join(testSourceHarnessRuntimeDir, 'lib'), { recursive: true });
mkdirSync(join(testSourceHarnessRuntimeDir, 'bin'), { recursive: true });
mkdirSync(testSourceDoctrineDir, { recursive: true });
mkdirSync(testSourceOpencodeConfigDir, { recursive: true });
mkdirSync(testSourceInstallerDir, { recursive: true });
mkdirSync(testSourceSkillsDir, { recursive: true });
mkdirSync(testSourceProfilesDir, { recursive: true });

// Copy agents
const agentFiles = JSON.parse(readFileSync(join(agentsDir, 'manifest.json'), 'utf8')).roles.map((role) => role.file);
for (const agentFile of agentFiles) {
  copyFileSync(join(agentsDir, agentFile), join(testSourceAgentsDir, agentFile));
}
copyFileSync(join(agentsDir, 'manifest.json'), join(testSourceAgentsDir, 'manifest.json'));
writeFileSync(join(testSourceSkillsDir, '.gitkeep'), '', 'utf8');

// Copy orientation
copyFileSync(join(orientationDir, 'package.json'), join(testSourceOrientationDir, 'package.json'));
copyFileSync(join(orientationDir, 'README.md'), join(testSourceOrientationDir, 'README.md'));
copyFileSync(join(orientationDir, 'lib', 'orientation.mjs'), join(testSourceOrientationDir, 'lib', 'orientation.mjs'));
copyFileSync(join(orientationDir, 'lib', 'probe.mjs'), join(testSourceOrientationDir, 'lib', 'probe.mjs'));
copyFileSync(join(orientationDir, 'lib', 'render.mjs'), join(testSourceOrientationDir, 'lib', 'render.mjs'));
copyFileSync(join(orientationDir, 'bin', 'orient.mjs'), join(testSourceOrientationDir, 'bin', 'orient.mjs'));

// Copy harness-runtime
copyFileSync(join(harnessRuntimeDir, 'package.json'), join(testSourceHarnessRuntimeDir, 'package.json'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'identity.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'identity.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'lifecycle.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'lifecycle.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'ledger.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'ledger.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'evidence.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'evidence.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'composition.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'composition.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'closeout.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'closeout.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'verify.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'verify.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'activity.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'activity.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'governance.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'governance.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'permission-projection.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'permission-projection.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'admission.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'admission.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'agent-contract.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'agent-contract.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'opencode-integration.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'opencode-integration.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'execution.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'execution.mjs'));
for (const lib of ['skill-contract.mjs', 'skill-capsules.mjs', 'skill-projection.mjs', 'skill-runtime.mjs']) copyFileSync(join(harnessRuntimeDir, 'lib', lib), join(testSourceHarnessRuntimeDir, 'lib', lib));
copyFileSync(join(harnessRuntimeDir, 'lib', 'deploy.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'deploy.mjs'));
copyFileSync(join(harnessRuntimeDir, 'bin', 'harness.mjs'), join(testSourceHarnessRuntimeDir, 'bin', 'harness.mjs'));
copyFileSync(join(harnessRuntimeDir, 'bin', 'ocode.mjs'), join(testSourceHarnessRuntimeDir, 'bin', 'ocode.mjs'));

// Copy doctrine
copyFileSync(join(doctrineDir, 'agentic-agile.md'), join(testSourceDoctrineDir, 'agentic-agile.md'));
copyFileSync(join(doctrineDir, 'resource-policy.md'), join(testSourceDoctrineDir, 'resource-policy.md'));
copyFileSync(join(doctrineDir, 'policy-version.json'), join(testSourceDoctrineDir, 'policy-version.json'));

// Copy opencode-config
copyFileSync(join(opencodeConfigDir, 'opencode.json'), join(testSourceOpencodeConfigDir, 'opencode.json'));
copyFileSync(join(profilesDir, 'schema.json'), join(testSourceProfilesDir, 'schema.json'));
copyFileSync(join(profilesDir, 'free.json'), join(testSourceProfilesDir, 'free.json'));
copyFileSync(join(profilesDir, 'hybrid.json'), join(testSourceProfilesDir, 'hybrid.json'));

// Copy installer
copyFileSync(join(sourceDir, 'installer', 'install.mjs'), join(testSourceInstallerDir, 'install.mjs'));

// Copy root node_modules to test source repo for staging (used by stageCandidate during `harness update`)
const rootNodeModules = join(sourceDir, 'node_modules');
if (existsSync(rootNodeModules)) {
  cpSync(rootNodeModules, join(testSourceDir, 'node_modules'), { recursive: true });
}

// Write initial VERSION (v0.1.0)
writeFileSync(join(testSourceDir, 'VERSION'), 'v0.1.0\n', 'utf8');

// Set up initial installation (v0.1.0)
mkdirSync(testBinDir, { recursive: true });
mkdirSync(testConfigDir, { recursive: true });
mkdirSync(testHarnessRoot, { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation', 'lib'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation', 'bin'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime', 'lib'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime', 'bin'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'doctrine'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'agents'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'opencode-config'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'skills'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'profiles'), { recursive: true });
mkdirSync(join(testHarnessRoot, '.backup'), { recursive: true });
mkdirSync(join(testHarnessRoot, '.staging'), { recursive: true });

// Copy initial installation from source repo
copyFileSync(join(testSourceOrientationDir, 'package.json'), join(testHarnessRoot, 'orientation', 'package.json'));
copyFileSync(join(testSourceOrientationDir, 'README.md'), join(testHarnessRoot, 'orientation', 'README.md'));
copyFileSync(join(testSourceOrientationDir, 'lib', 'orientation.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'orientation.mjs'));
copyFileSync(join(testSourceOrientationDir, 'lib', 'probe.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'probe.mjs'));
copyFileSync(join(testSourceOrientationDir, 'lib', 'render.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'render.mjs'));
copyFileSync(join(testSourceOrientationDir, 'bin', 'orient.mjs'), join(testHarnessRoot, 'orientation', 'bin', 'orient.mjs'));

copyFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), join(testHarnessRoot, 'harness-runtime', 'package.json'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'identity.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'identity.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'lifecycle.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'lifecycle.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'ledger.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'ledger.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'evidence.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'evidence.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'composition.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'composition.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'closeout.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'closeout.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'verify.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'verify.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'activity.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'activity.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'governance.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'governance.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'permission-projection.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'permission-projection.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'admission.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'admission.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'agent-contract.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'agent-contract.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'opencode-integration.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'opencode-integration.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'execution.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'execution.mjs'));
for (const lib of ['skill-contract.mjs', 'skill-capsules.mjs', 'skill-projection.mjs', 'skill-runtime.mjs']) copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', lib), join(testHarnessRoot, 'harness-runtime', 'lib', lib));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'deploy.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'deploy.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'bin', 'harness.mjs'), join(testHarnessRoot, 'harness-runtime', 'bin', 'harness.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'bin', 'ocode.mjs'), join(testHarnessRoot, 'harness-runtime', 'bin', 'ocode.mjs'));

copyFileSync(join(testSourceDoctrineDir, 'agentic-agile.md'), join(testHarnessRoot, 'doctrine', 'agentic-agile.md'));
copyFileSync(join(testSourceDoctrineDir, 'resource-policy.md'), join(testHarnessRoot, 'doctrine', 'resource-policy.md'));
copyFileSync(join(testSourceDoctrineDir, 'policy-version.json'), join(testHarnessRoot, 'doctrine', 'policy-version.json'));

for (const agentFile of agentFiles) {
  copyFileSync(join(testSourceAgentsDir, agentFile), join(testHarnessRoot, 'agents', agentFile));
}
copyFileSync(join(testSourceAgentsDir, 'manifest.json'), join(testHarnessRoot, 'agents', 'manifest.json'));
copyFileSync(join(testSourceOpencodeConfigDir, 'opencode.json'), join(testHarnessRoot, 'opencode-config', 'opencode.json'));
copyFileSync(join(testSourceProfilesDir, 'schema.json'), join(testHarnessRoot, 'profiles', 'schema.json'));
copyFileSync(join(testSourceProfilesDir, 'free.json'), join(testHarnessRoot, 'profiles', 'free.json'));
copyFileSync(join(testSourceProfilesDir, 'hybrid.json'), join(testHarnessRoot, 'profiles', 'hybrid.json'));
writeFileSync(join(testHarnessRoot, 'skills', '.gitkeep'), '', 'utf8');

// Copy root node_modules to test harness-runtime for commander dependency
const testHarnessRuntimeNodeModules = join(testHarnessRoot, 'harness-runtime', 'node_modules');
if (existsSync(rootNodeModules)) {
  cpSync(rootNodeModules, testHarnessRuntimeNodeModules, { recursive: true });
}

// Copy agents
const testAgentsDir = join(testConfigDir, 'agents');
mkdirSync(testAgentsDir, { recursive: true });
for (const agentFile of agentFiles) {
  copyFileSync(join(testSourceAgentsDir, agentFile), join(testAgentsDir, agentFile));
}

// Write initial VERSION
writeFileSync(join(testHarnessRoot, 'VERSION'), 'v0.1.0\n', 'utf8');

// Create initial launchers
const orientLauncher = `#!/bin/sh
set -eu
exec node "${testHarnessRoot}/orientation/bin/orient.mjs" "\${1:-\${PWD}}"
`;
writeFileSync(join(testBinDir, 'orient'), orientLauncher, 'utf8');
execSync(`chmod +x "${join(testBinDir, 'orient')}"`, { stdio: 'inherit' });

const ocodeLauncher = `#!/bin/sh
set -eu
exec env OPENCODE_ENABLE_EXA=1 opencode "\${@}"
`;
writeFileSync(join(testBinDir, 'ocode'), ocodeLauncher, 'utf8');
execSync(`chmod +x "${join(testBinDir, 'ocode')}"`, { stdio: 'inherit' });

const harnessLauncher = `#!/bin/sh
set -eu
exec node "${testHarnessRoot}/harness-runtime/bin/harness.mjs" "\${@}"
`;
writeFileSync(join(testBinDir, 'harness'), harnessLauncher, 'utf8');
execSync(`chmod +x "${join(testBinDir, 'harness')}"`, { stdio: 'inherit' });

// Set up environment
const originalHome = process.env.HOME;
process.env.HOME = testHome;
process.env.PATH = `${testBinDir}:${process.env.PATH}`;

// Mock opencode
const mockOpencodePath = join(testBinDir, 'opencode');
writeFileSync(mockOpencodePath, `#!/bin/sh\necho "mock-1.0.0"\n`, 'utf8');
execSync(`chmod +x "${mockOpencodePath}"`, { stdio: 'inherit' });

// Mock git
const mockGitPath = join(testBinDir, 'git');
writeFileSync(mockGitPath, `#!/bin/sh\necho "mock-git-2.40.0"\n`, 'utf8');
execSync(`chmod +x "${mockGitPath}"`, { stdio: 'inherit' });

try {
  let allPassed = true;

  // Test 1: harness version shows initial version
  console.log('\n=== Test 1: Initial version ===\n');
  let result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  let output = JSON.parse(result.trim());
  console.log('Output:', JSON.stringify(output, null, 2));

  if (output.installed_version === 'v0.1.0') {
    console.log('✓ Initial installed version is v0.1.0');
  } else {
    console.error(`✗ Initial version mismatch: ${output.installed_version}`);
    allPassed = false;
  }

  // Test 2: Update with same version (--force)
  console.log('\n=== Test 2: Update with --force (same version) ===\n');
  try {
    result = execSync(`harness update --force`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, cwd: testSourceDir });
    console.log('Output:\n', result);
    console.log('✓ Update with --force succeeded');
  } catch (err) {
    console.error('✗ Update with --force failed:', err.message);
    allPassed = false;
  }

  // Verify version unchanged
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  if (output.installed_version === 'v0.1.0') {
    console.log('✓ Version still v0.1.0 after force update');
  } else {
    console.error(`✗ Version changed unexpectedly: ${output.installed_version}`);
    allPassed = false;
  }

  // Test 3: Modify source repo to v0.2.0
  console.log('\n=== Test 3: Update to new version (v0.2.0) ===\n');
  writeFileSync(join(testSourceDir, 'VERSION'), 'v0.2.0\n', 'utf8');

  // Also update the source harness-runtime package.json version for detection
  const hrPkg = JSON.parse(readFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), 'utf8'));
  hrPkg.version = '0.2.0';
  writeFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), JSON.stringify(hrPkg, null, 2), 'utf8');

  try {
    result = execSync(`harness update`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, cwd: testSourceDir });
    console.log('Output:\n', result);
    console.log('✓ Update to v0.2.0 succeeded');
  } catch (err) {
    console.error('✗ Update to v0.2.0 failed:', err.message);
    allPassed = false;
  }

  // Verify new version
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  console.log('Post-update version:', JSON.stringify(output, null, 2));

  if (output.installed_version === 'v0.2.0') {
    console.log('✓ Installed version updated to v0.2.0');
  } else {
    console.error(`✗ Installed version not updated: ${output.installed_version}`);
    allPassed = false;
  }

  if (output.source_version === 'v0.2.0') {
    console.log('✓ Source version matches');
  } else {
    console.error(`✗ Source version mismatch: ${output.source_version}`);
    allPassed = false;
  }

  if (output.source_differs === false) {
    console.log('✓ source_differs false after successful update');
  } else {
    console.error('✗ source_differs should be false after update');
    allPassed = false;
  }

  // Test 4: Verify launchers still work and reference installed paths
  console.log('\n=== Test 4: Launchers reference installed paths ===\n');
  const orientContent = readFileSync(join(testBinDir, 'orient'), 'utf8');
  const ocodeContent = readFileSync(join(testBinDir, 'ocode'), 'utf8');
  const harnessContent = readFileSync(join(testBinDir, 'harness'), 'utf8');

  if (orientContent.includes(testHarnessRoot)) {
    console.log('✓ orient launcher references installed path');
  } else {
    console.error('✗ orient launcher broken');
    allPassed = false;
  }

  if (harnessContent.includes(testHarnessRoot)) {
    console.log('✓ harness launcher references installed path');
  } else {
    console.error('✗ harness launcher broken');
    allPassed = false;
  }

  // Test 5: Verify backup was created
  console.log('\n=== Test 5: Backup created ===\n');
  if (existsSync(testBackupDir)) {
    const backupContents = readdirSync(testBackupDir);
    if (backupContents.length > 0) {
      console.log(`✓ Backup created: ${backupContents.join(', ')}`);
    } else {
      console.error('✗ No backup found');
      allPassed = false;
    }
  } else {
    console.error('✗ Backup directory not created');
    allPassed = false;
  }

  // Test 6: Verify agents were updated
  console.log('\n=== Test 6: Agents updated ===\n');
  const orchestratorContent = readFileSync(join(testAgentsDir, 'orchestrator.md'), 'utf8');
  if (orchestratorContent.length > 0) {
    console.log('✓ Agents present after update');
  } else {
    console.error('✗ Agents missing after update');
    allPassed = false;
  }

  // Test 7: Update idempotency - repeated update safe
  console.log('\n=== Test 7: Repeated update is safe ===\n');
  try {
    result = execSync(`harness update`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, cwd: testSourceDir });
    console.log('Output:\n', result);
    console.log('✓ Repeated update succeeded (no-op)');
  } catch (err) {
    console.error('✗ Repeated update failed:', err.message);
    allPassed = false;
  }

  // Version should still be v0.2.0
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  if (output.installed_version === 'v0.2.0') {
    console.log('✓ Version stable after repeated update');
  } else {
    console.error(`✗ Version changed after repeated update: ${output.installed_version}`);
    allPassed = false;
  }

  // Cleanup
  console.log('\n=== Cleanup ===\n');
  rmSync(testHome, { recursive: true, force: true });

  if (allPassed) {
    console.log('\n✓ All tests passed');
    process.exit(0);
  } else {
    console.error('\n✗ Some tests failed');
    process.exit(1);
  }

} catch (error) {
  console.error('\n✗ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  process.env.HOME = originalHome;
}
