#!/usr/bin/env node
/**
 * ocode-harness installer
 * Deterministic installation of the ocode-harness runtime using staged promotion
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { env } from 'node:process';

import {
  stageCandidate,
  validateCandidate,
  promoteCandidate,
  installLaunchers,
  installAgents,
  patchOpenCodeConfig,
  configureGitExcludes,
  validatePostPromotion,
  readVersion,
  findSourceRepo,
  CONFIG,
} from '../packages/harness-runtime/lib/deploy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Main installation function using staged promotion
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

    // Find source repository
    const sourceRoot = findSourceRepo(__dirname);
    if (!sourceRoot) {
      throw new Error('Could not find source repository (missing VERSION, installer/install.mjs, agents/, or packages/)');
    }
    console.log(`Source repository: ${sourceRoot}\n`);

    // Read version from source
    const version = readVersion(resolve(sourceRoot, 'VERSION'));
    if (!version) {
      throw new Error('Could not read VERSION from source repository');
    }
    console.log(`Installing version: ${version}\n`);

    // Staging directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagingDir = join(CONFIG.stagingDir, timestamp);

    // Stage candidate
    stageCandidate(sourceRoot, stagingDir, version);

    // Validate candidate
    const isValid = validateCandidate(stagingDir);
    if (!isValid) {
      console.error('\n✗ Candidate validation failed, aborting installation');
      // Clean up staging
      import('node:fs').then(fs => fs.rmSync(stagingDir, { recursive: true, force: true }));
      process.exit(1);
    }

    // Promote candidate
    const backupDir = promoteCandidate(stagingDir, CONFIG.harnessRoot, CONFIG.backupDir);

    // Install launchers (from promoted stable installation)
    installLaunchers(CONFIG.harnessRoot);

    // Install agents
    installAgents(CONFIG.harnessRoot);

    // Patch OpenCode config
    patchOpenCodeConfig(CONFIG.harnessRoot);

    // Configure Git excludes
    configureGitExcludes();

    // Post-promotion validation
    const postValid = validatePostPromotion(CONFIG.harnessRoot);

    if (postValid) {
      console.log('\n=== Installation Complete ===\n');
      console.log('✓ All checks passed');
      console.log();
      console.log('Next steps:');
      console.log('  1. Add ~/.local/bin to your PATH if not already present');
      console.log('  2. Run "orient ." in your project directory to generate orientation');
      console.log('  3. Run "ocode" to start the harness');
      console.log('  4. Run "harness version" to verify installation');
      console.log();
      console.log(`Backup created at: ${backupDir}`);
      console.log('To rollback: harness rollback');
    } else {
      console.log('\n=== Installation Complete but with Issues ===\n');
      console.log('Some post-promotion checks failed. Attempting rollback...');
      // Attempt rollback
      try {
        const { rollbackCandidate } = await import('../packages/harness-runtime/lib/deploy.mjs');
        rollbackCandidate(CONFIG.backupDir, CONFIG.harnessRoot);
        console.log('✓ Rollback completed');
      } catch (rollbackErr) {
        console.error('✗ Rollback failed:', rollbackErr.message);
      }
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