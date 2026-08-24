#!/usr/bin/env node
import { program } from 'commander';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createLedgerRecord, appendRecord, readRecords, getLatestRecord, getRecentRecords, LEDGER_SCHEMA_VERSION } from '../lib/ledger.mjs';
import { generateTaskId, generateRunId } from '../lib/identity.mjs';
import { transition, LIFECYCLE_STATES } from '../lib/lifecycle.mjs';
import { evaluateGates, executeCloseout } from '../lib/closeout.mjs';
import { collectEvidence } from '../lib/evidence.mjs';
import { verifyCommand } from '../lib/verify.mjs';
import {
  stageCandidate,
  validateCandidate,
  promoteCandidate,
  rollbackCandidate,
  installLaunchers,
  installAgents,
  patchOpenCodeConfig,
  configureGitExcludes,
  validatePostPromotion,
  readVersion,
  findSourceRepo,
  writeVersion,
  CONFIG,
} from '../lib/deploy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

program
  .name('harness')
  .description('ocode-harness deterministic runtime')
  .version('0.1.0');

// Find project root
function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    const opencodeDir = resolve(dir, '.opencode');
    if (existsSync(opencodeDir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// Get installed version info
function getInstalledVersionInfo() {
  const harnessRoot = CONFIG.harnessRoot;
  const versionPath = join(harnessRoot, 'VERSION');
  const installedVersion = readVersion(versionPath);

  // Get doctrine/policy version
  let doctrineVersion = null;
  const policyVersionPath = join(harnessRoot, 'doctrine', 'policy-version.json');
  if (existsSync(policyVersionPath)) {
    try {
      const manifest = JSON.parse(readFileSync(policyVersionPath, 'utf8'));
      doctrineVersion = manifest.policy_version || manifest.doctrine?.version;
    } catch (err) {
      // ignore
    }
  }

  // Try to find source repo and get source version
  let sourceVersion = null;
  let sourceDiffers = false;
  const sourceRoot = findSourceRepo(process.cwd());
  if (sourceRoot) {
    const sourceVersionPath = join(sourceRoot, 'VERSION');
    sourceVersion = readVersion(sourceVersionPath);
    if (sourceVersion && installedVersion && sourceVersion !== installedVersion) {
      sourceDiffers = true;
    }
  }

  return {
    installed_version: installedVersion,
    source_version: sourceVersion,
    doctrine_version: doctrineVersion,
    source_differs: sourceDiffers,
    source_repo: sourceRoot,
  };
}

// VERSION SUBCOMMAND
program
  .command('version')
  .description('Report installed, source, and doctrine versions')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const info = getInstalledVersionInfo();

    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
    } else {
      console.log('=== ocode-harness Version ===\n');
      console.log(`Installed version: ${info.installed_version || 'not found'}`);
      console.log(`Source version:    ${info.source_version || 'not detected'}`);
      console.log(`Doctrine version:  ${info.doctrine_version || 'not found'}`);
      if (info.source_repo) {
        console.log(`Source repo:       ${info.source_repo}`);
      }
      if (info.source_differs) {
        console.log('\n⚠ Source and installed versions differ');
      } else if (info.installed_version && info.source_version) {
        console.log('\n✓ Source and installed versions match');
      }
    }
    process.exit(0);
  });

