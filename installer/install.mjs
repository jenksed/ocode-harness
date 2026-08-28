#!/usr/bin/env node
/** Bootstrap source convenience; installation authority is a Phase-2 artifact. */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { activateRelease, installVerifiedArtifact } from '../packages/harness-runtime/lib/release-store.mjs';
import { CONFIG, configureGitExcludes, findSourceRepo, installAgents, installLaunchers, patchOpenCodeConfig, removeLegacyRequestEffectTools } from '../packages/harness-runtime/lib/deploy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function check(command, label) { try { console.log(`✓ ${label}: ${execSync(command, { encoding: 'utf8' }).trim()}`); } catch { throw new Error(`${label} is required`); } }

async function main() {
  console.log('=== ocode-harness Installer ===\n');
  console.log(`Installation directory: ${CONFIG.harnessRoot}`);
  console.log(`Binaries directory: ${CONFIG.binDir}`);
  console.log(`Agents directory: ${CONFIG.agentsDir}`);
  console.log(`OpenCode configuration: ${CONFIG.opencodeConfig}`);
  console.log(`Ocode machine config: ${CONFIG.machineConfig}`);
  console.log();

  try {
    check('node --version', 'Node.js'); check('opencode --version', 'opencode');

    const sourceRoot = findSourceRepo(__dirname);
    if (!sourceRoot) {
      throw new Error('Could not find source repository (missing VERSION, installer/install.mjs, agents/, or packages/)');
    }
    console.log(`Source repository: ${sourceRoot}\n`);

    const output = mkdtempSync(join(tmpdir(), 'ocode-bootstrap-'));
    const built = buildReleaseArtifact({ sourceRoot, outputDir: output });
    const installed = installVerifiedArtifact({ archive: built.archive, installStore: CONFIG.installStoreRoot });
    const active = activateRelease(installed.id, CONFIG.installStoreRoot);
    installLaunchers(CONFIG.installStoreRoot);
    installAgents(active.current.path); patchOpenCodeConfig(active.current.path);
    configureGitExcludes();
    removeLegacyRequestEffectTools(CONFIG.opencodeConfig);

    rmSync(output, { recursive: true, force: true });

    console.log('\n=== Installation Complete ===\n');
    console.log('✓ All checks passed');
    console.log();
    console.log('Next steps:');
    console.log('  1. Add ~/.local/bin to your PATH if not already present');
    console.log('  2. Run "orient ." in your project directory to generate orientation');
    console.log('  3. Run "ocode ." to start the harness');
    console.log('  4. Run "ocode version" to verify the exact installed release');
    console.log();
    console.log(`Active release: ${active.current.id}`);
    console.log('To rollback: ocode rollback');
  } catch (error) {
    console.error('\n✗ Installation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
