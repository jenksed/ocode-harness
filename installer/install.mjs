#!/usr/bin/env node
/**
 * ocode-harness installer
<<<<<<< HEAD
 * Deterministic installation of the ocode-harness runtime using staged promotion
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
=======
 * Deterministic installation of the ocode-harness runtime with drift detection
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync, readdirSync } from 'node:fs';
>>>>>>> d0338ba (Add committer agent, quarantine incompatible skills, drift detection)
import { execSync } from 'node:child_process';
import { env } from 'node:process';
import { createHash } from 'node:crypto';

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
 * Drift status classification
 */
const DriftStatus = {
  MATCH: 'MATCH',      // Source and destination are identical
  DRIFT: 'DRIFT',      // Destination exists but differs from source
  MISSING: 'MISSING',  // Destination does not exist
  EXTRA: 'EXTRA',      // Destination exists but not in manifest (user file)
};

/**
 * Harness-owned files manifest
 * Defines all files managed by the harness with their source and destination paths
 */
function getHarnessOwnedFiles() {
  const sourceDir = resolve(__dirname, '..');
  const agentsSrc = join(sourceDir, 'agents');
  const orientationSrc = join(sourceDir, 'packages', 'orientation');
  const opencodeConfigSrc = join(sourceDir, 'opencode-config', 'opencode.json');

  const files = [];

  // 8 Agents
  const agentFiles = [
    'orchestrator.md',
    'planner.md',
    'coder.md',
    'verifier.md',
    'reviewer.md',
    'researcher.md',
    'judge.md',
    'committer.md',
  ];

  for (const agentFile of agentFiles) {
    files.push({
      type: 'agent',
      name: agentFile,
      source: join(agentsSrc, agentFile),
      destination: join(CONFIG.agentsDir, agentFile),
    });
  }

  // Orientation package files
  const orientationFiles = [
    { src: 'package.json', dest: 'package.json' },
    { src: 'README.md', dest: 'README.md' },
    { src: join('lib', 'orientation.mjs'), dest: join('lib', 'orientation.mjs') },
    { src: join('lib', 'probe.mjs'), dest: join('lib', 'probe.mjs') },
    { src: join('lib', 'render.mjs'), dest: join('lib', 'render.mjs') },
    { src: join('bin', 'orient.mjs'), dest: join('bin', 'orient.mjs') },
    { src: join('test', 'orient.test.mjs'), dest: join('test', 'orient.test.mjs') },
  ];

  for (const ofile of orientationFiles) {
    files.push({
      type: 'orientation',
      name: ofile.dest,
      source: join(orientationSrc, ofile.src),
      destination: join(CONFIG.orientationDir, ofile.dest),
    });
  }

  // Opencode config source (merged, not direct copy)
  files.push({
    type: 'opencode-config',
    name: 'opencode.json',
    source: opencodeConfigSrc,
    destination: CONFIG.opencodeConfig,
    merged: true, // Indicates this file is merged, not directly copied
  });

  // Binaries - generated scripts (source content is computed at install time)
  const orientScript = generateOrientScript();
  const ocodeScript = generateOcodeScript();

  files.push({
    type: 'binary',
    name: 'orient',
    sourceContent: orientScript, // Generated content
    destination: join(CONFIG.binDir, 'orient'),
    executable: true,
  });

  files.push({
    type: 'binary',
    name: 'ocode',
    sourceContent: ocodeScript, // Generated content
    destination: join(CONFIG.binDir, 'ocode'),
    executable: true,
  });

  return files;
}

/**
 * Generate orient binary script content
 */
function generateOrientScript() {
  return `#!/bin/sh
set -eu
exec node "${CONFIG.orientationDir}/bin/orient.mjs" "\${1:-\${PWD}}"
`;
}

/**
 * Generate ocode binary script content
 */
