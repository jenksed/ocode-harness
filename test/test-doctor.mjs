#!/usr/bin/env node
/**
 * test-doctor.mjs
 * Test doctor command
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=== Test Doctor ===\n');

const checks = [];

// Check opencode
try {
  const opencodePath = execSync('which opencode', { encoding: 'utf8' }).trim();
  checks.push({ name: 'opencode', path: opencodePath, ok: true });
} catch (err) {
  checks.push({ name: 'opencode', path: null, ok: false });
}

// Check node
try {
  const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
  const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
  checks.push({ name: 'node', path: nodePath, version: nodeVersion, ok: true });
} catch (err) {
  checks.push({ name: 'node', path: null, ok: false });
}

// Check git
try {
  const gitPath = execSync('which git', { encoding: 'utf8' }).trim();
  const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
  checks.push({ name: 'git', path: gitPath, version: gitVersion, ok: true });
} catch (err) {
  checks.push({ name: 'git', path: null, ok: false });
}

// Check agents directory
const agentsDir = join(homedir(), '.config', 'opencode', 'agents');
const agentsDirExists = existsSync(agentsDir);
checks.push({ name: 'agents directory', path: agentsDir, ok: agentsDirExists });

// Check agents files
if (agentsDirExists) {
  const agentFiles = ['orchestrator.md', 'planner.md', 'coder.md', 'verifier.md', 'reviewer.md', 'researcher.md', 'judge.md', 'committer.md'];
  console.log('\n=== Agent Files ===\n');
  for (const agentFile of agentFiles) {
    const agentPath = join(agentsDir, agentFile);
    if (existsSync(agentPath)) {
      console.log(`✓ ${agentFile}`);
    } else {
      console.error(`✗ ${agentFile} not found`);
    }
  }
}

// Check orchestrator config
const opencodeConfigPath = join(homedir(), '.config', 'opencode', 'opencode.json');
if (existsSync(opencodeConfigPath)) {
  try {
    const opencodeConfig = JSON.parse(readFileSync(opencodeConfigPath, 'utf8'));
    const subagentDepth = opencodeConfig.subagent_depth;
    if (subagentDepth === 1) {
      checks.push({ name: 'subagent_depth', value: 1, ok: true });
    } else {
      checks.push({ name: 'subagent_depth', value: subagentDepth, ok: false });
    }
  } catch (err) {
    checks.push({ name: 'subagent_depth', value: 'invalid', ok: false });
  }
} else {
  checks.push({ name: 'subagent_depth', value: 'not found', ok: false });
}

// Check orient
try {
  const orientPath = execSync('which orient', { encoding: 'utf8' }).trim();
  checks.push({ name: 'orient', path: orientPath, ok: true });
} catch (err) {
  checks.push({ name: 'orient', path: null, ok: false });
}

// Check ocode
try {
  const ocodePath = execSync('which ocode', { encoding: 'utf8' }).trim();
  checks.push({ name: 'ocode', path: ocodePath, ok: true });
} catch (err) {
  checks.push({ name: 'ocode', path: null, ok: false });
}

// Check orientation health
try {
  const orientationDir = join(homedir(), '.local', 'share', 'ocode-harness', 'orientation');
  const orientationPackageJson = join(orientationDir, 'package.json');
  if (existsSync(orientationPackageJson)) {
    const orientationConfig = JSON.parse(readFileSync(orientationPackageJson, 'utf8'));
    checks.push({ name: 'orientation package', ok: true, version: orientationConfig.version });
  } else {
    checks.push({ name: 'orientation package', ok: false });
  }
} catch (err) {
  checks.push({ name: 'orientation package', ok: false });
}

// Check git excludes
try {
  const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  if (gitRoot) {
    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');
    if (existsSync(excludeFile)) {
      const excludes = readFileSync(excludeFile, 'utf8');
      if (excludes.includes('.opencode/orientation.json') && excludes.includes('.opencode/orientation.md')) {
        checks.push({ name: 'git excludes', ok: true });
      } else {
        checks.push({ name: 'git excludes', ok: false });
      }
    } else {
      checks.push({ name: 'git excludes', ok: false });
    }
  } else {
    checks.push({ name: 'git excludes', ok: false, reason: 'not in git repository' });
  }
} catch (err) {
  checks.push({ name: 'git excludes', ok: false, reason: 'not in git repository or git command failed' });
}

// Check env vars
const freellmApiKey = process.env.FREELLMAPI_API_KEY;
if (freellmApiKey && freellmApiKey !== '' && freellmApiKey !== '{env:FREELLMAPI_API_KEY}') {
  checks.push({ name: 'FREELLMAPI_API_KEY', ok: true, masked: true });
} else {
  checks.push({ name: 'FREELLMAPI_API_KEY', ok: false, reason: 'not set' });
}

// Report results
console.log('\n=== Doctor Checks ===\n');
let allPassed = true;

for (const check of checks) {
  if (check.ok) {
    if (check.version) {
      console.log(`✓ ${check.name}: ${check.version}`);
    } else if (check.path) {
      console.log(`✓ ${check.name}: ${check.path}`);
    } else if (check.value !== undefined) {
      console.log(`✓ ${check.name}: ${check.value}`);
    } else {
      console.log(`✓ ${check.name}`);
    }
  } else {
    console.error(`✗ ${check.name}`);
    if (check.reason) {
      console.error(`  Reason: ${check.reason}`);
    }
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n✓ All checks passed');
  process.exit(0);
} else {
  console.log('\n✗ Some checks failed');
  process.exit(1);
}
