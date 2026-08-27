#!/usr/bin/env node
/**
 * test-harness-version.mjs
 * Test harness version command against isolated temp HOME fixture
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create isolated temp HOME for testing
const testHome = join(tmpdir(), `ocode-harness-test-version-${Date.now()}`);
const testBinDir = join(testHome, '.local', 'bin');
const testConfigDir = join(testHome, '.config', 'opencode');
const testShareDir = join(testHome, '.local', 'share');
const testHarnessRoot = join(testShareDir, 'ocode-harness');

// Copy source files
const sourceDir = resolve(__dirname, '..');
const agentsDir = join(sourceDir, 'agents');
const orientationDir = join(sourceDir, 'packages', 'orientation');
const harnessRuntimeDir = join(sourceDir, 'packages', 'harness-runtime');
const doctrineDir = join(sourceDir, 'doctrine');
const opencodeConfigDir = join(sourceDir, 'opencode-config');

console.log('=== Test Harness Version ===\n');
console.log(`Test HOME: ${testHome}`);

// Create directory structure
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

// Copy orientation package
copyFileSync(join(orientationDir, 'package.json'), join(testHarnessRoot, 'orientation', 'package.json'));
copyFileSync(join(orientationDir, 'README.md'), join(testHarnessRoot, 'orientation', 'README.md'));
copyFileSync(join(orientationDir, 'lib', 'orientation.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'orientation.mjs'));
copyFileSync(join(orientationDir, 'lib', 'probe.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'probe.mjs'));
copyFileSync(join(orientationDir, 'lib', 'render.mjs'), join(testHarnessRoot, 'orientation', 'lib', 'render.mjs'));
copyFileSync(join(orientationDir, 'bin', 'orient.mjs'), join(testHarnessRoot, 'orientation', 'bin', 'orient.mjs'));

// Copy harness-runtime package
copyFileSync(join(harnessRuntimeDir, 'package.json'), join(testHarnessRoot, 'harness-runtime', 'package.json'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'identity.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'identity.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'lifecycle.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'lifecycle.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'ledger.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'ledger.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'evidence.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'evidence.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'composition.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'composition.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'closeout.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'closeout.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'verify.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'verify.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'activity.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'activity.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'governance.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'governance.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'permission-projection.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'permission-projection.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'admission.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'admission.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'agent-contract.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'agent-contract.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'opencode-integration.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'opencode-integration.mjs'));
copyFileSync(join(harnessRuntimeDir, 'lib', 'deploy.mjs'), join(testHarnessRoot, 'harness-runtime', 'lib', 'deploy.mjs'));
copyFileSync(join(harnessRuntimeDir, 'bin', 'harness.mjs'), join(testHarnessRoot, 'harness-runtime', 'bin', 'harness.mjs'));

// Copy doctrine
copyFileSync(join(doctrineDir, 'agentic-agile.md'), join(testHarnessRoot, 'doctrine', 'agentic-agile.md'));
copyFileSync(join(doctrineDir, 'resource-policy.md'), join(testHarnessRoot, 'doctrine', 'resource-policy.md'));
copyFileSync(join(doctrineDir, 'policy-version.json'), join(testHarnessRoot, 'doctrine', 'policy-version.json'));

// Copy root node_modules to test harness-runtime for commander dependency
const rootNodeModules = join(sourceDir, 'node_modules');
const testHarnessRuntimeNodeModules = join(testHarnessRoot, 'harness-runtime', 'node_modules');
if (existsSync(rootNodeModules)) {
  cpSync(rootNodeModules, testHarnessRuntimeNodeModules, { recursive: true });
}

// Copy agents
const testAgentsDir = join(testConfigDir, 'agents');
mkdirSync(testAgentsDir, { recursive: true });
const agentFiles = JSON.parse(readFileSync(join(agentsDir, 'manifest.json'), 'utf8')).roles.map((role) => role.file);
for (const agentFile of agentFiles) {
  copyFileSync(join(agentsDir, agentFile), join(testAgentsDir, agentFile));
}

// Copy opencode-config
mkdirSync(join(testHarnessRoot, 'opencode-config'), { recursive: true });
copyFileSync(join(opencodeConfigDir, 'opencode.json'), join(testHarnessRoot, 'opencode-config', 'opencode.json'));

// Write VERSION file
const sourceVersion = readFileSync(join(sourceDir, 'VERSION'), 'utf8').trim();
writeFileSync(join(testHarnessRoot, 'VERSION'), sourceVersion + '\n', 'utf8');

// Create launchers
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

  // Test 1: harness version --json
  console.log('\n=== Test 1: harness version --json ===\n');
  try {
    const result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env } });
    const output = JSON.parse(result.trim());
    console.log('Output:', JSON.stringify(output, null, 2));

    if (output.installed_version === sourceVersion) {
      console.log('✓ installed_version matches source VERSION');
    } else {
      console.error(`✗ installed_version mismatch: ${output.installed_version} !== ${sourceVersion}`);
      allPassed = false;
    }

    if (output.doctrine_version === '1') {
      console.log('✓ doctrine_version matches policy-version.json');
    } else {
      console.error(`✗ doctrine_version mismatch: ${output.doctrine_version}`);
      allPassed = false;
    }

    if (output.source_version === null || output.source_version === undefined) {
      console.log('✓ source_version correctly null (no source repo in test HOME)');
    } else {
      console.log(`ℹ source_version detected: ${output.source_version}`);
    }

    if (output.source_differs === false) {
      console.log('✓ source_differs correctly false');
    } else {
      console.error('✗ source_differs should be false');
      allPassed = false;
    }
  } catch (err) {
    console.error('✗ harness version --json failed:', err.message);
    allPassed = false;
  }

  // Test 2: harness version (human readable)
  console.log('\n=== Test 2: harness version (human) ===\n');
  try {
    const result = execSync(`harness version`, { encoding: 'utf8', env: { ...process.env } });
    console.log('Output:\n', result);
    if (result.includes(sourceVersion)) {
      console.log('✓ Human output contains installed version');
    } else {
      console.error('✗ Human output missing installed version');
      allPassed = false;
    }
  } catch (err) {
    console.error('✗ harness version failed:', err.message);
    allPassed = false;
  }

  // Test 3: Exit code is always 0
  console.log('\n=== Test 3: Exit code always 0 ===\n');
  try {
    execSync(`harness version`, { encoding: 'utf8', env: { ...process.env } });
    console.log('✓ Exit code 0');
  } catch (err) {
    console.error('✗ Non-zero exit code:', err.status);
    allPassed = false;
  }

  // Test 4: Simulate source repo present with different version
  console.log('\n=== Test 4: Source repo with different version ===\n');
  // Create a fake source repo in a subdirectory of testHome
  const fakeSourceDir = join(testHome, 'fake-source');
  mkdirSync(join(fakeSourceDir, 'agents'), { recursive: true });
  mkdirSync(join(fakeSourceDir, 'packages', 'orientation'), { recursive: true });
  mkdirSync(join(fakeSourceDir, 'installer'), { recursive: true });
  writeFileSync(join(fakeSourceDir, 'VERSION'), 'v9.9.9\n', 'utf8');
  writeFileSync(join(fakeSourceDir, 'installer', 'install.mjs'), '// fake', 'utf8');
  // Copy minimal agents/packages
  copyFileSync(join(agentsDir, 'orchestrator.md'), join(fakeSourceDir, 'agents', 'orchestrator.md'));
  copyFileSync(join(orientationDir, 'package.json'), join(fakeSourceDir, 'packages', 'orientation', 'package.json'));

  // Change cwd to fake source dir
  const originalCwd = process.cwd();
  process.chdir(fakeSourceDir);

  try {
    const result = execSync(`harness version --json`, { encoding: 'utf8', env: { ...process.env } });
    const output = JSON.parse(result.trim());
    console.log('Output:', JSON.stringify(output, null, 2));

    if (output.source_version === 'v9.9.9') {
      console.log('✓ source_version detected from fake source repo');
    } else {
      console.error(`✗ source_version not detected: ${output.source_version}`);
      allPassed = false;
    }

    if (output.source_differs === true) {
      console.log('✓ source_differs correctly true (v9.9.9 vs installed v0.1.0)');
    } else {
      console.error('✗ source_differs should be true');
      allPassed = false;
    }
  } catch (err) {
    console.error('✗ harness version with source repo failed:', err.message);
    allPassed = false;
  } finally {
    process.chdir(originalCwd);
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