// UPDATE SUBCOMMAND
program
  .command('update')
  .description('Update installation from source repository with staged promotion')
  .option('--force', 'Force update even if versions match')
  .action(async (options) => {
    console.log('=== ocode-harness Update ===\n');

    try {
      // Find source repo
      const sourceRoot = findSourceRepo(process.cwd());
      if (!sourceRoot) {
        throw new Error('Could not find source repository. Run from within the ocode-harness repo or ensure VERSION, installer/install.mjs, agents/, packages/ exist.');
      }
      console.log(`Source repository: ${sourceRoot}`);

      // Read source version
      const sourceVersion = readVersion(join(sourceRoot, 'VERSION'));
      if (!sourceVersion) {
        throw new Error('Could not read VERSION from source repository');
      }
      console.log(`Source version: ${sourceVersion}`);

      // Read installed version
      const installedVersion = readVersion(join(CONFIG.harnessRoot, 'VERSION'));
      console.log(`Installed version: ${installedVersion || 'none'}`);

      // Check if update needed
      if (!options.force && installedVersion === sourceVersion) {
        console.log('\n✓ Already at latest version. Use --force to reinstall.');
        process.exit(0);
      }

      // Stage candidate
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const stagingDir = join(CONFIG.stagingDir, timestamp);
      console.log(`\nStaging candidate to ${stagingDir}...`);
      stageCandidate(sourceRoot, stagingDir, sourceVersion);

      // Validate candidate
      console.log('\nValidating candidate...');
      const isValid = validateCandidate(stagingDir);
      if (!isValid) {
        throw new Error('Candidate validation failed');
      }

      // Promote candidate (with backup)
      console.log('\nPromoting candidate...');
      const backupDir = promoteCandidate(stagingDir, CONFIG.harnessRoot, CONFIG.backupDir);
      console.log(`Backup preserved at: ${backupDir}`);

      // Install launchers from promoted installation
      console.log('\nUpdating launchers...');
      installLaunchers(CONFIG.harnessRoot);

      // Install agents
      console.log('\nUpdating agents...');
      installAgents(CONFIG.harnessRoot);

      // Patch OpenCode config
      patchOpenCodeConfig(CONFIG.harnessRoot);

      // Configure Git excludes
      configureGitExcludes();

      // Post-promotion validation
      console.log('\nRunning post-promotion validation...');
      const postValid = validatePostPromotion(CONFIG.harnessRoot);

      if (!postValid) {
        throw new Error('Post-promotion validation failed');
      }

      console.log('\n✓ Update complete');
      console.log(`  Version: ${sourceVersion}`);
      console.log(`  Backup: ${backupDir}`);

    } catch (error) {
      console.error('\n✗ Update failed:', error.message);
      console.error('Attempting rollback...');

      try {
        const result = rollbackCandidate(CONFIG.backupDir, CONFIG.harnessRoot);
        console.log(`✓ Rollback complete, restored version: ${result.restoredVersion}`);
        console.log(`  From backup: ${result.backupUsed}`);
      } catch (rollbackErr) {
        console.error('✗ Rollback also failed:', rollbackErr.message);
        console.error('Installation may be in inconsistent state!');
      }

      process.exit(1);
    }
  });

// ROLLBACK SUBCOMMAND
program
  .command('rollback')
  .description('Rollback to previous installation from backup')
  .action(() => {
    console.log('=== ocode-harness Rollback ===\n');

    try {
      const result = rollbackCandidate(CONFIG.backupDir, CONFIG.harnessRoot);

      // Reinstall launchers from restored installation
      console.log('\nReinstalling launchers...');
      installLaunchers(CONFIG.harnessRoot);

      // Reinstall agents
      console.log('\nReinstalling agents...');
      installAgents(CONFIG.harnessRoot);

      // Patch OpenCode config
      patchOpenCodeConfig(CONFIG.harnessRoot);

      // Post-rollback validation
      console.log('\nRunning post-rollback validation...');
      const postValid = validatePostPromotion(CONFIG.harnessRoot);

      if (!postValid) {
        throw new Error('Post-rollback validation failed');
      }

      console.log('\n✓ Rollback complete');
      console.log(`  Restored version: ${result.restoredVersion}`);
      console.log(`  From backup: ${result.backupUsed}`);

    } catch (error) {
      console.error('\n✗ Rollback failed:', error.message);
      process.exit(1);
    }
  });

