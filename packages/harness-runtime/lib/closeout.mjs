import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { collectEvidence, getChangedPaths, reconcilePaths } from './evidence.mjs';
import { LIFECYCLE_STATES } from './lifecycle.mjs';
import { createStagingAuthorization, executeDeterministicStaging } from './deterministic-staging.mjs';

const SENSITIVE_PATTERNS = [
  /^\.env($|\.)/,
  /\.key$/,
  /\.pem$/,
  /^id_rsa/,
  /\.secret$/,
  /^credentials/,
  /^secrets/
];

function isSensitivePath(path) {
  const basename = path.split('/').pop();
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(basename));
}

/**
 * Evaluate closeout gates for deterministic validation.
 * 
 * For STANDARD/DEEP workflows, requires validationEvidence.status === 'PASS'
 * (replacing the legacy verifierResult === 'PASS' gate).
 * QUICK workflow does not require validation evidence.
 * 
 * @param {Object} context - Closeout context
 * @param {string} context.taskId - Task UUID
 * @param {string} context.runId - Run UUID
 * @param {string} context.lifecycleState - Current lifecycle state (must be CLOSEOUT_READY)
 * @param {string} context.workflow - Workflow type: QUICK, STANDARD, or DEEP
 * @param {string} context.reviewerVerdict - Reviewer verdict (must be ACCEPT)
 * @param {Object} [context.validationEvidence] - Validation evidence object with status and commands
 * @param {string} context.validationEvidence.status - 'PASS' or 'FAIL'
 * @param {Array} context.validationEvidence.commands - Array of validation commands executed
 * @param {string} [context.verifierResult] - Legacy verifier result (deprecated, for backward compatibility)
 * @param {Array} [context.expectedPaths] - Expected changed paths
 * @param {Array} [context.observedPaths] - Observed changed paths
 * @param {string} context.projectRoot - Project root path
 * @param {string} context.gitRoot - Git root path
 * @param {string} [context.branch] - Git branch
 * @param {string} [context.remote] - Git remote
 * @returns {{ok: boolean, blockers: string[], evidence: Object, reconciliation: Object, observedPaths: string[]}}
 */
function evaluateCloseoutGates(context) {
  const { 
    taskId, runId, lifecycleState, workflow, 
    reviewerVerdict, validationEvidence, verifierResult,
    expectedPaths, observedPaths,
    projectRoot, gitRoot,
    branch, remote
  } = context;
  
  const blockers = [];
  
  if (!projectRoot) blockers.push('Unknown project root');
  if (!taskId || !runId) blockers.push('Missing task/run identity');
  if (lifecycleState !== 'CLOSEOUT_READY') {
    blockers.push(`Lifecycle state not CLOSEOUT_READY (current: ${lifecycleState})`);
  }
  if (reviewerVerdict !== 'ACCEPT') blockers.push('Reviewer verdict not ACCEPT');
  
  // Validation evidence gate for STANDARD/DEEP workflows
  // Uses validationEvidence.status (new deterministic approach)
  // Falls back to verifierResult for backward compatibility
  if (workflow === 'STANDARD' || workflow === 'DEEP') {
    const validationStatus = validationEvidence?.status ?? verifierResult;
    if (validationStatus !== 'PASS') {
      blockers.push('Validation evidence status not PASS (required for STANDARD/DEEP)');
    }
  }
  
  // Collect evidence to check git state
  const evidence = collectEvidence(projectRoot);
  if (evidence.merge_conflict) blockers.push('Unresolved merge conflict detected');
  if (!evidence.git_branch) blockers.push('Could not determine git branch');
  
  // Reconcile expected vs observed paths
  const observed = getChangedPaths(projectRoot);
  const reconciliation = reconcilePaths(expectedPaths || [], observed);
  if (!reconciliation.match) {
    if (reconciliation.unexpected.length > 0) {
      blockers.push(`Unexpected changed paths: ${reconciliation.unexpected.map(u => u.path).join(', ')}`);
    }
    if (reconciliation.missing.length > 0) {
      blockers.push(`Expected paths not changed: ${reconciliation.missing.join(', ')}`);
    }
  }
  
  // Check for sensitive paths in observed changes
  const sensitivePaths = observed.filter(o => isSensitivePath(o.path));
  if (sensitivePaths.length > 0) {
    blockers.push(`Sensitive paths blocked: ${sensitivePaths.map(s => s.path).join(', ')}`);
  }
  
  // Check remote exists
  if (!remote && !evidence.git_remote) {
    blockers.push('No remote configured for push');
  }
  
  return { 
    ok: blockers.length === 0, 
    blockers,
    evidence,
    reconciliation,
    observedPaths: observed.map(o => o.path)
  };
}

