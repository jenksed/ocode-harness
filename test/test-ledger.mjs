#!/usr/bin/env node
/**
 * test-ledger.mjs
 * Test ledger runtime against isolated temp directory
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-ledger-test-${Date.now()}`);
const harnessRuntimeDir = join(__dirname, '..', 'packages', 'harness-runtime');

console.log('=== Test Ledger Runtime ===\n');
console.log(`Test directory: ${testDir}\n`);

// Create test directory
mkdirSync(testDir, { recursive: true });

// Import ledger module
const ledgerPath = join(harnessRuntimeDir, 'lib', 'ledger.mjs');

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
  // Import the ledger module
  const ledgerModule = await import(ledgerPath);
  const { createLedgerRecord, appendRecord, readRecords, getLatestRecord, getRecentRecords, LEDGER_SCHEMA_VERSION } = ledgerModule;

  console.log('Testing createLedgerRecord...\n');

  // Test 1: Create basic record
  const record1 = createLedgerRecord({
    task_id: '12345678-1234-4abc-8def-123456789abc',
    run_id: '87654321-4321-4cba-8def-ba9876543210',
    project_name: 'test-project',
    project_root: testDir,
    workflow: 'QUICK',
    status: 'COMPLETE',
  });
  assert(record1.schema_version === LEDGER_SCHEMA_VERSION, 'Schema version matches');
  assert(record1.task_id === '12345678-1234-4abc-8def-123456789abc', 'Task ID preserved');
  assert(record1.run_id === '87654321-4321-4cba-8def-ba9876543210', 'Run ID preserved');
  assert(record1.workflow === 'QUICK', 'Workflow preserved');
  assert(record1.status === 'COMPLETE', 'Status preserved');
  assert(record1.lifecycle_state === 'ACTIVE', 'Default lifecycle_state is ACTIVE');
  assert(Array.isArray(record1.agents_used), 'agents_used is array');
  assert(Array.isArray(record1.files_changed), 'files_changed is array');
  assert(typeof record1.closeout === 'object', 'closeout is object');
  assert(record1.closeout.attempted === false, 'closeout.attempted defaults to false');

  console.log('\nTesting appendRecord and readRecords...\n');

  const ledgerFile = join(testDir, 'run-ledger.jsonl');

  // Test 2: Append and read single record
  appendRecord(ledgerFile, record1);
  const records1 = readRecords(ledgerFile);
  assert(records1.length === 1, 'Single record read back');
  assert(records1[0].task_id === record1.task_id, 'Record content matches');

  // Test 3: Append multiple records
  const record2 = createLedgerRecord({
    task_id: '11111111-1111-4abc-8def-111111111111',
    run_id: '22222222-2222-4cba-8def-222222222222',
    project_name: 'test-project-2',
    workflow: 'STANDARD',
  });
  appendRecord(ledgerFile, record2);
  const records2 = readRecords(ledgerFile);
  assert(records2.length === 2, 'Two records read back');
  assert(records2[1].task_id === record2.task_id, 'Second record content matches');

  console.log('\nTesting getLatestRecord...\n');

  // Test 4: Get latest record
  const latest = getLatestRecord(ledgerFile);
  assert(latest !== null, 'Latest record exists');
  assert(latest.task_id === record2.task_id, 'Latest record is the most recent');

  console.log('\nTesting getRecentRecords...\n');

  // Test 5: Get recent records
  const recent = getRecentRecords(ledgerFile, 1);
  assert(recent.length === 1, 'Get recent with count=1');
  assert(recent[0].task_id === record2.task_id, 'Recent record is most recent');

  const recent2 = getRecentRecords(ledgerFile, 5);
  assert(recent2.length === 2, 'Get recent with count=5 returns all');

  console.log('\nTesting validation...\n');

  // Test 6: Validation rejects invalid schema version
  try {
    const invalidRecord = { ...record1, schema_version: 999 };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid schema version');
  } catch (err) {
    assert(err.message.includes('Schema version mismatch'), 'Rejects invalid schema version');
  }

  // Test 7: Validation rejects invalid task_id format
  try {
    const invalidRecord = { ...record1, task_id: 'invalid-uuid' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid task_id');
  } catch (err) {
    assert(err.message.includes('Invalid task_id format'), 'Rejects invalid task_id format');
  }

  // Test 8: Validation rejects invalid lifecycle_state
  try {
    const invalidRecord = { ...record1, lifecycle_state: 'INVALID' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid lifecycle_state');
  } catch (err) {
    assert(err.message.includes('Invalid lifecycle_state'), 'Rejects invalid lifecycle_state');
  }

  // Test 9: Validation rejects invalid workflow
  try {
    const invalidRecord = { ...record1, workflow: 'INVALID' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid workflow');
  } catch (err) {
    assert(err.message.includes('Invalid workflow'), 'Rejects invalid workflow');
  }

  // Test 10: Validation rejects invalid status
  try {
    const invalidRecord = { ...record1, status: 'INVALID' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid status');
  } catch (err) {
    assert(err.message.includes('Invalid status'), 'Rejects invalid status');
  }

  // Test 11: Validation rejects invalid reviewer_verdict
  try {
    const invalidRecord = { ...record1, reviewer_verdict: 'INVALID' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for invalid reviewer_verdict');
  } catch (err) {
    assert(err.message.includes('Invalid reviewer_verdict'), 'Rejects invalid reviewer_verdict');
  }

  // Test 12: Validation rejects negative repair_cycles
  try {
    const invalidRecord = { ...record1, repair_cycles: -1 };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for negative repair_cycles');
  } catch (err) {
    assert(err.message.includes('non-negative integer'), 'Rejects negative repair_cycles');
  }

  // Test 13: Validation rejects non-array fields
  try {
    const invalidRecord = { ...record1, agents_used: 'not-an-array' };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for non-array agents_used');
  } catch (err) {
    assert(err.message.includes('must be array'), 'Rejects non-array agents_used');
  }

  // Test 14: Read from non-existent file returns empty array
  const emptyRecords = readRecords(join(testDir, 'non-existent.jsonl'));
  assert(emptyRecords.length === 0, 'Non-existent file returns empty array');
  assert(getLatestRecord(join(testDir, 'non-existent.jsonl')) === null, 'Non-existent file returns null for latest');

  console.log('\nTesting closeout object validation...\n');

  // Test 15: closeout.attempted must be boolean
  try {
    const invalidRecord = { ...record1, closeout: { ...record1.closeout, attempted: 'not-boolean' } };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for non-boolean closeout.attempted');
  } catch (err) {
    assert(err.message.includes('closeout.attempted must be boolean'), 'Rejects non-boolean closeout.attempted');
  }

  // Test 16: closeout.committed must be boolean
  try {
    const invalidRecord = { ...record1, closeout: { ...record1.closeout, committed: 'not-boolean' } };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for non-boolean closeout.committed');
  } catch (err) {
    assert(err.message.includes('closeout.committed must be boolean'), 'Rejects non-boolean closeout.committed');
  }

  // Test 17: closeout.pushed must be boolean
  try {
    const invalidRecord = { ...record1, closeout: { ...record1.closeout, pushed: 'not-boolean' } };
    appendRecord(ledgerFile, invalidRecord);
    assert(false, 'Should have thrown for non-boolean closeout.pushed');
  } catch (err) {
    assert(err.message.includes('closeout.pushed must be boolean'), 'Rejects non-boolean closeout.pushed');
  }

  console.log('\nTesting auto-generation...\n');

  // Test 18: Auto-generate task_id and run_id if not provided
  const autoRecord = createLedgerRecord({ project_name: 'auto-test' });
  assert(autoRecord.task_id !== undefined && autoRecord.task_id !== '', 'Auto-generates task_id');
  assert(autoRecord.run_id !== undefined && autoRecord.run_id !== '', 'Auto-generates run_id');
  assert(autoRecord.timestamp !== undefined, 'Auto-generates timestamp');

  // Test 19: Auto-generate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(uuidRegex.test(autoRecord.task_id), 'Auto-generated task_id is valid UUID v4');
  assert(uuidRegex.test(autoRecord.run_id), 'Auto-generated run_id is valid UUID v4');

  // Test 20: ISO8601 timestamp format
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  assert(isoRegex.test(autoRecord.timestamp), 'Auto-generated timestamp is ISO8601');

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