// LEDGER COMMANDS
program
  .command('ledger append')
  .description('Append a validated record to the run ledger')
  .requiredOption('--project-name <name>', 'Project name')
  .requiredOption('--project-root <path>', 'Project root path')
  .requiredOption('--workflow <type>', 'Workflow type (QUICK|STANDARD|DEEP)')
  .requiredOption('--status <status>', 'Status (COMPLETE|BLOCKED|FAILED)')
  .requiredOption('--lifecycle-state <state>', 'Lifecycle state')
  .option('--task-id <id>', 'Task ID (generated if not provided)')
  .option('--run-id <id>', 'Run ID (generated if not provided)')
  .option('--reviewer-verdict <verdict>', 'Reviewer verdict (ACCEPT|REJECT|NONE)')
  .option('--repair-cycles <n>', 'Number of repair cycles', '0')
  .option('--planner-used', 'Whether planner was used')
  .option('--research-used', 'Whether researcher was used')
  .option('--agents-used <list>', 'Comma-separated agents used')
  .option('--agents-skipped <list>', 'Comma-separated agents skipped')
  .option('--files-changed <list>', 'Comma-separated files changed')
  .option('--validation-commands <list>', 'Comma-separated validation commands')
  .option('--validation-results <list>', 'Comma-separated validation results (PASS|FAIL)')
  .option('--closeout-attempted', 'Whether closeout was attempted')
  .option('--closeout-committed', 'Whether closeout committed')
  .option('--closeout-pushed', 'Whether closeout pushed')
  .option('--commit-sha <sha>', 'Commit SHA')
  .option('--branch <name>', 'Branch name')
  .option('--remote <name>', 'Remote name')
  .action(async (options) => {
    try {
      const projectRoot = findProjectRoot(options.projectRoot);
      const ledgerPath = resolve(projectRoot, '.opencode', 'run-ledger.jsonl');

      const record = createLedgerRecord({
        task_id: options.taskId,
        run_id: options.runId,
        project_name: options.projectName,
        project_root: projectRoot,
        workflow: options.workflow,
        status: options.status,
        lifecycle_state: options.lifecycleState,
        reviewer_verdict: options.reviewerVerdict || 'NONE',
        repair_cycles: parseInt(options.repairCycles, 10),
        planner_used: !!options.plannerUsed,
        research_used: !!options.researchUsed,
        agents_used: options.agentsUsed ? options.agentsUsed.split(',') : [],
        agents_skipped: options.agentsSkipped ? options.agentsSkipped.split(',') : [],
        files_changed: options.filesChanged ? options.filesChanged.split(',') : [],
        validation_commands: options.validationCommands ? options.validationCommands.split(',') : [],
        validation_results: options.validationResults ? options.validationResults.split(',') : [],
        closeout: {
          attempted: !!options.closeoutAttempted,
          committed: !!options.closeoutCommitted,
          pushed: !!options.closeoutPushed,
          commit_sha: options.commitSha || null,
          branch: options.branch || null,
          remote: options.remote || null
        }
      });

      appendRecord(ledgerPath, record);
      console.log('✓ Ledger record appended');
      console.log(`  Task ID: ${record.task_id}`);
      console.log(`  Run ID: ${record.run_id}`);
      console.log(`  Status: ${record.status}`);
    } catch (err) {
      console.error('✗ Failed to append ledger record:', err.message);
      process.exit(1);
    }
  });

program
  .command('ledger latest')
  .description('Get the latest ledger record')
  .option('--project-root <path>', 'Project root path', process.cwd())
  .action((options) => {
    try {
      const projectRoot = findProjectRoot(options.projectRoot);
      const ledgerPath = resolve(projectRoot, '.opencode', 'run-ledger.jsonl');
      const record = getLatestRecord(ledgerPath);

      if (record) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log('No records found');
      }
    } catch (err) {
      console.error('✗ Failed to read ledger:', err.message);
      process.exit(1);
    }
  });

program
  .command('ledger list')
  .description('List recent ledger records')
  .option('--project-root <path>', 'Project root path', process.cwd())
  .option('--count <n>', 'Number of records', '10')
  .action((options) => {
    try {
      const projectRoot = findProjectRoot(options.projectRoot);
      const ledgerPath = resolve(projectRoot, '.opencode', 'run-ledger.jsonl');
      const records = getRecentRecords(ledgerPath, parseInt(options.count, 10));

      console.log(JSON.stringify(records, null, 2));
    } catch (err) {
      console.error('✗ Failed to read ledger:', err.message);
      process.exit(1);
    }
  });

// LIFECYCLE COMMANDS
program
  .command('lifecycle transition')
  .description('Validate and perform a lifecycle state transition')
  .requiredOption('--from <state>', 'Current state')
  .requiredOption('--to <state>', 'Target state')
  .action((options) => {
    try {
      const newState = transition(options.from, options.to);
      console.log(`✓ Transition allowed: ${options.from} → ${newState}`);
    } catch (err) {
      console.error(`✗ Illegal transition: ${err.message}`);
      process.exit(1);
    }
  });