function createCommit(projectRoot, subject, body) {
  const absoluteRoot = resolve(projectRoot);
  const args = ['commit', '-m', subject];
  if (body) {
    args.push('-m', body);
  }
  execFileSync('git', args, { cwd: absoluteRoot, encoding: 'utf8' });
  
  // Get the new commit SHA
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: absoluteRoot, encoding: 'utf8' }).trim();
  return sha;
}

function pushCommit(projectRoot, remote, branch) {
  const absoluteRoot = resolve(projectRoot);
  execFileSync('git', ['push', remote, branch], { cwd: absoluteRoot, encoding: 'utf8' });
}

export function evaluateGates(context) {
  return evaluateCloseoutGates(context);
}

export function executeCloseout(context) {
  const { projectRoot, commitSubject, commitBody, expectedPaths, push = false, taskCapsuleFingerprint, reviewerDiffFingerprint } = context;
  
  // Evaluate gates first
  const gateResult = evaluateCloseoutGates(context);
  if (!gateResult.ok) {
    return {
      status: 'BLOCKED',
      reason: gateResult.blockers.join('; '),
      blockers: gateResult.blockers,
      unexpected_paths: gateResult.reconciliation?.unexpected?.map(u => u.path) || []
    };
  }
  
  // Stage expected paths
  const observedPaths = gateResult.observedPaths;
  const pathsToStage = expectedPaths.length > 0 ? expectedPaths : observedPaths;
  
  if (pathsToStage.length === 0) {
    return {
      status: 'BLOCKED',
      reason: 'No paths to commit',
      blockers: ['No changed paths to commit'],
      unexpected_paths: []
    };
  }
  
  try {
    const stagingAuthorization = createStagingAuthorization({
      projectRoot,
      accepted_paths: pathsToStage,
      reviewer_verdict: context.reviewerVerdict,
      lifecycle_state: context.lifecycleState,
      validation_status: context.validationEvidence?.status ?? context.verifierResult,
      task_capsule_fingerprint: taskCapsuleFingerprint,
      reviewer_diff_fingerprint: reviewerDiffFingerprint,
    });
    const staging = executeDeterministicStaging({ projectRoot, authorization: stagingAuthorization });
    
    // Commit
    const commitSha = createCommit(projectRoot, commitSubject, commitBody);
    
    // Push if requested
    let pushed = false;
    let pushRemote = null;
    let pushBranch = null;
    
    if (push) {
      const evidence = gateResult.evidence;
      pushRemote = context.remote || evidence.git_remote;
      pushBranch = context.branch || evidence.git_branch;
      
      if (!pushRemote || !pushBranch) {
        return {
          status: 'BLOCKED',
          reason: 'Remote or branch not available for push',
          commit_sha: commitSha,
          branch: pushBranch,
          remote: pushRemote,
          pushed: false,
          blockers: ['Missing remote or branch for push'],
          unexpected_paths: []
        };
      }
      
      pushCommit(projectRoot, pushRemote, pushBranch);
      pushed = true;
    }
    
    return {
      status: 'PASS',
      commit_sha: commitSha,
      branch: gateResult.evidence.git_branch,
      remote: gateResult.evidence.git_remote,
      pushed,
      staged_paths: staging.staged_paths,
      staging_authorization_fingerprint: staging.authorization_fingerprint,
      blockers: [],
      unexpected_paths: []
    };
  } catch (err) {
    return {
      status: 'FAILED',
      reason: err.message,
      blockers: [err.message],
      unexpected_paths: []
    };
  }
}
