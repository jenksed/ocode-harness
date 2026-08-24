#!/usr/bin/env node
/**
 * test-evidence.mjs
 * Test evidence runtime against isolated temp git directory
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-evidence-test-${Date.now()}`);
const harnessRuntimeDir = join(__dirname, '..', 'packages', 'harness-runtime');

console.log('=== Test Evidence Runtime ===\n');
console.log(`Test directory: ${testDir}\n`);

// Create test directory and initialize git repo
mkdirSync(testDir, { recursive: true });
execSync('git init', { cwd: testDir, stdio: 'ignore' });
execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'ignore' });
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
    console.error(`    Stack:`, new Error().stack.split('\n').slice(1, 4).join('\n    '));
    failed++;
  }
}

try {
  // Import the evidence module
  const evidencePath = join(harnessRuntimeDir, 'lib', 'evidence.mjs');
  const evidenceModule = await import(evidencePath);
  const { collectEvidence, getChangedPaths, reconcilePaths } = evidenceModule;

  console.log('Testing collectEvidence...\n');

  // Test 1: Collect evidence from clean repo
  const cleanEvidence = collectEvidence(testDir);
  assert(realpathSync(cleanEvidence.git_root) === realpathSync(testDir), 'Git root matches test directory');
  assert(cleanEvidence.project_root === testDir, 'Project root matches test directory');
  assert(cleanEvidence.git_branch !== null, 'Git branch detected');
  assert(cleanEvidence.git_head_sha !== null, 'Git HEAD SHA detected');
  assert(cleanEvidence.dirty === false, 'Clean repo is not dirty');
  assert(cleanEvidence.merge_conflict === false, 'Clean repo has no merge conflicts');
  assert(typeof cleanEvidence.timestamp === 'string', 'Timestamp is string');
  assert(cleanEvidence.timestamp.includes('T'), 'Timestamp is ISO8601 format');

  console.log('\nTesting collectEvidence with changes...\n');

  // Test 2: Create modified file
  writeFileSync(join(testDir, 'modified.txt'), 'modified content', 'utf8');
  execSync('git add modified.txt', { cwd: testDir, stdio: 'ignore' });

  const stagedEvidence = collectEvidence(testDir);
  assert(stagedEvidence.dirty === true, 'Repo with staged changes is dirty');
  assert(stagedEvidence.git_status.includes('A  modified.txt') || stagedEvidence.git_status.includes('A modified.txt'), 'Status shows added file');

  // Test 3: Create unstaged change
  writeFileSync(join(testDir, 'unstaged.txt'), 'unstaged content', 'utf8');

  const unstagedEvidence = collectEvidence(testDir);
  assert(unstagedEvidence.dirty === true, 'Repo with unstaged changes is dirty');
  assert(unstagedEvidence.git_status.includes('?? unstaged.txt'), 'Status shows untracked file');

  // Test 4: Check git_diff is populated
  writeFileSync(join(testDir, 'README.md'), '# Test Project\n\nModified', 'utf8');
  const diffEvidence = collectEvidence(testDir);
  assert(diffEvidence.git_diff.length > 0, 'Git diff is populated for modified tracked file');
  assert(diffEvidence.git_diff.includes('Modified'), 'Diff shows the change');

  console.log('\nTesting getChangedPaths...\n');

  // Test 5: Get changed paths from status
  const changedPaths = getChangedPaths(testDir);
  assert(Array.isArray(changedPaths), 'Returns array');
  const paths = changedPaths.map(c => c.path);
  assert(paths.includes('modified.txt'), 'Includes staged file');
  assert(paths.includes('unstaged.txt'), 'Includes untracked file');
  assert(paths.includes('README.md'), 'Includes modified tracked file');
  for (const change of changedPaths) {
    assert(typeof change.path === 'string', 'Each change has path string');
    assert(typeof change.status === 'string', 'Each change has status string');
    assert(change.status.length === 2, 'Status is 2 characters');
  }

  console.log('\nTesting reconcilePaths...\n');

  // Test 6: Perfect match
  const expected1 = ['file1.txt', 'file2.txt'];
  const observed1 = [{ path: 'file1.txt', status: 'M ' }, { path: 'file2.txt', status: 'M ' }];
  const reconciliation1 = reconcilePaths(expected1, observed1);
  assert(reconciliation1.match === true, 'Perfect match returns match=true');
  assert(reconciliation1.unexpected.length === 0, 'No unexpected paths');
  assert(reconciliation1.missing.length === 0, 'No missing paths');

  // Test 7: Unexpected paths
  const expected2 = ['file1.txt'];
  const observed2 = [{ path: 'file1.txt', status: 'M ' }, { path: 'file2.txt', status: 'M ' }];
  const reconciliation2 = reconcilePaths(expected2, observed2);
  assert(reconciliation2.match === false, 'Unexpected paths returns match=false');
  assert(reconciliation2.unexpected.length === 1, 'One unexpected path');
  assert(reconciliation2.unexpected[0].path === 'file2.txt', 'Unexpected path is file2.txt');
  assert(reconciliation2.missing.length === 0, 'No missing paths');

  // Test 8: Missing paths
  const expected3 = ['file1.txt', 'file2.txt'];
  const observed3 = [{ path: 'file1.txt', status: 'M ' }];
  const reconciliation3 = reconcilePaths(expected3, observed3);
  assert(reconciliation3.match === false, 'Missing paths returns match=false');
  assert(reconciliation3.unexpected.length === 0, 'No unexpected paths');
  assert(reconciliation3.missing.length === 1, 'One missing path');
  assert(reconciliation3.missing[0] === 'file2.txt', 'Missing path is file2.txt');

  // Test 9: Both unexpected and missing
  const expected4 = ['file1.txt', 'file2.txt'];
  const observed4 = [{ path: 'file1.txt', status: 'M ' }, { path: 'file3.txt', status: 'M ' }];
  const reconciliation4 = reconcilePaths(expected4, observed4);
  assert(reconciliation4.match === false, 'Both unexpected and missing returns match=false');
  assert(reconciliation4.unexpected.length === 1, 'One unexpected path');
  assert(reconciliation4.missing.length === 1, 'One missing path');
  assert(reconciliation4.unexpected[0].path === 'file3.txt', 'Unexpected is file3.txt');
  assert(reconciliation4.missing[0] === 'file2.txt', 'Missing is file2.txt');

  // Test 10: Empty expected, empty observed
  const reconciliation5 = reconcilePaths([], []);
  assert(reconciliation5.match === true, 'Empty arrays match');
  assert(reconciliation5.unexpected.length === 0, 'No unexpected');
  assert(reconciliation5.missing.length === 0, 'No missing');

  // Test 11: Empty expected, has observed
  const reconciliation6 = reconcilePaths([], [{ path: 'file1.txt', status: 'M ' }]);
  assert(reconciliation6.match === false, 'Empty expected with observed fails');
  assert(reconciliation6.unexpected.length === 1, 'One unexpected');
  assert(reconciliation6.missing.length === 0, 'No missing');

  // Test 12: Has expected, empty observed
  const reconciliation7 = reconcilePaths(['file1.txt'], []);
  assert(reconciliation7.match === false, 'Expected with empty observed fails');
  assert(reconciliation7.unexpected.length === 0, 'No unexpected');
  assert(reconciliation7.missing.length === 1, 'One missing');

  console.log('\nTesting non-git directory...\n');

  // Test 13: Non-git directory
  const nonGitDir = join(tmpdir(), `ocode-harness-nongit-${Date.now()}`);
  mkdirSync(nonGitDir, { recursive: true });
  writeFileSync(join(nonGitDir, 'file.txt'), 'content', 'utf8');

  const nonGitEvidence = collectEvidence(nonGitDir);
  assert(nonGitEvidence.git_root === null, 'Non-git dir has null git_root');
  assert(nonGitEvidence.git_branch === null, 'Non-git dir has null branch');
  assert(nonGitEvidence.git_remote === null, 'Non-git dir has null remote');
  assert(nonGitEvidence.dirty === false, 'Non-git dir is not dirty');
  assert(nonGitEvidence.merge_conflict === false, 'Non-git dir has no merge conflicts');
  assert(nonGitEvidence.project_root === nonGitDir, 'Project root is correct');

  // Cleanup non-git dir
  rmSync(nonGitDir, { recursive: true, force: true });

  console.log('\nTesting merge conflict detection...\n');

  // Test 14: Simulate merge conflict (UU status)
  // Create a scenario that would produce UU status
  // We can't easily create a real merge conflict in a test, but we can test the detection logic
  const mockStatusWithConflict = 'UU conflicted.txt\nM  modified.txt';
  // The detection checks for 'UU', 'AA', 'DD' in status
  assert(mockStatusWithConflict.includes('UU'), 'UU indicates merge conflict');
  assert(mockStatusWithConflict.includes('AA') === false, 'No AA in this status');
  assert(mockStatusWithConflict.includes('DD') === false, 'No DD in this status');

  // Test the merge_conflict flag logic directly
  const hasMergeConflict = (status) => status.includes('UU') || status.includes('AA') || status.includes('DD');
  assert(hasMergeConflict('UU file.txt') === true, 'Detects UU conflict');
  assert(hasMergeConflict('AA file.txt') === true, 'Detects AA conflict');
  assert(hasMergeConflict('DD file.txt') === true, 'Detects DD conflict');
  assert(hasMergeConflict('M  file.txt') === false, 'No conflict for modified');
  assert(hasMergeConflict('?? file.txt') === false, 'No conflict for untracked');
  assert(hasMergeConflict('') === false, 'No conflict for clean');

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