function generateOcodeScript() {
  return `#!/bin/sh
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
}

/**
 * Compute SHA-256 hash of file content
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Read file content as buffer for binary comparison
 */
function readFileBuffer(path) {
  return readFileSync(path);
}

/**
 * Compare two files by content hash
 */
function compareFiles(sourcePath, destPath) {
  const sourceContent = readFileBuffer(sourcePath);
  const destContent = readFileBuffer(destPath);
  return hashContent(sourceContent) === hashContent(destContent);
}

/**
 * Compare generated content with destination file
 */
function compareGeneratedContent(sourceContent, destPath) {
  if (!existsSync(destPath)) {
    return false;
  }
  const destContent = readFileBuffer(destPath);
  return hashContent(sourceContent) === hashContent(destContent);
}

/**
 * Detect drift for all harness-owned files
 */
function detectDrift() {
  const manifest = getHarnessOwnedFiles();
  const results = [];

  for (const entry of manifest) {
    const result = {
      type: entry.type,
      name: entry.name,
      source: entry.source,
      destination: entry.destination,
      status: DriftStatus.MISSING,
      sourceHash: null,
      destHash: null,
      sourceContent: entry.sourceContent, // Pass through for binaries
    };

    // For binaries, source is generated content
    if (entry.sourceContent !== undefined) {
      result.sourceHash = hashContent(entry.sourceContent);
      if (existsSync(entry.destination)) {
        const destContent = readFileBuffer(entry.destination);
        result.destHash = hashContent(destContent);
        result.status = result.sourceHash === result.destHash ? DriftStatus.MATCH : DriftStatus.DRIFT;
      } else {
        result.status = DriftStatus.MISSING;
      }
    }
    // For opencode-config, it's merged - compare against source config
    else if (entry.merged) {
      if (existsSync(entry.destination)) {
        // Read source config
        const sourceConfig = JSON.parse(readFileSync(entry.source, 'utf8'));
        // Read destination config
        const destConfig = JSON.parse(readFileSync(entry.destination, 'utf8'));
        // Compare relevant fields (subagent_depth and task_allowlist from source)
        const sourceRelevant = {
          subagent_depth: sourceConfig.subagent_depth,
          task_allowlist: sourceConfig.task_allowlist,
        };
        const destRelevant = {
          subagent_depth: destConfig.subagent_depth,
          task_allowlist: destConfig.task_allowlist,
        };
        result.sourceHash = hashContent(JSON.stringify(sourceRelevant));
        result.destHash = hashContent(JSON.stringify(destRelevant));
        result.status = result.sourceHash === result.destHash ? DriftStatus.MATCH : DriftStatus.DRIFT;
      } else {
        result.status = DriftStatus.MISSING;
      }
    }
    // Regular files (agents, orientation)
    else {
      if (existsSync(entry.source)) {
        result.sourceHash = hashContent(readFileBuffer(entry.source));
      }
      if (existsSync(entry.destination)) {
        const destContent = readFileBuffer(entry.destination);
        result.destHash = hashContent(destContent);
        if (!existsSync(entry.source)) {
          result.status = DriftStatus.EXTRA;
        } else if (result.sourceHash === result.destHash) {
          result.status = DriftStatus.MATCH;
        } else {
          result.status = DriftStatus.DRIFT;
        }
      } else {
        result.status = existsSync(entry.source) ? DriftStatus.MISSING : DriftStatus.EXTRA;
      }
    }

    results.push(result);
  }

  // Check for EXTRA files in destination directories (user files not in manifest)
  const destDirs = [
    { dir: CONFIG.agentsDir, type: 'agent' },
    { dir: CONFIG.orientationDir, type: 'orientation' },
    { dir: CONFIG.binDir, type: 'binary' },
  ];

  for (const { dir, type } of destDirs) {
    if (existsSync(dir)) {
      const destFiles = readdirSync(dir, { recursive: true });
      const manifestDests = new Set(manifest.filter(m => m.type === type).map(m => m.destination));
      for (const destFile of destFiles) {
        const fullPath = join(dir, destFile);
        if (statSync(fullPath).isFile() && !manifestDests.has(fullPath)) {
          // Check if it's a known subdirectory (lib, bin, test for orientation)
          if (type === 'orientation') {
            const relPath = fullPath.replace(CONFIG.orientationDir + '/', '');
            const knownDirs = ['lib/', 'bin/', 'test/'];
            const isKnownDir = knownDirs.some(d => relPath.startsWith(d));
            if (!isKnownDir) {
              results.push({
                type,
                name: relPath,
                source: null,
                destination: fullPath,
                status: DriftStatus.EXTRA,
                sourceHash: null,
                destHash: hashContent(readFileBuffer(fullPath)),
              });
            }
          } else {
            results.push({
              type,
              name: basename(destFile),
              source: null,
              destination: fullPath,
              status: DriftStatus.EXTRA,
              sourceHash: null,
              destHash: hashContent(readFileBuffer(fullPath)),
            });
          }
        }
      }
    }
  }

  // Summary counts
  const summary = {
    total: results.length,
    match: results.filter(r => r.status === DriftStatus.MATCH).length,
    drift: results.filter(r => r.status === DriftStatus.DRIFT).length,
    missing: results.filter(r => r.status === DriftStatus.MISSING).length,
    extra: results.filter(r => r.status === DriftStatus.EXTRA).length,
  };

  return { results, summary };
}

/**
 * Print drift detection table
 */
function printDriftTable(driftResult) {
  console.log('\n=== Drift Detection ===\n');

  const { results, summary } = driftResult;

  // Group by type
  const byType = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  const typeOrder = ['agent', 'orientation', 'opencode-config', 'binary'];
  const statusSymbols = {
    [DriftStatus.MATCH]: '✓',
    [DriftStatus.DRIFT]: '⚠',
    [DriftStatus.MISSING]: '✗',
    [DriftStatus.EXTRA]: '⊕',
  };

  const statusLabels = {
    [DriftStatus.MATCH]: 'MATCH  ',
    [DriftStatus.DRIFT]: 'DRIFT  ',
    [DriftStatus.MISSING]: 'MISSING',
    [DriftStatus.EXTRA]: 'EXTRA  ',
  };

  for (const type of typeOrder) {
    const entries = byType[type];
    if (!entries || entries.length === 0) continue;

    console.log(`  ${type.toUpperCase()}:`);
    for (const entry of entries) {
      const symbol = statusSymbols[entry.status] || '?';
      const label = statusLabels[entry.status] || 'UNKNOWN';
      const name = entry.name.padEnd(30);
      console.log(`    ${symbol} ${label} ${name}`);
      if (entry.status === DriftStatus.DRIFT) {
        console.log(`      Source: ${entry.source || '(generated)'}`);
        console.log(`      Dest:   ${entry.destination}`);
      } else if (entry.status === DriftStatus.EXTRA) {
        console.log(`      Extra file: ${entry.destination}`);
      }
    }
    console.log('');
  }

  console.log('  Summary:');
  console.log(`    Total:  ${summary.total}`);
  console.log(`    Match:  ${summary.match}`);
  console.log(`    Drift:  ${summary.drift}`);
  console.log(`    Missing: ${summary.missing}`);
  console.log(`    Extra:  ${summary.extra}`);
  console.log('');
}

/**
 * Create backup directory and copy files that will be replaced
 */
function createInstallBackup(driftResult) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(CONFIG.backupDir, `install-${timestamp}`);

  const filesToBackup = driftResult.results.filter(r =>
    r.status === DriftStatus.DRIFT || r.status === DriftStatus.MATCH
  ).filter(r => existsSync(r.destination));

  if (filesToBackup.length === 0) {
    console.log('✓ No files to backup (all missing or extra)');
    return null;
  }

  mkdirSync(backupDir, { recursive: true });

  for (const entry of filesToBackup) {
    const destContent = readFileSync(entry.destination);
    const backupPath = join(backupDir, entry.name.replace(/\//g, '_'));
    writeFileSync(backupPath, destContent);
  }

  // Write manifest
  const manifestPath = join(backupDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    timestamp,
    files: filesToBackup.map(f => ({
      name: f.name,
      type: f.type,
      destination: f.destination,
      status: f.status,
    })),
  }, null, 2));

  console.log(`✓ Created install backup: ${backupDir}`);
  console.log(`  Backed up ${filesToBackup.length} file(s)`);
  console.log('');

  return backupDir;
}

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
<<<<<<< HEAD
 * Main installation function using staged promotion
=======
 * Backup existing managed config (opencode.json)
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
 * Install harness runtime with drift-aware semantics
 */
function installHarnessRuntime(driftResult, backupDir) {
  console.log('Installing harness runtime...\n');

  const { results } = driftResult;

  for (const entry of results) {
    // Only process agent and orientation files here
    if (entry.type !== 'agent' && entry.type !== 'orientation') continue;

    // Skip EXTRA files - never touch user files
    if (entry.status === DriftStatus.EXTRA) {
      console.log(`⊕ Skipping extra file (user-owned): ${entry.name}`);
      continue;
    }

    // Skip MATCH files - already synchronized
    if (entry.status === DriftStatus.MATCH) {
      console.log(`✓ Already synchronized: ${entry.name}`);
      continue;
    }

    // Handle MISSING and DRIFT
    const destDir = dirname(entry.destination);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    if (entry.status === DriftStatus.DRIFT) {
      console.log(`⚠ Drift detected, replacing: ${entry.name}`);
    } else {
      console.log(`✓ Installing missing: ${entry.name}`);
    }

    copyFileSync(entry.source, entry.destination);
  }

  console.log();
}

/**
 * Install binaries with drift-aware semantics
 */
function installBinaries(driftResult, backupDir) {
  console.log('Installing binaries...\n');

  const { results } = driftResult;

  // Ensure bin directory exists
  mkdirSync(CONFIG.binDir, { recursive: true });

  for (const entry of results) {
    if (entry.type !== 'binary') continue;

    // Skip EXTRA files
    if (entry.status === DriftStatus.EXTRA) {
      console.log(`⊕ Skipping extra binary: ${entry.name}`);
      continue;
    }

    // Skip MATCH files
    if (entry.status === DriftStatus.MATCH) {
      console.log(`✓ Already synchronized: ${entry.name}`);
      continue;
    }

    // Install/replace binary
    if (entry.status === DriftStatus.DRIFT) {
      console.log(`⚠ Drift detected, replacing: ${entry.name}`);
    } else {
      console.log(`✓ Installing missing: ${entry.name}`);
    }

    writeFileSync(entry.destination, entry.sourceContent, 'utf8');
    execSync(`chmod +x "${entry.destination}"`, { stdio: 'inherit' });
    console.log(`  Installed to: ${entry.destination}`);
  }

  console.log();
}

/**
 * Patch OpenCode config with drift-aware semantics
 */
function patchOpenCodeConfig(driftResult, backupFile) {
  console.log('Patching OpenCode configuration...\n');

  const { results } = driftResult;
  const configEntry = results.find(r => r.type === 'opencode-config');

  if (!configEntry) {
    console.log('✓ No opencode-config in manifest');
    return;
  }

  const sourceConfigPath = configEntry.source;

  if (!existsSync(sourceConfigPath)) {
    throw new Error('Source opencode.json not found');
  }

  // Read source config
  const sourceConfigData = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));

  // Skip if MATCH
  if (configEntry.status === DriftStatus.MATCH) {
    console.log('✓ opencode.json already synchronized');
    return;
  }

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

  if (configEntry.status === DriftStatus.DRIFT) {
    console.log('⚠ Drift detected, replaced opencode.json');
  } else {
    console.log('✓ Installed opencode.json');
  }
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
 * Validate installation - check for 8 agents
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

  // Check for 8 agents
  const agentFiles = [
    'orchestrator.md',
    'planner.md',
    'coder.md',
    'verifier.md',
    'reviewer.md',
    'researcher.md',
    'judge.md',
    'committer.md',
  ];

  let agentsFound = 0;
  if (agentsDirExists) {
    for (const agentFile of agentFiles) {
      const agentPath = join(CONFIG.agentsDir, agentFile);
      if (existsSync(agentPath)) {
        agentsFound++;
      }
    }
  }
  checks.push({ name: 'agents (8)', path: null, ok: agentsFound === 8, detail: `${agentsFound}/8` });

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

  let orientationFound = 0;
  if (orientationDirExists) {
    for (const file of orientationFiles) {
      const filePath = join(CONFIG.orientationDir, file);
      if (existsSync(filePath)) {
        orientationFound++;
      }
    }
  }
  checks.push({ name: 'orientation files (7)', path: null, ok: orientationFound === 7, detail: `${orientationFound}/7` });

  // Report results
  for (const check of checks) {
    if (check.ok) {
      const detail = check.detail ? ` (${check.detail})` : '';
      console.log(`✓ ${check.name}${detail}: ${check.path || 'OK'}`);
    } else {
      const detail = check.detail ? ` (${check.detail})` : '';
      console.error(`✗ ${check.name}${detail}: not found`);
    }
  }

  console.log();

  // Return overall status
  return checks.every(check => check.ok);
}

/**
 * Main installation function
>>>>>>> d0338ba (Add committer agent, quarantine incompatible skills, drift detection)
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

<<<<<<< HEAD
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
=======
    // Detect drift before any changes
    const driftResult = detectDrift();
    printDriftTable(driftResult);

    // Create install backup for files that will be replaced
    const installBackupDir = createInstallBackup(driftResult);

    // Backup existing config
    const configBackupFile = backupExistingConfig();

    // Install harness runtime (agents + orientation)
    installHarnessRuntime(driftResult, installBackupDir);

    // Install binaries
    installBinaries(driftResult, installBackupDir);

    // Patch OpenCode config
    patchOpenCodeConfig(driftResult, configBackupFile);
>>>>>>> d0338ba (Add committer agent, quarantine incompatible skills, drift detection)

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
<<<<<<< HEAD
      console.log(`Backup created at: ${backupDir}`);
      console.log('To rollback: harness rollback');
=======
      if (configBackupFile) {
        console.log('Config backup created at: ' + configBackupFile);
        console.log('To restore: ocode-harness restore');
      }
      if (installBackupDir) {
        console.log('Install backup created at: ' + installBackupDir);
      }
>>>>>>> d0338ba (Add committer agent, quarantine incompatible skills, drift detection)
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