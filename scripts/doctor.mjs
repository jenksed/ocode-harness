#!/usr/bin/env node
/**
 * doctor.mjs
 * ocode-harness doctor command
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
  agentsDir: join(homedir(), '.config', 'opencode', 'agents'),
  orientationDir: join(homedir(), '.local', 'share', 'ocode-harness', 'orientation'),
  opencodeConfig: join(homedir(), '.config', 'opencode', 'opencode.json'),
};

function printSection(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(title);
  console.log('='.repeat(60));
}

function checkOpencode() {
  printSection('Checking opencode...');

  try {
    const opencodePath = execSync('which opencode', { encoding: 'utf8' }).trim();
    console.log(`✓ opencode found at: ${opencodePath}`);

    try {
      const opencodeVersion = execSync('opencode --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${opencodeVersion}`);
    } catch (err) {
      console.error('  ✗ Could not get opencode version');
    }

    return true;
  } catch (err) {
    console.error('✗ opencode not found in PATH');
    console.error('  Please install opencode and ensure it is in your PATH');
    return false;
  }
}

function checkNode() {
  printSection('Checking Node.js...');

  try {
    const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
    console.log(`✓ Node.js found at: ${nodePath}`);

    try {
      const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${nodeVersion}`);
    } catch (err) {
      console.error('  ✗ Could not get Node.js version');
    }

    return true;
  } catch (err) {
    console.error('✗ Node.js not found in PATH');
    console.error('  Please install Node.js and ensure it is in your PATH');
    return false;
  }
}

function checkGit() {
  printSection('Checking git...');

  try {
    const gitPath = execSync('which git', { encoding: 'utf8' }).trim();
    console.log(`✓ git found at: ${gitPath}`);

    try {
      const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${gitVersion}`);
    } catch (err) {
      console.error('  ✗ Could not get git version');
    }

    return true;
  } catch (err) {
    console.error('✗ git not found in PATH');
    console.error('  Please install git and ensure it is in your PATH');
    return false;
  }
}

function checkAgents() {
  printSection('Checking agents...');

  if (!existsSync(CONFIG.agentsDir)) {
    console.error('✗ Agents directory not found');
    console.error(`  Path: ${CONFIG.agentsDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Agents directory found: ${CONFIG.agentsDir}`);

  const agentFiles = [
    'orchestrator.md',
    'planner.md',
    'coder.md',
    'verifier.md',
    'reviewer.md',
    'researcher.md',
    'judge.md',
  ];

  let allFound = true;
  for (const agentFile of agentFiles) {
    const agentPath = join(CONFIG.agentsDir, agentFile);
    if (existsSync(agentPath)) {
      console.log(`  ✓ ${agentFile}`);
    } else {
      console.error(`  ✗ ${agentFile} not found`);
      allFound = false;
    }
  }

  return allFound;
}

function checkOrchestratorConfig() {
  printSection('Checking orchestrator configuration...');

  if (!existsSync(CONFIG.opencodeConfig)) {
    console.error('✗ opencode configuration not found');
    console.error(`  Path: ${CONFIG.opencodeConfig}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ opencode configuration found: ${CONFIG.opencodeConfig}`);

  try {
    const opencodeConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));

    // Check subagent_depth
    if (opencodeConfig.subagent_depth === 1) {
      console.log('  ✓ subagent_depth is set to 1');
    } else {
      console.error('  ✗ subagent_depth should be 1');
      console.error(`    Current value: ${opencodeConfig.subagent_depth}`);
    }

    // Check task_allowlist
    if (opencodeConfig.task_allowlist) {
      const harnessAgents = ['planner', 'coder', 'researcher', 'verifier', 'reviewer', 'judge'];
      const hasGenericAgents = harnessAgents.some(agent => !opencodeConfig.task_allowlist.includes(agent));

      if (hasGenericAgents) {
        console.error('  ✗ task_allowlist should only include harness subagents');
        console.error(`    Current allowlist: ${opencodeConfig.task_allowlist.join(', ')}`);
      } else {
        console.log('  ✓ task_allowlist includes only harness subagents');
      }
    } else {
      console.warn('  ⚠ task_allowlist not set (using default)');
    }

    return opencodeConfig.subagent_depth === 1;
  } catch (err) {
    console.error('✗ Could not parse opencode configuration');
    return false;
  }
}

function checkOrient() {
  printSection('Checking orient...');

  try {
    const orientPath = execSync('which orient', { encoding: 'utf8' }).trim();
    console.log(`✓ orient found at: ${orientPath}`);

    return true;
  } catch (err) {
    console.error('✗ orient not found in PATH');
    console.error('  Please run: ocode-harness install');
    return false;
  }
}

function checkOcode() {
  printSection('Checking ocode...');

  try {
    const ocodePath = execSync('which ocode', { encoding: 'utf8' }).trim();
    console.log(`✓ ocode found at: ${ocodePath}`);

    return true;
  } catch (err) {
    console.error('✗ ocode not found in PATH');
    console.error('  Please run: ocode-harness install');
    return false;
  }
}

function checkOrientationHealth() {
  printSection('Checking orientation package...');

  if (!existsSync(CONFIG.orientationDir)) {
    console.error('✗ Orientation package not found');
    console.error(`  Path: ${CONFIG.orientationDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Orientation package found: ${CONFIG.orientationDir}`);

  const packageJsonPath = join(CONFIG.orientationDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.error('✗ package.json not found in orientation package');
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`  Package: ${packageJson.name}`);
    console.log(`  Version: ${packageJson.version || 'unknown'}`);

    // Check if tests exist
    const testDir = join(CONFIG.orientationDir, 'test');
    if (existsSync(testDir)) {
      const testFiles = readdir(testDir).filter(f => f.endsWith('.mjs'));
      if (testFiles.length > 0) {
        console.log(`  ✓ Tests found: ${testFiles.join(', ')}`);
      } else {
        console.warn('  ⚠ No test files found in orientation package');
      }
    }

    return true;
  } catch (err) {
    console.error('✗ Could not read orientation package.json');
    return false;
  }
}

function checkGitExcludes() {
  printSection('Checking Git excludes...');

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    if (!gitRoot) {
      console.log('  ℹ Not in a git repository');
      return true;
    }

    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');

    if (!existsSync(excludeFile)) {
      console.error('✗ .git/info/exclude not found');
      console.error('  This file should be configured to exclude orientation artifacts');
      return false;
    }

    const excludes = readFileSync(excludeFile, 'utf8');

    if (excludes.includes('.opencode/orientation.json') &&
        excludes.includes('.opencode/orientation.md')) {
      console.log('  ✓ Git excludes configured correctly');
      return true;
    } else {
      console.error('✗ Git excludes not configured correctly');
      console.error('  Expected to find: .opencode/orientation.json and .opencode/orientation.md');
      return false;
    }
  } catch (err) {
    console.error('  ✗ Could not check git excludes (not in git repository or git command failed)');
    return false;
  }
}

function checkEnvVars() {
  printSection('Checking environment variables...');

  const freellmApiKey = process.env.FREELLMAPI_API_KEY;
  const freellmBaseUrl = process.env.FREELLMAPI_BASE_URL;

  if (freellmApiKey && freellmApiKey !== '' && freellmApiKey !== '{env:FREELLMAPI_API_KEY}') {
    console.log('✓ FREELLMAPI_API_KEY is set');
    console.log(`  Value: ${freellmApiKey.substring(0, 10)}...${freellmApiKey.substring(freellmApiKey.length - 4)}`);
  } else {
    console.error('✗ FREELLMAPI_API_KEY not set or uses placeholder');
    console.error('  Please set FREELLMAPI_API_KEY environment variable');
  }

  if (freellmBaseUrl && freellmBaseUrl !== 'http://192.168.1.29:3001/v1') {
    console.log('✓ FREELLMAPI_BASE_URL is set');
    console.log(`  Value: ${freellmBaseUrl}`);
  } else if (!freellmBaseUrl) {
    console.warn('⚠ FREELLMAPI_BASE_URL not set (using default: http://192.168.1.29:3001/v1)');
  }

  return freellmApiKey && freellmApiKey !== '' && freellmApiKey !== '{env:FREELLMAPI_API_KEY}';
}

function main() {
  console.log('=== ocode-harness Doctor ===\n');

  const checks = [
    checkOpencode,
    checkNode,
    checkGit,
    checkAgents,
    checkOrchestratorConfig,
    checkOrient,
    checkOcode,
    checkOrientationHealth,
    checkGitExcludes,
    checkEnvVars,
  ];

  const results = [];

  for (const check of checks) {
    try {
      const result = check();
      results.push({ name: check.name, result });
    } catch (err) {
      console.error(`Error running ${check.name}:`, err.message);
      results.push({ name: check.name, result: false, error: err.message });
    }
  }

  // Summary
  printSection('Summary');

  const passed = results.filter(r => r.result).length;
  const failed = results.filter(r => !r.result).length;

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed === 0) {
    console.log('\n✓ All checks passed');
    process.exit(0);
  } else {
    console.log('\n✗ Some checks failed');
    console.log('\nRecommendations:');
    console.log('  1. Run: ocode-harness install');
    console.log('  2. Ensure all environment variables are set');
    console.log('  3. Check PATH includes ~/.local/bin');
    process.exit(1);
  }
}

main();