// CLOSEOUT COMMANDS
program
  .command('closeout')
  .description('Execute deterministic Git closeout')
  .requiredOption('--project-root <path>', 'Project root path')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--run-id <id>', 'Run ID')
  .requiredOption('--lifecycle-state <state>', 'Current lifecycle state')
  .requiredOption('--workflow <type>', 'Workflow type (QUICK|STANDARD|DEEP)')
  .requiredOption('--reviewer-verdict <verdict>', 'Reviewer verdict (ACCEPT|REJECT|NONE)')
  .option('--verifier-result <result>', 'Verifier result (PASS|FAIL|NONE)', 'NONE')
  .requiredOption('--commit-subject <subject>', 'Commit subject')
  .option('--commit-body <body>', 'Commit body')
  .option('--expected-paths <list>', 'Comma-separated expected paths')
  .option('--push', 'Push after commit')
  .option('--remote <name>', 'Remote name')
  .option('--branch <name>', 'Branch name')
  .action(async (options) => {
    try {
      const projectRoot = resolve(options.projectRoot);
      const expectedPaths = options.expectedPaths ? options.expectedPaths.split(',') : [];

      const context = {
        taskId: options.taskId,
        runId: options.runId,
        lifecycleState: options.lifecycleState,
        workflow: options.workflow,
        reviewerVerdict: options.reviewerVerdict,
        verifierResult: options.verifierResult,
        expectedPaths,
        projectRoot,
        commitSubject: options.commitSubject,
        commitBody: options.commitBody,
        push: !!options.push,
        remote: options.remote,
        branch: options.branch
      };

      const result = executeCloseout(context);
      console.log(JSON.stringify(result, null, 2));

      if (result.status !== 'PASS') {
        process.exit(1);
      }
    } catch (err) {
      console.error('✗ Closeout failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('closeout gates')
  .description('Evaluate closeout gates without executing')
  .requiredOption('--project-root <path>', 'Project root path')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--run-id <id>', 'Run ID')
  .requiredOption('--lifecycle-state <state>', 'Current lifecycle state')
  .requiredOption('--workflow <type>', 'Workflow type (QUICK|STANDARD|DEEP)')
  .requiredOption('--reviewer-verdict <verdict>', 'Reviewer verdict (ACCEPT|REJECT|NONE)')
  .option('--verifier-result <result>', 'Verifier result (PASS|FAIL|NONE)', 'NONE')
  .option('--expected-paths <list>', 'Comma-separated expected paths')
  .option('--remote <name>', 'Remote name')
  .option('--branch <name>', 'Branch name')
  .action((options) => {
    try {
      const projectRoot = resolve(options.projectRoot);
      const expectedPaths = options.expectedPaths ? options.expectedPaths.split(',') : [];

      const context = {
        taskId: options.taskId,
        runId: options.runId,
        lifecycleState: options.lifecycleState,
        workflow: options.workflow,
        reviewerVerdict: options.reviewerVerdict,
        verifierResult: options.verifierResult,
        expectedPaths,
        projectRoot,
        remote: options.remote,
        branch: options.branch
      };

      const result = evaluateGates(context);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('✗ Gate evaluation failed:', err.message);
      process.exit(1);
    }
  });

// EVIDENCE COMMANDS
program
  .command('evidence collect')
  .description('Collect deterministic evidence from repository')
  .option('--project-root <path>', 'Project root path', process.cwd())
  .action((options) => {
    try {
      const projectRoot = resolve(options.projectRoot);
      const evidence = collectEvidence(projectRoot);
      console.log(JSON.stringify(evidence, null, 2));
    } catch (err) {
      console.error('✗ Evidence collection failed:', err.message);
      process.exit(1);
    }
  });

// VERIFY COMMANDS
program
  .command('verify')
  .description('Run deterministic validation commands (test, build, lint, typecheck, verify)')
  .option('--project-root <path>', 'Project root path', process.cwd())
  .option('--test <commands>', 'Comma-separated test commands')
  .option('--build <commands>', 'Comma-separated build commands')
  .option('--lint <commands>', 'Comma-separated lint commands')
  .option('--type-check <commands>', 'Comma-separated typecheck commands')
  .option('--verify <commands>', 'Comma-separated verify commands')
  .option('--commands <json>', 'JSON object with command arrays for each category')
  .option('--timeout <ms>', 'Per-command timeout in milliseconds', '120000')
  .action(async (options) => {
    await verifyCommand(options);
  });

program.parse();