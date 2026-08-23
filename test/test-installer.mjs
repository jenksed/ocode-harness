#!/usr/bin/env node
/**
 * test-installer.mjs
 * Test installer against isolated temp HOME fixture
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create isolated temp HOME for testing
const testHome = join(tmpdir(), `ocode-harness-test-${Date.now()}`);
const testBinDir = join(testHome, '.local', 'bin');
const testConfigDir = join(testHome, '.config', 'opencode');
const testShareDir = join(testHome, '.local', 'share');

// Copy source files to test location
const sourceDir = resolve(__dirname, '..');
const agentsDir = join(sourceDir, 'agents');
const orientationDir = join(sourceDir, 'packages', 'orientation');
const opencodeConfigDir = join(sourceDir, 'opencode-config');

console.log('=== Test Installer ===\n');
console.log(`Test HOME: ${testHome}`);

// Create test directories
mkdirSync(testBinDir, { recursive: true });
mkdirSync(testConfigDir, { recursive: true });
mkdirSync(join(testShareDir, 'ocode-harness', 'orientation'), { recursive: true });
mkdirSync(join(testShareDir, 'ocode-harness', 'orientation', 'lib'), { recursive: true });
mkdirSync(join(testShareDir, 'ocode-harness', 'orientation', 'bin'), { recursive: true });
mkdirSync(join(testShareDir, 'ocode-harness', 'orientation', 'test'), { recursive: true });

// Copy agents
const testAgentsDir = join(testConfigDir, 'agents');
mkdirSync(testAgentsDir, { recursive: true });
const agentFiles = ['orchestrator.md', 'planner.md', 'coder.md', 'verifier.md', 'reviewer.md', 'researcher.md', 'judge.md'];
for (const agentFile of agentFiles) {
  copyFileSync(join(agentsDir, agentFile), join(testAgentsDir, agentFile));
}

// Copy orientation
copyFileSync(
  join(orientationDir, 'package.json'),
  join(testShareDir, 'ocode-harness', 'orientation', 'package.json')
);
copyFileSync(
  join(orientationDir, 'README.md'),
  join(testShareDir, 'ocode-harness', 'orientation', 'README.md')
);
copyFileSync(
  join(orientationDir, 'lib', 'orientation.mjs'),
  join(testShareDir, 'ocode-harness', 'orientation', 'lib', 'orientation.mjs')
);
copyFileSync(
  join(orientationDir, 'lib', 'probe.mjs'),
  join(testShareDir, 'ocode-harness', 'orientation', 'lib', 'probe.mjs')
);
copyFileSync(
  join(orientationDir, 'lib', 'render.mjs'),
  join(testShareDir, 'ocode-harness', 'orientation', 'lib', 'render.mjs')
);
copyFileSync(
  join(orientationDir, 'bin', 'orient.mjs'),
  join(testShareDir, 'ocode-harness', 'orientation', 'bin', 'orient.mjs')
);
copyFileSync(
  join(orientationDir, 'test', 'orient.test.mjs'),
  join(testShareDir, 'ocode-harness', 'orientation', 'test', 'orient.test.mjs')
);

// Copy opencode-config
mkdirSync(join(testHome, '.local', 'share', 'ocode-harness', 'opencode-config'), { recursive: true });
copyFileSync(
  join(opencodeConfigDir, 'opencode.json'),
  join(testHome, '.local', 'share', 'ocode-harness', 'opencode-config', 'opencode.json')
);

// Set up environment
const originalHome = process.env.HOME;
process.env.HOME = testHome;
process.env.PATH = `${testBinDir}:${process.env.PATH}`;

// Mock opencode binary in PATH
const mockOpencodeVersion = 'mock-1.0.0';
const mockOpencodePath = join(testBinDir, 'opencode');
writeFileSync(mockOpencodePath, `#!/bin/sh\necho "${mockOpencodeVersion}"\n`, 'utf8');
execSync(`chmod +x "${mockOpencodePath}"`, { stdio: 'inherit' });

// Mock git binary in PATH
const mockGitVersion = 'mock-git-2.40.0';
const mockGitPath = join(testBinDir, 'git');
writeFileSync(mockGitPath, `#!/bin/sh\necho "${mockGitVersion}"\n`, 'utf8');
execSync(`chmod +x "${mockGitPath}"`, { stdio: 'inherit' });

// Use real Node.js for spawning installer (avoid mock node shadowing)
const nodeBin = process.execPath;

try {
  console.log('Running installer...\n');

  // Run installer
  const installScript = join(__dirname, '..', 'installer', 'install.mjs');
  console.log(`Test HOME for installer: ${process.env.HOME}`);
  console.log(`Test bin dir: ${testBinDir}`);
  console.log(`Test config dir: ${testConfigDir}`);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(nodeBin, [installScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log('\n✓ Installation test passed');
  } else {
    console.log('\n✗ Installation test failed');
    process.exit(1);
  }

  // Check installation
  const checks = [
    {
      name: 'orient binary',
      path: join(testBinDir, 'orient'),
    },
    {
      name: 'ocode binary',
      path: join(testBinDir, 'ocode'),
    },
    {
      name: 'agents directory',
      path: testAgentsDir,
    },
    {
      name: 'orientation package',
      path: join(testShareDir, 'ocode-harness', 'orientation'),
    },
    {
      name: 'opencode configuration',
      path: join(testConfigDir, 'opencode.json'),
    },
  ];

  console.log('\n=== Installation Checks ===\n');
  let allPassed = true;

  for (const check of checks) {
    if (existsSync(check.path)) {
      console.log(`✓ ${check.name}`);
    } else {
      console.error(`✗ ${check.name} not found`);
      allPassed = false;
    }
  }

  // Check agents
  console.log('\n=== Agent Checks ===\n');
  for (const agentFile of agentFiles) {
    const agentPath = join(testAgentsDir, agentFile);
    if (existsSync(agentPath)) {
      console.log(`✓ ${agentFile}`);
    } else {
      console.error(`✗ ${agentFile} not found`);
      allPassed = false;
    }
  }

  // Check orientation package files
  const orientationFiles = [
    'package.json',
    'README.md',
    'lib/orientation.mjs',
    'lib/probe.mjs',
    'lib/render.mjs',
    'bin/orient.mjs',
    'test/orient.test.mjs',
  ];

  console.log('\n=== Orientation Package Checks ===\n');
  for (const file of orientationFiles) {
    const filePath = join(testShareDir, 'ocode-harness', 'orientation', file);
    if (existsSync(filePath)) {
      console.log(`✓ ${file}`);
    } else {
      console.error(`✗ ${file} not found`);
      allPassed = false;
    }
  }

  // Check opencode.json content
  if (existsSync(join(testConfigDir, 'opencode.json'))) {
    const opencodeConfig = JSON.parse(readFileSync(join(testConfigDir, 'opencode.json'), 'utf8'));
    if (opencodeConfig.subagent_depth === 1) {
      console.log('\n✓ subagent_depth is set to 1');
    } else {
      console.error('\n✗ subagent_depth is not set to 1');
      allPassed = false;
    }
  }

  // Cleanup
  console.log('\n=== Cleanup ===\n');
  rmSync(testHome, { recursive: true, force: true });

  if (allPassed) {
    console.log('✓ All tests passed');
    process.exit(0);
  } else {
    console.error('✗ Some tests failed');
    process.exit(1);
  }

} catch (error) {
  console.error('\n✗ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  process.env.HOME = originalHome;
}
