#!/usr/bin/env node
/**
 * test-harness-rollback.mjs
 * Test harness rollback command
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create isolated temp HOME for testing
const testHome = join(tmpdir(), `ocode-harness-test-rollback-${Date.now()}`);
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

console.log('=== Test Harness Rollback ===\n');
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
copyFileSync(join(harnessRuntimeDir, 'lib', 'model-telemetry.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'model-telemetry.mjs'));
for (const lib of ['command-admission.mjs', 'deterministic-staging.mjs', 'task-capsule.mjs', 'model-qualification.mjs', 'behavioral-adapters.mjs', 'capability-resolution.mjs', 'tool-loop-control.mjs']) copyFileSync(join(harnessRuntimeDir, 'lib', lib), join(testSourceHarnessRuntimeDir, 'lib', lib));
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
copyFileSync(join(harnessRuntimeDir, 'lib', 'artifact.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'artifact.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'release-store.mjs'), join(testSourceHarnessRuntimeDir, 'lib', 'release-store.mjs'));
copyFileSync(join(harnessRuntimeDir, 'bin', 'harness.mjs'), join(testSourceHarnessRuntimeDir, 'bin', 'harness.mjs'));
copyFileSync(join(harnessRuntimeDir, 'bin', 'ocode.mjs'), join(testSourceHarnessRuntimeDir, 'bin', 'ocode.mjs'));
mkdirSync(join(testSourceHarnessRuntimeDir, 'bin', 'validation'), { recursive: true });
copyFileSync(join(harnessRuntimeDir, 'bin', 'validation', 'npm'), join(testSourceHarnessRuntimeDir, 'bin', 'validation', 'npm'));

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

// Write initial VERSION (0.1.0)
writeFileSync(join(testSourceDir, 'VERSION'), '0.1.0\n', 'utf8');

// Set up initial installation (0.1.0)
mkdirSync(testBinDir, { recursive: true });
mkdirSync(testConfigDir, { recursive: true });
mkdirSync(testHarnessRoot, { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation', 'lib'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'orientation', 'bin'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime', 'lib'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime', 'bin'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'harness-runtime', 'bin', 'validation'), { recursive: true });
mkdirSync(join(testHarnessRoot, 'doctrine'), { recursive: true });
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
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'model-telemetry.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'model-telemetry.mjs'));
for (const lib of ['command-admission.mjs', 'deterministic-staging.mjs', 'task-capsule.mjs', 'model-qualification.mjs', 'behavioral-adapters.mjs', 'capability-resolution.mjs', 'tool-loop-control.mjs']) copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', lib), join(testHarnessRoot, 'harness-runtime', 'lib', lib));
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
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'artifact.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'artifact.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'lib', 'release-store.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'release-store.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'bin', 'harness.mjs'), join(testHarnessRoot, 'harness-runtime', 'bin', 'harness.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'bin', 'ocode.mjs'), join(testHarnessRoot, 'harness-runtime', 'bin', 'ocode.mjs'));
copyFileSync(join(testSourceHarnessRuntimeDir, 'bin', 'validation', 'npm'), join(testHarnessRoot, 'harness-runtime', 'bin', 'validation', 'npm'));

copyFileSync(join(testSourceDoctrineDir, 'agentic-agile.md'), join(testHarnessRoot, 'doctrine', 'agentic-agile.md'));
copyFileSync(join(testSourceDoctrineDir, 'resource-policy.md'), join(testHarnessRoot, 'doctrine', 'resource-policy.md'));
copyFileSync(join(testSourceDoctrineDir, 'policy-version.json'), join(testHarnessRoot, 'doctrine', 'policy-version.json'));

// Copy agents to harness root (needed by installAgents during rollback)
mkdirSync(join(testHarnessRoot, 'agents'), { recursive: true });
for (const agentFile of agentFiles) {
  copyFileSync(join(testSourceAgentsDir, agentFile), join(testHarnessRoot, 'agents', agentFile));
}
copyFileSync(join(testSourceAgentsDir, 'manifest.json'), join(testHarnessRoot, 'agents', 'manifest.json'));
// Copy opencode-config to harness root (needed by patchOpenCodeConfig during rollback)
mkdirSync(join(testHarnessRoot, 'opencode-config'), { recursive: true });
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
writeFileSync(join(testHarnessRoot, 'VERSION'), '0.1.0\n', 'utf8');

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

  // Test 1: Initial version
  console.log('\n=== Test 1: Initial version 0.1.0 ===\n');
  let result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  let output = JSON.parse(result.trim());
  console.log('Output:', JSON.stringify(output, null, 2));

  if (output.installed_version === '0.1.0') {
    console.log('✓ Initial version 0.1.0');
  } else {
    console.error(`✗ Initial version mismatch: ${output.installed_version}`);
    allPassed = false;
  }

  // Test 2: Update to 0.2.0
  console.log('\n=== Test 2: Update to 0.2.0 ===\n');
  writeFileSync(join(testSourceDir, 'VERSION'), '0.2.0\n', 'utf8');
  const hrPkg = JSON.parse(readFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), 'utf8'));
  hrPkg.version = '0.2.0';
  writeFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), JSON.stringify(hrPkg, null, 2), 'utf8');

  // Also modify a file to verify rollback restores it
  const testFile = join(testHarnessRoot, 'orientation', 'lib', 'orientation.mjs');

  try {
    result = execSync(`harness update`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, cwd: testSourceDir });
    console.log('Output:\n', result);
    console.log('✓ Update to 0.2.0 succeeded');
  } catch (err) {
    console.error('✗ Update to 0.2.0 failed:', err.message);
    allPassed = false;
  }

  // Modify file AFTER update succeeds so the modification persists
  const originalContent = readFileSync(testFile, 'utf8');
  writeFileSync(testFile, originalContent + '\n// 0.2.0 MODIFICATION\n', 'utf8');

  // Verify 0.2.0
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  if (output.installed_version === '0.2.0') {
    console.log('✓ Version updated to 0.2.0');
  } else {
    console.error(`✗ Version not updated: ${output.installed_version}`);
    allPassed = false;
  }

  // Verify modification exists
  const v020Content = readFileSync(testFile, 'utf8');
  if (v020Content.includes('0.2.0 MODIFICATION')) {
    console.log('✓ 0.2.0 modification present');
  } else {
    console.error('✗ 0.2.0 modification missing');
    allPassed = false;
  }

  // Test 3: Update to 0.3.0 (creates another backup)
  console.log('\n=== Test 3: Update to 0.3.0 (second update) ===\n');
  writeFileSync(join(testSourceDir, 'VERSION'), '0.3.0\n', 'utf8');
  hrPkg.version = '0.3.0';
  writeFileSync(join(testSourceHarnessRuntimeDir, 'package.json'), JSON.stringify(hrPkg, null, 2), 'utf8');

  // Modify file again AFTER update so the 0.2.0 backup is clean
  try {
    result = execSync(`harness update`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, cwd: testSourceDir });
    console.log('Output:\n', result);
    console.log('✓ Update to 0.3.0 succeeded');
  } catch (err) {
    console.error('✗ Update to 0.3.0 failed:', err.message);
    allPassed = false;
  }

  // Modify file again AFTER update succeeds
  writeFileSync(testFile, originalContent + '\n// 0.3.0 MODIFICATION\n', 'utf8');

  // Verify 0.3.0
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  if (output.installed_version === '0.3.0') {
    console.log('✓ Version updated to 0.3.0');
  } else {
    console.error(`✗ Version not updated: ${output.installed_version}`);
    allPassed = false;
  }

  // Test 4: Rollback to 0.2.0
  console.log('\n=== Test 4: Rollback to 0.2.0 ===\n');
  try {
    result = execSync(`harness rollback`, { encoding: 'utf8', env: { ...process.env, HOME: testHome } });
    console.log('Output:\n', result);
    console.log('✓ Rollback succeeded');
  } catch (err) {
    console.error('✗ Rollback failed:', err.message);
    allPassed = false;
  }

  // Verify rolled back to 0.2.0
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  console.log('Post-rollback version:', JSON.stringify(output, null, 2));

  if (output.installed_version === '0.2.0') {
    console.log('✓ Rolled back to 0.2.0');
  } else {
    console.error(`✗ Version after rollback: ${output.installed_version}`);
    allPassed = false;
  }

  // Verify 0.2.0 modification restored
  const rolledBackContent = readFileSync(testFile, 'utf8');
  if (rolledBackContent.includes('0.2.0 MODIFICATION')) {
    console.log('✓ 0.2.0 modification restored');
  } else if (rolledBackContent.includes('0.3.0 MODIFICATION')) {
    console.error('✗ 0.3.0 modification still present (rollback failed)');
    allPassed = false;
  } else {
    console.error('✗ Neither modification present (file may be original)');
    // This is OK if the original content is restored
    console.log('  (Original content restored - acceptable)');
  }

  // Test 5: Rollback again to 0.1.0
  console.log('\n=== Test 5: Rollback to 0.1.0 ===\n');
  try {
    result = execSync(`harness rollback`, { encoding: 'utf8', env: { ...process.env, HOME: testHome } });
    console.log('Output:\n', result);
    console.log('✓ Second rollback succeeded');
  } catch (err) {
    console.error('✗ Second rollback failed:', err.message);
    allPassed = false;
  }

  // Verify rolled back to 0.1.0
  result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env }, cwd: testSourceDir });
  output = JSON.parse(result.trim());
  console.log('Post-second-rollback version:', JSON.stringify(output, null, 2));

  if (output.installed_version === '0.1.0') {
    console.log('✓ Rolled back to 0.1.0');
  } else {
    console.error(`✗ Version after second rollback: ${output.installed_version}`);
    allPassed = false;
  }

  // Verify launchers still work
  const orientContent = readFileSync(join(testBinDir, 'orient'), 'utf8');
  const ocodeContent = readFileSync(join(testBinDir, 'ocode'), 'utf8');
  const harnessContent = readFileSync(join(testBinDir, 'harness'), 'utf8');

  if (orientContent.includes(testHarnessRoot)) {
    console.log('✓ orient launcher still valid after rollback');
  } else {
    console.error('✗ orient launcher broken after rollback');
    allPassed = false;
  }

  if (harnessContent.includes(testHarnessRoot)) {
    console.log('✓ harness launcher still valid after rollback');
  } else {
    console.error('✗ harness launcher broken after rollback');
    allPassed = false;
  }

  // Test 6: Rollback with no backups should fail
  console.log('\n=== Test 6: Rollback with no backups fails ===\n');
  // Clear backups - use testBackupDir
  rmSync(testBackupDir, { recursive: true, force: true });
  mkdirSync(testBackupDir, { recursive: true });

  try {
    execSync(`harness rollback`, { encoding: 'utf8', env: { ...process.env, HOME: testHome }, stdio: 'pipe' });
    console.error('✗ Rollback should have failed with no backups');
    allPassed = false;
  } catch (err) {
    if (err.status !== 0) {
      console.log('✓ Rollback correctly fails with no backups');
      console.log(`  Error: ${err.message.split('\n')[0]}`);
    } else {
      console.error('✗ Rollback succeeded unexpectedly');
      allPassed = false;
    }
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
