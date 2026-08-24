#!/usr/bin/env node
/**
 * test-closeout.mjs
 * Test closeout runtime against isolated temp git directory
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-closeout-test-${Date.now()}`);
const harnessRuntimeDir = join(__dirname, '..', 'packages', 'harness-runtime');

console.log('=== Test Closeout Runtime ===\n');
console.log(`Test directory: ${testDir}\n`);

// Create test directory and initialize git repo
mkdirSync(testDir, { recursive: true });
execSync('git init', { cwd: testDir, stdio: 'ignore' });
execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'ignore' });
execSync('git remote add origin https://github.com/test/test.git', { cwd: testDir, stdio: 'ignore' });
execSync('git branch -M main', { cwd: testDir, stdio: 'ignore' });
// Create initial commit
writeFileSync(join(testDir, 'README.md'), '# Test Project\n', 'utf8');
execSync('git add README.md', { cwd: testDir, stdio: 'ignore' });
execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'ignore' });

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function makeCommitContext(overrides = {}) {
  return {
    taskId: '12345678-1234-4abc-8def-123456789abc',
    runId: '87654321-4321-4cba-fedc-ba9876543210',
    lifecycleState: 'CLOSEOUT_READY',
    workflow: 'QUICK',
    reviewerVerdict: 'ACCEPT',
    validationEvidence: { status: 'PASS', commands: ['npm test'] },
    verifierResult: 'PASS', // legacy, for backward compatibility
    expectedPaths: ['feature.txt'],
    observedPaths: [],
    projectRoot: testDir,
    gitRoot: testDir,
    branch: 'main',
    remote: 'origin',
    commitSubject: 'Add feature',
    commitBody: 'Add feature implementation',
    push: false,
    ...overrides,
  };
}

try {
  // Import the closeout module
  const closeoutPath = join(harnessRuntimeDir, 'lib', 'closeout.mjs');
  const closeoutModule = await import(closeoutPath);
  const { evaluateGates, executeCloseout } = closeoutModule;

  console.log('Testing evaluateGates...\n');

  // Test 1: Valid QUICK workflow with ACCEPT reviewer
  writeFileSync(join(testDir, 'feature.txt'), 'feature content', 'utf8');
  execSync('git add feature.txt', { cwd: testDir, stdio: 'ignore' });

  const context1 = makeCommitContext();
  const gates1 = evaluateGates(context1);
  assert(gates1.ok === true, 'Valid QUICK context passes gates');
  assert(gates1.blockers.length === 0, 'No blockers for valid context');
  assert(gates1.evidence.git_branch === 'main', 'Branch detected');
  assert(gates1.evidence.git_remote === 'origin', 'Remote detected');
  assert(gates1.reconciliation.match === true, 'Paths reconcile');

  // Test 2: Missing project root
  const context2 = makeCommitContext({ projectRoot: '', gitRoot: '' });
  const gates2 = evaluateGates(context2);
  assert(gates2.ok === false, 'Missing project root fails');
  assert(gates2.blockers.some(b => b.includes('Unknown project root')), 'Blocker for unknown project root');

  // Test 3: Missing task/run identity
  const context3 = makeCommitContext({ taskId: '', runId: '' });
  const gates3 = evaluateGates(context3);
  assert(gates3.ok === false, 'Missing identity fails');
  assert(gates3.blockers.some(b => b.includes('Missing task/run identity')), 'Blocker for missing identity');

  // Test 4: Wrong lifecycle state
  const context4 = makeCommitContext({ lifecycleState: 'ACTIVE' });
  const gates4 = evaluateGates(context4);
  assert(gates4.ok === false, 'Wrong lifecycle state fails');
  assert(gates4.blockers.some(b => b.includes('not CLOSEOUT_READY')), 'Blocker for wrong lifecycle state');

  // Test 5: Reviewer not ACCEPT
  const context5 = makeCommitContext({ reviewerVerdict: 'REJECT' });
  const gates5 = evaluateGates(context5);
  assert(gates5.ok === false, 'Reviewer REJECT fails');
  assert(gates5.blockers.some(b => b.includes('Reviewer verdict not ACCEPT')), 'Blocker for non-ACCEPT reviewer');

  // Test 6: STANDARD workflow requires validationEvidence PASS
  const context6 = makeCommitContext({ workflow: 'STANDARD', validationEvidence: { status: 'FAIL', commands: ['npm test'] } });
  const gates6 = evaluateGates(context6);
  assert(gates6.ok === false, 'STANDARD with validationEvidence FAIL fails');
  assert(gates6.blockers.some(b => b.includes('Validation evidence status not PASS')), 'Blocker for failed validation');

  // Test 7: DEEP workflow requires validationEvidence PASS
  const context7 = makeCommitContext({ workflow: 'DEEP', validationEvidence: { status: 'FAIL', commands: ['npm test'] } });
  const gates7 = evaluateGates(context7);
  assert(gates7.ok === false, 'DEEP with validationEvidence FAIL fails');
  assert(gates7.blockers.some(b => b.includes('Validation evidence status not PASS')), 'Blocker for failed validation');

  // Test 8: QUICK workflow does NOT require validationEvidence
  const context8 = makeCommitContext({ workflow: 'QUICK', validationEvidence: undefined });
  const gates8 = evaluateGates(context8);
  assert(gates8.ok === true, 'QUICK without validationEvidence passes');

  // Test 8b: STANDARD workflow with validationEvidence PASS passes
  const context8b = makeCommitContext({ workflow: 'STANDARD', validationEvidence: { status: 'PASS', commands: ['npm test', 'npm run build'] } });
  const gates8b = evaluateGates(context8b);
  assert(gates8b.ok === true, 'STANDARD with validationEvidence PASS passes');

  // Test 8c: DEEP workflow with validationEvidence PASS passes
  const context8c = makeCommitContext({ workflow: 'DEEP', validationEvidence: { status: 'PASS', commands: ['npm test', 'npm run build', 'npm run typecheck'] } });
  const gates8c = evaluateGates(context8c);
  assert(gates8c.ok === true, 'DEEP with validationEvidence PASS passes');

  // Test 8d: Backward compatibility - verifierResult used when validationEvidence not provided
  const context8d = makeCommitContext({ workflow: 'STANDARD', validationEvidence: undefined, verifierResult: 'PASS' });
  const gates8d = evaluateGates(context8d);
  assert(gates8d.ok === true, 'STANDARD with legacy verifierResult PASS passes (backward compat)');

  // Test 8e: Backward compatibility - verifierResult FAIL blocks when validationEvidence not provided
  const context8e = makeCommitContext({ workflow: 'STANDARD', validationEvidence: undefined, verifierResult: 'FAIL' });
  const gates8e = evaluateGates(context8e);
  assert(gates8e.ok === false, 'STANDARD with legacy verifierResult FAIL fails (backward compat)');
  assert(gates8e.blockers.some(b => b.includes('Validation evidence status not PASS')), 'Blocker for failed legacy verifier');

  // Test 9: Unexpected changed paths
  writeFileSync(join(testDir, 'unexpected.txt'), 'unexpected', 'utf8');
  execSync('git add unexpected.txt', { cwd: testDir, stdio: 'ignore' });

  const context9 = makeCommitContext({ expectedPaths: ['feature.txt'] });
  const gates9 = evaluateGates(context9);
  assert(gates9.ok === false, 'Unexpected paths fails');
  assert(gates9.blockers.some(b => b.includes('Unexpected changed paths')), 'Blocker for unexpected paths');
  assert(gates9.reconciliation.unexpected.length === 1, 'One unexpected path');
  assert(gates9.reconciliation.unexpected[0].path === 'unexpected.txt', 'Unexpected path is unexpected.txt');

  // Reset for next test
  execSync('git reset HEAD unexpected.txt', { cwd: testDir, stdio: 'ignore' });
  rmSync(join(testDir, 'unexpected.txt'), { force: true });

  // Test 10: Missing expected paths
  const context10 = makeCommitContext({ expectedPaths: ['feature.txt', 'missing.txt'] });
  const gates10 = evaluateGates(context10);
  assert(gates10.ok === false, 'Missing expected paths fails');
  assert(gates10.blockers.some(b => b.includes('Expected paths not changed')), 'Blocker for missing paths');
  assert(gates10.reconciliation.missing.length === 1, 'One missing path');
  assert(gates10.reconciliation.missing[0] === 'missing.txt', 'Missing path is missing.txt');

  // Test 11: Sensitive path blocking
  writeFileSync(join(testDir, '.env'), 'SECRET=value', 'utf8');
  execSync('git add .env', { cwd: testDir, stdio: 'ignore' });

  const context11 = makeCommitContext({ expectedPaths: ['.env'] });
  const gates11 = evaluateGates(context11);
  assert(gates11.ok === false, 'Sensitive path fails');
  assert(gates11.blockers.some(b => b.includes('Sensitive paths blocked')), 'Blocker for sensitive path');
  assert(gates11.blockers.some(b => b.includes('.env')), 'Blocker mentions .env');

  // Cleanup sensitive file
  execSync('git reset HEAD .env', { cwd: testDir, stdio: 'ignore' });
  rmSync(join(testDir, '.env'), { force: true });

  // Test 12: No remote configured for push
  execSync('git remote remove origin', { cwd: testDir, stdio: 'ignore' });
  const context12 = makeCommitContext({ push: true, remote: '', branch: 'main' });
  const gates12 = evaluateGates(context12);
  assert(gates12.ok === false, 'No remote for push fails');
  assert(gates12.blockers.some(b => b.includes('No remote configured')), 'Blocker for no remote');
  // Re-add remote for subsequent tests
  execSync('git remote add origin https://github.com/test/test.git', { cwd: testDir, stdio: 'ignore' });

  // Reset to clean state for executeCloseout tests
  execSync('git reset HEAD', { cwd: testDir, stdio: 'ignore' });
  execSync('git checkout -- .', { cwd: testDir, stdio: 'ignore' });
  execSync('git clean -fd', { cwd: testDir, stdio: 'ignore' });

  console.log('\nTesting executeCloseout...\n');

  // Test 13: Execute closeout - valid QUICK
  writeFileSync(join(testDir, 'feature2.txt'), 'feature2 content', 'utf8');
  const context13 = makeCommitContext({
    expectedPaths: ['feature2.txt'],
    commitSubject: 'Add feature2',
    commitBody: 'Add feature2 implementation',
  });
  const gates13 = evaluateGates(context13);
  console.log('  Debug gates13:', JSON.stringify(gates13, null, 2));
  const result13 = executeCloseout(context13);
  console.log('  Debug result13:', JSON.stringify(result13, null, 2));
  assert(result13.status === 'PASS', 'Valid closeout executes successfully');
  assert(result13.commit_sha !== undefined, 'Commit SHA returned');
  assert(result13.commit_sha.length === 40, 'Commit SHA is 40 chars');
  assert(result13.branch === 'main', 'Branch returned');
  assert(result13.remote === 'origin', 'Remote returned');
  assert(result13.pushed === false, 'Push is false by default');
  assert(result13.blockers.length === 0, 'No blockers');

  // Verify commit exists
  const logOutput = execSync('git log --oneline -1', { cwd: testDir, encoding: 'utf8' }).trim();
  assert(logOutput.includes('Add feature2'), 'Commit message in log');

  // Test 14: Execute closeout - blocked by gates
  const context14 = makeCommitContext({ lifecycleState: 'ACTIVE' });
  const result14 = executeCloseout(context14);
  assert(result14.status === 'BLOCKED', 'Blocked by gates returns BLOCKED');
  assert(result14.reason !== undefined, 'Reason provided');
  assert(result14.blockers.length > 0, 'Blockers listed');

  // Test 15: Execute closeout - no paths to commit
  const context15 = makeCommitContext({ expectedPaths: [] });
  const result15 = executeCloseout(context15);
  assert(result15.status === 'BLOCKED', 'No paths returns BLOCKED');
  assert(result15.blockers.some(b => b.includes('No changed paths to commit')), 'Blocker for no paths');

  // Test 16: Execute closeout with push
  writeFileSync(join(testDir, 'feature3.txt'), 'feature3 content', 'utf8');
  const context16 = makeCommitContext({
    expectedPaths: ['feature3.txt'],
    commitSubject: 'Add feature3',
    push: true,
    remote: 'origin',
    branch: 'main',
  });
  // Note: push will fail because remote doesn't actually exist, but we test the logic
  const result16 = executeCloseout(context16);
  // Since remote doesn't exist, push should fail or be blocked
  // The executeCloseout handles this by checking remote/branch before push
  assert(result16.status === 'BLOCKED' || result16.status === 'FAILED', 'Push to non-existent remote is blocked or fails');

  // Test 17: Sensitive path patterns
  const sensitivePatterns = [
    '.env',
    '.env.local',
    'secret.key',
    'private.pem',
    'id_rsa',
    'credentials.json',
    'secrets.yml',
  ];
  // These are tested in isSensitivePath function
  // We test the function indirectly through evaluateGates

  // Test 18: Non-git directory handling
  const nonGitDir = join(tmpdir(), `ocode-harness-nongit-closeout-${Date.now()}`);
  mkdirSync(nonGitDir, { recursive: true });
  writeFileSync(join(nonGitDir, 'file.txt'), 'content', 'utf8');

  const context18 = makeCommitContext({ projectRoot: nonGitDir, gitRoot: nonGitDir });
  const gates18 = evaluateGates(context18);
  assert(gates18.ok === false, 'Non-git directory fails');
  assert(gates18.blockers.some(b => b.includes('Could not determine git branch')), 'Blocker for no git branch');
  assert(gates18.evidence.git_branch === null, 'Evidence has null branch');

  // Cleanup non-git dir
  rmSync(nonGitDir, { recursive: true, force: true });

} catch (error) {
  console.error('\n✗ Test execution failed:', error.message);
  console.error(error.stack);
  failed++;
} finally {
  // Cleanup
  rmSync(testDir, { recursive: true, force: true });
}

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
  console.log('\n✓ All tests passed');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed');
  process.exit(1);
}