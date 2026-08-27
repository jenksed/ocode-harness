#!/usr/bin/env node
/**
 * ocode-harness installer
 * Deterministic installation of the ocode-harness runtime using staged promotion.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

import {
  stageCandidate,
  validateCandidate,
  promoteCandidate,
  installLaunchers,
  installAgents,
  patchOpenCodeConfig,
  removeLegacyRequestEffectTools,
  configureGitExcludes,
  validatePostPromotion,
  readVersion,
  findSourceRepo,
  assertPromotableSourceIdentity,
  inspectSourceIdentity,
  isExactReleaseIdentity,
  readReleaseIdentity,
  sameReleaseIdentity,
  writeReleaseIdentity,
  CONFIG,
} from '../packages/harness-runtime/lib/deploy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function preflightChecks() {
  console.log('Running preflight checks...\n');

  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    console.log(`✓ Node.js: ${nodeVersion}`);
  } catch {
    throw new Error('Node.js is required but not found in PATH');
  }

  try {
    const opencodeVersion = execSync('opencode --version', { encoding: 'utf8' }).trim();
    console.log(`✓ opencode: ${opencodeVersion}`);
  } catch {
    throw new Error('opencode is required but not found in PATH');
  }

  try {
    const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
    console.log(`✓ git: ${gitVersion}`);
  } catch {
    throw new Error('git is required but not found in PATH');
  }

  console.log();
}

function assertRuntimeDependencies(sourceRoot) {
  const sdkPackage = resolve(sourceRoot, 'node_modules', '@opencode-ai', 'sdk', 'package.json');
  if (!existsSync(sdkPackage)) {
    throw new Error(
      'Runtime dependencies are not installed in the source checkout. Run "npm ci" in the ocode-harness checkout, then rerun "npm run bootstrap".'
    );
  }
}

async function main() {
  console.log('=== ocode-harness Installer ===\n');
  console.log(`Installation directory: ${CONFIG.harnessRoot}`);
  console.log(`Binaries directory: ${CONFIG.binDir}`);
  console.log(`Agents directory: ${CONFIG.agentsDir}`);
  console.log(`OpenCode configuration: ${CONFIG.opencodeConfig}`);
  console.log(`Ocode machine config: ${CONFIG.machineConfig}`);
  console.log();

  try {
    await preflightChecks();

    const sourceRoot = findSourceRepo(__dirname);
    if (!sourceRoot) {
      throw new Error('Could not find source repository (missing VERSION, installer/install.mjs, agents/, or packages/)');
    }
    console.log(`Source repository: ${sourceRoot}\n`);

    assertRuntimeDependencies(sourceRoot);

    const version = readVersion(resolve(sourceRoot, 'VERSION'));
    if (!version) throw new Error('Could not read VERSION from source repository');
    const sourceIdentity = assertPromotableSourceIdentity(inspectSourceIdentity(sourceRoot, version));
    console.log(`Installing version: ${version}`);
    console.log(`Source SHA: ${sourceIdentity.source_commit || 'unavailable (non-Git source)'}`);
    console.log(`Source ref: ${sourceIdentity.source_ref || 'detached/unknown'}\n`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagingDir = join(CONFIG.stagingDir, timestamp);

    stageCandidate(sourceRoot, stagingDir, version);
    writeReleaseIdentity(stagingDir, sourceIdentity);

    if (!validateCandidate(stagingDir)) {
      console.error('\n✗ Candidate validation failed, aborting installation');
      rmSync(stagingDir, { recursive: true, force: true });
      process.exit(1);
    }

    const backupDir = promoteCandidate(stagingDir, CONFIG.harnessRoot, CONFIG.backupDir);
    installLaunchers(CONFIG.harnessRoot);
    installAgents(CONFIG.harnessRoot);
    patchOpenCodeConfig(CONFIG.harnessRoot);
    configureGitExcludes();
    removeLegacyRequestEffectTools(CONFIG.opencodeConfig);

    const postValid = validatePostPromotion(CONFIG.harnessRoot);
    const installedIdentity = readReleaseIdentity(CONFIG.harnessRoot);
    const identityValid = !isExactReleaseIdentity(sourceIdentity)
      || sameReleaseIdentity(sourceIdentity, installedIdentity);
    if (!postValid || !identityValid) {
      console.log('\n=== Installation Complete but with Issues ===\n');
      console.log(identityValid ? 'Post-promotion checks failed. Attempting rollback...' : 'Release identity mismatch. Attempting rollback...');
      try {
        const { rollbackCandidate } = await import('../packages/harness-runtime/lib/deploy.mjs');
        rollbackCandidate(CONFIG.backupDir, CONFIG.harnessRoot);
        console.log('✓ Rollback completed');
      } catch (rollbackErr) {
        console.error('✗ Rollback failed:', rollbackErr.message);
      }
      process.exit(1);
    }

    console.log('\n=== Installation Complete ===\n');
    console.log('✓ All checks passed');
    console.log();
    console.log('Next steps:');
    console.log('  1. Add ~/.local/bin to your PATH if not already present');
    console.log('  2. Run "orient ." in your project directory to generate orientation');
    console.log('  3. Run "ocode ." to start the harness');
    console.log('  4. Run "ocode version" to verify the exact installed release');
    console.log();
    console.log(`Backup created at: ${backupDir}`);
    console.log('To rollback: ocode rollback');
  } catch (error) {
    console.error('\n✗ Installation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
