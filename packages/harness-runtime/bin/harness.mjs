#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
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
  assertPromotableSourceIdentity,
  inspectSourceIdentity,
  isExactReleaseIdentity,
  readReleaseIdentity,
  sameReleaseIdentity,
  writeReleaseIdentity,
  CONFIG,
} from '../lib/deploy.mjs';
import { activateRelease, installVerifiedArtifact, listInstalledReleases, releaseEntrypoint, releaseStorePaths, resolveReleasePointer, rollbackRelease } from '../lib/release-store.mjs';

function toCamelCase(flag) {
  return flag.replace(/^--/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseOptionSpec(spec) {
  const flag = spec.split(/[ ,|]+/).find(part => part.startsWith('--'));
  if (!flag) throw new Error(`Unsupported option spec: ${spec}`);
  return { flag, name: toCamelCase(flag), takesValue: spec.includes('<') || spec.includes('[') };
}

class MiniCommand {
  constructor(name) {
    this.commandName = name;
    this.optionSpecs = [];
    this.handler = null;
  }
  description() { return this; }
  option(spec, _description, defaultValue) {
    this.optionSpecs.push({ ...parseOptionSpec(spec), required: false, defaultValue });
    return this;
  }
  requiredOption(spec, _description, defaultValue) {
    this.optionSpecs.push({ ...parseOptionSpec(spec), required: true, defaultValue });
    return this;
  }
  action(handler) {
    this.handler = handler;
    return this;
  }
}

class MiniProgram {
  constructor() {
    this.commands = [];
    this.versionValue = null;
  }
  name() { return this; }
  description() { return this; }
  version(value) {
    this.versionValue = value;
    return this;
  }
  command(name) {
    const command = new MiniCommand(name);
    this.commands.push(command);
    return command;
  }
  async parse(argv = process.argv) {
    const args = argv.slice(2);
    if (args.includes('--version') || args.includes('-V')) {
      console.log(this.versionValue || 'unknown');
      return;
    }

    const match = this.commands
      .map(command => ({ command, parts: command.commandName.split(' ') }))
      .filter(({ parts }) => parts.every((part, index) => args[index] === part))
      .sort((a, b) => b.parts.length - a.parts.length)[0];
    if (!match) {
      console.error(`Unknown command: ${args.join(' ') || '(none)'}`);
      process.exit(1);
    }

    const optionArgs = args.slice(match.parts.length);
    const options = {};
    const specsByFlag = new Map(match.command.optionSpecs.map(spec => [spec.flag, spec]));
    for (const spec of match.command.optionSpecs) {
      if (spec.defaultValue !== undefined) options[spec.name] = spec.defaultValue;
      else if (!spec.takesValue) options[spec.name] = false;
    }
    for (let i = 0; i < optionArgs.length; i++) {
      const token = optionArgs[i];
      if (!token.startsWith('--')) continue;
      const [flag, inlineValue] = token.split(/=(.*)/s, 2);
      const spec = specsByFlag.get(flag);
      if (!spec) throw new Error(`Unknown option for ${match.command.commandName}: ${flag}`);
      if (spec.takesValue) {
        const value = inlineValue !== undefined ? inlineValue : optionArgs[++i];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for option ${flag}`);
        options[spec.name] = value;
      } else options[spec.name] = true;
    }
    for (const spec of match.command.optionSpecs) {
      if (spec.required && (options[spec.name] === undefined || options[spec.name] === false)) {
        throw new Error(`Missing required option ${spec.flag}`);
      }
    }
    if (!match.command.handler) throw new Error(`No handler registered for ${match.command.commandName}`);
    await match.command.handler(options);
  }
}

const program = new MiniProgram();
program.name('harness').description('ocode-harness deterministic runtime').version('0.1.0');

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(resolve(dir, '.opencode'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function getInstalledVersionInfo() {
  const active = resolveReleasePointer(CONFIG.currentRelease, CONFIG.installStoreRoot);
  const harnessRoot = active?.path || CONFIG.harnessRoot;
  const installedVersion = readVersion(join(harnessRoot, 'VERSION'));
  const installedIdentity = readReleaseIdentity(harnessRoot);

  let doctrineVersion = null;
  const policyVersionPath = join(harnessRoot, 'doctrine', 'policy-version.json');
  if (existsSync(policyVersionPath)) {
    try {
      const manifest = JSON.parse(readFileSync(policyVersionPath, 'utf8'));
      doctrineVersion = manifest.policy_version || manifest.doctrine?.version;
    } catch {
      // Optional doctrine metadata must not hide release identity.
    }
  }

  let sourceVersion = null;
  let sourceIdentity = null;
  let sourceDiffers = false;
  const sourceRoot = findSourceRepo(process.cwd());
  if (sourceRoot) {
    sourceVersion = readVersion(join(sourceRoot, 'VERSION'));
    if (sourceVersion) sourceIdentity = inspectSourceIdentity(sourceRoot);
    if (sourceIdentity && installedIdentity
        && isExactReleaseIdentity(sourceIdentity)
        && isExactReleaseIdentity(installedIdentity)) {
      sourceDiffers = !sameReleaseIdentity(installedIdentity, sourceIdentity);
    } else if (sourceVersion && installedVersion) {
      sourceDiffers = sourceVersion !== installedVersion;
    }
  }

  return {
    installed_version: installedVersion,
    installed_sha: installedIdentity?.source_commit ?? null,
    installed_ref: installedIdentity?.source_ref ?? null,
    installed_identity_exact: isExactReleaseIdentity(installedIdentity),
    source_version: sourceVersion,
    source_sha: sourceIdentity?.source_commit ?? null,
    source_ref: sourceIdentity?.source_ref ?? null,
    source_dirty: sourceIdentity?.source_dirty ?? null,
    source_identity_exact: isExactReleaseIdentity(sourceIdentity),
    doctrine_version: doctrineVersion,
    source_differs: sourceDiffers,
    source_repo: sourceRoot,
    logical_release_id: active?.id ?? null,
    payload_manifest_sha256: active?.artifact.payload.manifest_sha256 ?? null,
    active_release_path: active?.path ?? null,
    archive_sha256: active?.archive_sha256 ?? null,
  };
}

program
  .command('version')
  .description('Report exact installed and checkout release identity')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const info = getInstalledVersionInfo();
    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
    } else {
      console.log('=== Ocode Release Identity ===\n');
      console.log('Installed:');
      console.log(`  Version: ${info.installed_version || 'not found'}`);
      console.log(`  SHA:     ${info.installed_sha || 'unavailable (legacy/non-Git release)'}`);
      console.log(`  Release: ${info.logical_release_id || 'not found'}`);
      console.log(`  Payload: ${info.payload_manifest_sha256 || 'not found'}`);
      console.log(`  Path:    ${info.active_release_path || 'not found'}`);
      console.log(`  Ref:     ${info.installed_ref || 'detached/unknown'}`);
      console.log('');
      console.log('Checkout:');
      console.log(`  Version: ${info.source_version || 'not detected'}`);
      console.log(`  SHA:     ${info.source_sha || 'unavailable'}`);
      console.log(`  Ref:     ${info.source_ref || 'detached/unknown'}`);
      console.log(`  Dirty:   ${info.source_dirty === null ? 'unknown' : info.source_dirty ? 'yes' : 'no'}`);
      console.log(`Doctrine:  ${info.doctrine_version || 'not found'}`);
      if (info.source_repo) console.log(`Source:    ${info.source_repo}`);
      if (info.source_differs) console.log('\nCheckout differs from installed release.');
      else if (info.installed_identity_exact && info.source_identity_exact) console.log('\nCheckout matches installed release exactly.');
      else if (info.installed_version && info.source_version) console.log('\nSemantic versions match; exact source identity is unavailable.');
    }
    process.exit(0);
  });

program
  .command('update')
  .description('Install a verified artifact and atomically activate its immutable release')
  .option('--artifact <path>', 'Phase-2 artifact to install (works without a checkout)')
  .option('--force', 'Build and install even when source identity appears unchanged')
  .action(async (options) => {
    console.log('=== Ocode Update ===\n');
    try {
      let archive = options.artifact ? resolve(options.artifact) : null, temporary = null;
      if (!archive) {
        const sourceRoot = findSourceRepo(process.cwd());
        if (!sourceRoot) throw new Error('Provide --artifact outside an ocode-harness checkout.');
        temporary = mkdtempSync(join(tmpdir(), 'ocode-update-'));
        const { buildReleaseArtifact } = await import(join(sourceRoot, 'scripts', 'release-artifact.mjs'));
        archive = buildReleaseArtifact({ sourceRoot, outputDir: temporary }).archive;
      }
      const installed = installVerifiedArtifact({ archive, installStore: CONFIG.installStoreRoot });
      const result = activateRelease(installed.id, CONFIG.installStoreRoot);
      installLaunchers(CONFIG.installStoreRoot);
      // External configuration remains deliberately outside release atomicity.
      installAgents(result.current.path); patchOpenCodeConfig(result.current.path); configureGitExcludes();
      console.log(`✓ Active immutable release: ${result.current.id}`);
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    } catch (error) {
      console.error('\n✗ Update failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('rollback')
  .description('Atomically switch current to the verified previous immutable release')
  .action(() => {
    console.log('=== ocode-harness Rollback ===\n');
    try {
      const result = rollbackRelease(CONFIG.installStoreRoot);
      console.log('\n✓ Rollback complete');
      console.log(`  Restored version: ${result.current.release.version}`);
      console.log(`  Restored SHA: ${result.current.release.source_commit}`);
    } catch (error) {
      console.error('\n✗ Rollback failed:', error.message);
      process.exit(1);
    }
  });

program.command('release list').description('List immutable installed releases').action(() => {
  for (const release of listInstalledReleases(CONFIG.installStoreRoot)) {
    const state = release.current ? 'CURRENT ' : release.previous ? 'PREVIOUS' : '        ';
    console.log(`${state} ${release.id} ${release.version} ${release.source_commit.slice(0, 7)}`);
  }
});
program.command('release current').description('Show current immutable release').action(() => {
  const current = resolveReleasePointer(CONFIG.currentRelease, CONFIG.installStoreRoot);
  if (!current) throw new Error('No active immutable release');
  console.log(JSON.stringify({ id: current.id, version: current.release.version, source_commit: current.release.source_commit, payload_manifest_sha256: current.artifact.payload.manifest_sha256, path: current.path }, null, 2));
});
program.command('release install').description('Install, without promoting, a verified artifact').option('--artifact <path>', 'Artifact path').action((options) => {
  const artifact = options.artifact || process.argv[4]; if (!artifact) throw new Error('Usage: ocode release install <artifact>');
  const release = installVerifiedArtifact({ archive: resolve(artifact), installStore: CONFIG.installStoreRoot });
  console.log(`INSTALLED ${release.id}`);
});
program.command('release promote').description('Promote an installed immutable release').option('--id <id>', 'Release ID').action((options) => {
  const id = options.id || process.argv[4]; if (!id) throw new Error('Usage: ocode release promote <release-id>');
  const result = activateRelease(id, CONFIG.installStoreRoot); console.log(`PROMOTED ${result.current.id}`);
});
program.command('release run').description('Run an installed candidate without promotion').option('--id <id>', 'Release ID').action((options) => {
  const id = options.id || process.argv[4]; if (!id) throw new Error('Usage: ocode release run <release-id> [args...]'); const index = process.argv.indexOf(id); const args = index < 0 ? [] : process.argv.slice(index + 1);
  const child = spawnSync('node', [releaseEntrypoint(id, CONFIG.installStoreRoot), ...args], { stdio: 'inherit', env: process.env });
  if (child.status !== 0) process.exit(child.status || 1);
});

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
      const record = getLatestRecord(resolve(projectRoot, '.opencode', 'run-ledger.jsonl'));
      if (record) console.log(JSON.stringify(record, null, 2));
      else console.log('No records found');
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
      const records = getRecentRecords(resolve(projectRoot, '.opencode', 'run-ledger.jsonl'), parseInt(options.count, 10));
      console.log(JSON.stringify(records, null, 2));
    } catch (err) {
      console.error('✗ Failed to read ledger:', err.message);
      process.exit(1);
    }
  });

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

program
  .command('closeout')
  .description('Execute deterministic Git closeout')
  .requiredOption('--project-root <path>', 'Project root path')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--run-id <id>', 'Run ID')
  .requiredOption('--lifecycle-state <state>', 'Current lifecycle state')
  .requiredOption('--workflow <type>', 'Workflow type (QUICK|STANDARD|DEEP)')
  .requiredOption('--reviewer-verdict <verdict>', 'Reviewer verdict (ACCEPT|REJECT|NONE)')
  .requiredOption('--task-capsule-fingerprint <sha256>', 'Canonical TaskCapsule fingerprint')
  .requiredOption('--reviewer-diff-fingerprint <sha256>', 'Worktree fingerprint observed by the accepting reviewer')
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
      const context = {
        taskId: options.taskId,
        runId: options.runId,
        lifecycleState: options.lifecycleState,
        workflow: options.workflow,
        reviewerVerdict: options.reviewerVerdict,
        taskCapsuleFingerprint: options.taskCapsuleFingerprint,
        reviewerDiffFingerprint: options.reviewerDiffFingerprint,
        verifierResult: options.verifierResult,
        expectedPaths: options.expectedPaths ? options.expectedPaths.split(',') : [],
        projectRoot,
        commitSubject: options.commitSubject,
        commitBody: options.commitBody,
        push: !!options.push,
        remote: options.remote,
        branch: options.branch
      };
      const result = executeCloseout(context);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== 'PASS') process.exit(1);
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
      const result = evaluateGates({
        taskId: options.taskId,
        runId: options.runId,
        lifecycleState: options.lifecycleState,
        workflow: options.workflow,
        reviewerVerdict: options.reviewerVerdict,
        verifierResult: options.verifierResult,
        expectedPaths: options.expectedPaths ? options.expectedPaths.split(',') : [],
        projectRoot,
        remote: options.remote,
        branch: options.branch
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('✗ Gate evaluation failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('evidence collect')
  .description('Collect deterministic evidence from repository')
  .option('--project-root <path>', 'Project root path', process.cwd())
  .action((options) => {
    try {
      console.log(JSON.stringify(collectEvidence(resolve(options.projectRoot)), null, 2));
    } catch (err) {
      console.error('✗ Evidence collection failed:', err.message);
      process.exit(1);
    }
  });

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

try {
  await program.parse();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
