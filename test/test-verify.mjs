#!/usr/bin/env node
/**
 * test-verify.mjs
 * Test verify runtime against isolated temp directory
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-verify-test-${Date.now()}`);
const harnessRuntimeDir = join(__dirname, '..', 'packages', 'harness-runtime');

console.log('=== Test Verify Runtime ===\n');
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
    console.error(`    Stack:`, new Error().stack.split('\n').slice(1, 4).join('\n    '));
    failed++;
  }
}

try {
  // Import the verify module
  const verifyPath = join(harnessRuntimeDir, 'lib', 'verify.mjs');
  const verifyModule = await import(verifyPath);
  const { runVerification, VALIDATION_CATEGORIES, MAX_OUTPUT_BYTES } = verifyModule;
  const activityModule = await import(join(harnessRuntimeDir, 'lib', 'activity.mjs'));

  console.log('Testing constants...\n');

  // Test 1: Constants
  assert(Array.isArray(VALIDATION_CATEGORIES), 'VALIDATION_CATEGORIES is array');
  assert(VALIDATION_CATEGORIES.length === 5, '5 validation categories');
  assert(VALIDATION_CATEGORIES.includes('test'), 'Includes test');
  assert(VALIDATION_CATEGORIES.includes('build'), 'Includes build');
  assert(VALIDATION_CATEGORIES.includes('lint'), 'Includes lint');
  assert(VALIDATION_CATEGORIES.includes('typecheck'), 'Includes typecheck');
  assert(VALIDATION_CATEGORIES.includes('verify'), 'Includes verify');
  assert(MAX_OUTPUT_BYTES === 10240, 'MAX_OUTPUT_BYTES is 10KB');

  console.log('\nTesting runVerification with explicit commands (no orientation)...\n');

  // Test 2: Run verification with explicit passing command
  const passResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['echo "test passed"'],
      build: ['echo "build passed"']
    }
  });
  assert(passResult.status === 'PASS', 'Explicit passing commands return PASS');
  assert(passResult.summary.total === 2, 'Two commands executed');
  assert(passResult.summary.passed === 2, 'Both commands passed');
  assert(passResult.summary.failed === 0, 'No failures');
  assert(passResult.summary.infrastructure_failures === 0, 'No infrastructure failures');
  assert(passResult.commands.length === 2, 'Two command results');
  assert(passResult.commands[0].command === 'echo "test passed"', 'First command recorded');
  assert(passResult.commands[0].category === 'test', 'First command category is test');
  assert(passResult.commands[0].result === 'PASS', 'First command result is PASS');
  assert(passResult.commands[0].exit_code === 0, 'First command exit code is 0');
  assert(typeof passResult.commands[0].duration_ms === 'number', 'Duration recorded');
  assert(passResult.commands[0].duration_ms >= 0, 'Duration non-negative');
  const verificationActivity = activityModule.queryActivity(activityModule.activityStorePath(testDir));
  assert(verificationActivity.events.some((event) => event.event_type === 'VERIFICATION_STARTED'), 'Runtime verification start event recorded');
  assert(verificationActivity.events.some((event) => event.event_type === 'VERIFICATION_COMPLETED'), 'Runtime verification completion event recorded');
  assert(verificationActivity.verification.status === 'COMPLETED', 'Verification activity is distinguishable from agent prose');

  console.log('\nTesting runVerification with explicit failing command...\n');

  // Test 3: Run verification with explicit failing command
  const failResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['exit 1'],
      lint: ['echo "lint passed"']
    }
  });
  assert(failResult.status === 'FAIL', 'Failing command returns FAIL status');
  assert(failResult.summary.total === 2, 'Two commands executed');
  assert(failResult.summary.passed === 1, 'One command passed');
  assert(failResult.summary.failed === 1, 'One command failed');
  assert(failResult.commands[0].result === 'FAIL', 'First command result is FAIL');
  assert(failResult.commands[0].exit_code === 1, 'First command exit code is 1');
  assert(failResult.commands[1].result === 'PASS', 'Second command result is PASS');

  console.log('\nTesting runVerification with timeout (infrastructure failure)...\n');

  // Test 4: Run verification with timeout command (sleep longer than timeout)
  // Use a very short timeout to test infrastructure failure
  const timeoutResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['sleep 2']
    },
    timeout: 100 // 100ms timeout
  });
  assert(timeoutResult.status === 'INFRASTRUCTURE_FAILURE', 'Timeout returns INFRASTRUCTURE_FAILURE');
  assert(timeoutResult.summary.infrastructure_failures === 1, 'One infrastructure failure');
  assert(timeoutResult.commands[0].result === 'INFRASTRUCTURE_FAILURE', 'Command result is INFRASTRUCTURE_FAILURE');
  assert(timeoutResult.commands[0].infrastructure_error === 'TIMEOUT', 'Infrastructure error is TIMEOUT');
  assert(timeoutResult.commands[0].exit_code === null, 'Exit code is null for timeout');

  console.log('\nTesting runVerification with orientation.json...\n');

  // Test 5: Create orientation.json and test with it
  const opencodeDir = join(testDir, '.opencode');
  mkdirSync(opencodeDir, { recursive: true });
  
  const orientation = {
    schema_version: 1,
    project: { name: 'test', root: testDir },
    commands: {
      test: ['echo "orientation test"'],
      build: ['echo "orientation build"'],
      lint: [],
      typecheck: [],
      verify: []
    }
  };
  writeFileSync(join(opencodeDir, 'orientation.json'), JSON.stringify(orientation, null, 2), 'utf8');

  const orientResult = runVerification({
    projectRoot: testDir
  });
  assert(orientResult.status === 'PASS', 'Orientation commands return PASS');
  assert(orientResult.summary.total === 2, 'Two commands from orientation executed');
  assert(orientResult.orientation_path === join(opencodeDir, 'orientation.json'), 'Orientation path recorded');

  console.log('\nTesting explicit commands override orientation...\n');

  // Test 6: Explicit commands override orientation
  const overrideResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['echo "override test"'],
      verify: ['echo "override verify"']
    }
  });
  assert(overrideResult.status === 'PASS', 'Override commands return PASS');
  // Explicit overrides replace categories; orientation commands for non-overridden categories are preserved
  assert(overrideResult.summary.total === 3, 'Three commands executed (test override, orientation build, verify override)');
  assert(overrideResult.commands[0].command === 'echo "override test"', 'Override test command used');
  assert(overrideResult.commands[2].command === 'echo "override verify"', 'Override verify command used');

  console.log('\nTesting output bounding...\n');

  // Test 7: Output bounding for large output
  const largeOutputResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['bash -c "printf \\"%.0sX\\" {1..15000}\"']
    }
  });
  assert(largeOutputResult.status === 'PASS', 'Large output command passes');
  const output = largeOutputResult.commands[0].output;
  assert(output.includes('[output truncated]'), 'Large output is truncated');
  assert(Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT_BYTES + 100, 'Output is bounded (approximately)');

  console.log('\nTesting failing test extraction...\n');

  // Test 8: Failing test identifier extraction
  const testFailOutput = `PASS test_one
FAIL test_two
● Test Three
  Expected: 1
  Received: 2
  4) Test Four
--- FAIL: TestFive (0.00s)
FAILED test_module.py::TestSix`;

  // We can't easily test extractFailingTests directly since it's not exported,
  // but we can test through runVerification with a command that produces such output
  const testFailResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['bash -c "printf \\\"PASS test_one\\nFAIL test_two\\n● Test Three\\n  Expected: 1\\n  Received: 2\\n  4) Test Four\\n--- FAIL: TestFive (0.00s)\\nFAILED test_module.py::TestSix\\n\\"; exit 1"']
    }
  });
  assert(testFailResult.status === 'FAIL', 'Test failure detected');
  const failingTests = testFailResult.commands[0].failing_tests;
  assert(Array.isArray(failingTests), 'failing_tests is array');
  assert(failingTests.length > 0, 'Some failing tests extracted');

  console.log('\nTesting command parsing...\n');

  // Test 9: Command with quotes
  const quotedResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['echo "hello world"']
    }
  });
  assert(quotedResult.status === 'PASS', 'Quoted command passes');
  assert(quotedResult.commands[0].output.includes('hello world'), 'Quoted argument preserved');

  console.log('\nTesting error when no commands available...\n');

  // Test 10: Error when no commands available (clean dir, no orientation, no explicit)
  const emptyDir = join(tmpdir(), `ocode-harness-empty-${Date.now()}`);
  mkdirSync(emptyDir, { recursive: true });
  
  let threw = false;
  try {
    runVerification({ projectRoot: emptyDir });
  } catch (err) {
    threw = true;
    assert(err.message.includes('No validation commands available'), 'Throws when no commands available');
  }
  assert(threw, 'Throws when no commands available');
  rmSync(emptyDir, { recursive: true, force: true });

  console.log('\nTesting command structure...\n');

  // Test 11: Verify all command result fields present
  const structureResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['echo "structure test"']
    }
  });
  const cmd = structureResult.commands[0];
  assert(typeof cmd.command === 'string', 'command is string');
  assert(typeof cmd.category === 'string', 'category is string');
  assert(['PASS', 'FAIL', 'INFRASTRUCTURE_FAILURE'].includes(cmd.result), 'result is valid enum');
  assert(typeof cmd.exit_code === 'number' || cmd.exit_code === null, 'exit_code is number or null');
  assert(typeof cmd.output === 'string', 'output is string');
  assert(typeof cmd.duration_ms === 'number', 'duration_ms is number');
  assert(Array.isArray(cmd.failing_tests), 'failing_tests is array');
  assert(cmd.duration_ms >= 0, 'duration_ms non-negative');

  console.log('\nTesting overall result structure...\n');

  // Test 12: Verify overall result structure
  assert(typeof passResult.status === 'string', 'status is string');
  assert(['PASS', 'FAIL', 'INFRASTRUCTURE_FAILURE'].includes(passResult.status), 'status is valid enum');
  assert(Array.isArray(passResult.commands), 'commands is array');
  assert(typeof passResult.summary === 'object', 'summary is object');
  assert(typeof passResult.summary.total === 'number', 'summary.total is number');
  assert(typeof passResult.summary.passed === 'number', 'summary.passed is number');
  assert(typeof passResult.summary.failed === 'number', 'summary.failed is number');
  assert(typeof passResult.summary.infrastructure_failures === 'number', 'summary.infrastructure_failures is number');
  assert(typeof passResult.project_root === 'string', 'project_root is string');
  assert(typeof passResult.timestamp === 'string', 'timestamp is string');
  assert(passResult.timestamp.includes('T'), 'timestamp is ISO8601');

  console.log('\nTesting mixed pass/fail/infrastructure...\n');

  // Test 13: Mixed results
  const mixedResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['echo "pass"'],
      build: ['exit 1'],
      lint: ['sleep 2'] // Will timeout with short timeout
    },
    timeout: 50
  });
  assert(mixedResult.summary.total === 3, 'Three commands total');
  assert(mixedResult.summary.passed === 1, 'One passed');
  assert(mixedResult.summary.failed === 1, 'One failed');
  assert(mixedResult.summary.infrastructure_failures === 1, 'One infrastructure failure');
  // Overall status should be FAIL (not INFRASTRUCTURE_FAILURE) because there's a real failure
  assert(mixedResult.status === 'FAIL', 'Overall status is FAIL when both fail and infra failure');

  // Test 14: Only infrastructure failure
  const onlyInfraResult = runVerification({
    projectRoot: testDir,
    explicitCommands: {
      test: ['sleep 2']
    },
    timeout: 50
  });
  assert(onlyInfraResult.status === 'INFRASTRUCTURE_FAILURE', 'Only infra failure -> INFRASTRUCTURE_FAILURE status');

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
