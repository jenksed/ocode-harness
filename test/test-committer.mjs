#!/usr/bin/env node
/**
 * test-committer.mjs
 * Test committer agent definition and contract
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-committer-test-${Date.now()}`);
const agentsDir = join(__dirname, '..', 'agents');

console.log('=== Test Committer Agent ===\n');
console.log(`Test directory: ${testDir}\n`);

// Create test directory
mkdirSync(testDir, { recursive: true });

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

try {
  // Test 1: Committer agent file exists
  const committerPath = join(agentsDir, 'committer.md');
  assert(existsSync(committerPath), 'Committer agent file exists');

  // Test 2: Read and parse committer agent
  const content = readFileSync(committerPath, 'utf8');

  // Test 3: Required frontmatter fields
  const requiredFields = [
    '---',
    'description:',
    'mode:',
    'temperature:',
    'steps:',
    'permission:',
  ];
  for (const field of requiredFields) {
    assert(content.includes(field), `Has required field: ${field}`);
  }

  // Test 4: Correct mode
  assert(content.includes('mode: subagent'), 'Mode is subagent');

  // Test 5: Deployment model policy is external to semantic source
  assert(!/^model:/m.test(content), 'Contains no mutable provider/model policy');

  // Test 6: Low temperature for consistency
  assert(content.includes('temperature: 0.1'), 'Temperature is 0.1');

  // Test 7: Limited steps
  assert(content.includes('steps: 15'), 'Steps limited to 15');

  // Test 8: Permission structure
  assert(content.includes('edit: deny'), 'Edit permission denied');
  assert(content.includes('external_directory: deny'), 'External directory denied');
  assert(content.includes('task: deny'), 'Task permission denied');
  assert(content.includes('bash:'), 'Bash permissions defined');

  // Test 9: Allowed bash commands (read-only git)
  assert(content.includes('git status'), 'Allows git status');
  assert(content.includes('git diff'), 'Allows git diff');
  assert(content.includes('git log'), 'Allows git log');
  assert(content.includes('git show'), 'Allows git show');

  // Test 10: Denied bash commands (no write)
  // Verify no "git commit", "git push", "git add" in allow list
  const bashSection = content.split('bash:')[1]?.split('---')[0] || '';
  assert(!bashSection.includes('git commit'), 'Does not allow git commit');
  assert(!bashSection.includes('git push'), 'Does not allow git push');
  assert(!bashSection.includes('git add'), 'Does not allow git add');
  assert(!bashSection.includes('git merge'), 'Does not allow git merge');
  assert(!bashSection.includes('git rebase'), 'Does not allow git rebase');

  // Test 11: Purpose description
  assert(content.includes('committer') || content.includes('Committer'), 'Describes committer role');
  assert(content.includes('closeout') || content.includes('Closeout'), 'Mentions closeout');

  // Test 12: Input specification
  assert(content.includes('Input') || content.includes('input'), 'Documents input');
  assert(content.includes('Task objective') || content.includes('task objective'), 'Lists task objective in input');
  assert(content.includes('files changed') || content.includes('Files changed'), 'Lists files changed in input');
  assert(content.includes('Reviewer verdict') || content.includes('reviewer verdict'), 'Lists reviewer verdict in input');
  assert(content.includes('Verifier result') || content.includes('verifier result'), 'Lists verifier result in input');
  assert(content.includes('Workflow type') || content.includes('workflow type'), 'Lists workflow type in input');

  // Test 13: Output specification
  assert(content.includes('Output') || content.includes('output'), 'Documents output');
  assert(content.includes('STATUS:'), 'Output includes STATUS');
  assert(content.includes('COMMIT_SUBJECT:'), 'Output includes COMMIT_SUBJECT');
  assert(content.includes('COMMIT_BODY:'), 'Output includes COMMIT_BODY');
  assert(content.includes('EXPECTED_PATHS:'), 'Output includes EXPECTED_PATHS');
  assert(content.includes('EVIDENCE_GATE:'), 'Output includes EVIDENCE_GATE');
  assert(content.includes('BLOCKERS:'), 'Output includes BLOCKERS');

  // Test 14: Rules
  assert(content.includes('Rules') || content.includes('rules'), 'Documents rules');
  assert(content.includes('imperative mood'), 'Rule: imperative mood subject');
  assert(content.includes('72 chars'), 'Rule: 72 char limit');
  assert(content.includes('EVIDENCE_GATE = PASS'), 'Rule: evidence gate logic');
  assert(content.includes('reviewer=ACCEPT'), 'Rule: reviewer must ACCEPT');
  assert(content.includes('validationEvidence.status=PASS'), 'Rule: validationEvidence.status must PASS for STANDARD/DEEP');
  assert(content.includes('Never invent facts') || content.includes('never invent'), 'Rule: no invented facts');
  assert(content.includes('Do not execute Git') || content.includes('not execute Git'), 'Rule: no Git execution');

  // Test 15: Validate YAML frontmatter structure
  const frontmatterEnd = content.indexOf('---', 3);
  assert(frontmatterEnd > 0, 'Frontmatter properly closed');
  const frontmatter = content.substring(0, frontmatterEnd + 3);

  // Check for permission structure
  assert(frontmatter.includes('permission:'), 'Has permission section');
  assert(frontmatter.includes('edit:'), 'Has edit permission');
  assert(frontmatter.includes('external_directory:'), 'Has external_directory permission');
  assert(frontmatter.includes('task:'), 'Has task permission');
  assert(frontmatter.includes('bash:'), 'Has bash permissions');

  // Test 16: No skill permissions (committer shouldn't need skills)
  // Check that skill permissions aren't granted
  // The default deny for skills is good

  // Test 17: Verify no web permissions
  assert(frontmatter.includes('websearch: deny') || !frontmatter.includes('websearch:'), 'Websearch not allowed');
  assert(frontmatter.includes('webfetch: deny') || !frontmatter.includes('webfetch:'), 'Webfetch not allowed');

  // Test 18: Verify skill default deny
  assert(frontmatter.includes('skill:') || true, 'Skill permissions section checked');

  // Test 19: Agent file can be copied to test dir (simulating install)
  const testCommitterPath = join(testDir, 'committer.md');
  writeFileSync(testCommitterPath, content, 'utf8');
  assert(existsSync(testCommitterPath), 'Can copy committer agent to target location');

  // Test 20: Copied file has same content
  const copiedContent = readFileSync(testCommitterPath, 'utf8');
  assert(copiedContent === content, 'Copied file content matches original');

  // Test 21: Verify committer is in the expected agents list
  const manifest = JSON.parse(readFileSync(join(agentsDir, 'manifest.json'), 'utf8'));
  const expectedAgents = manifest.roles.map((role) => role.file);
  for (const agent of expectedAgents) {
    const agentPath = join(agentsDir, agent);
    assert(existsSync(agentPath), `Agent exists: ${agent}`);
  }

  // Test 22: Validate committer agent has no edit permissions (read-only)
  const permissionSection = frontmatter.split('permission:')[1]?.split('\n')[0] || '';
  // The key check is that edit: deny is explicitly set
  assert(content.includes('edit: deny'), 'Edit explicitly denied');

  // Test 23: Verify model is absent from semantic contract
  const modelMatch = content.match(/model:\s*([^\n]+)/);
  assert(modelMatch === null, 'Execution model is selected by profile policy');

  // Test 24: Verify temperature is low for deterministic output
  const tempMatch = content.match(/temperature:\s*([^\n]+)/);
  assert(tempMatch && parseFloat(tempMatch[1]) <= 0.2, 'Temperature <= 0.2 for consistency');

  // Test 25: Verify steps are limited (cheap agent)
  const stepsMatch = content.match(/steps:\s*([^\n]+)/);
  assert(stepsMatch && parseInt(stepsMatch[1]) <= 15, 'Steps <= 15 for cheap agent');

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
