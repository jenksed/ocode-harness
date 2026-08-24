#!/usr/bin/env node
/**
 * test-lifecycle.mjs
 * Test lifecycle runtime against isolated temp directory
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const harnessRuntimeDir = join(__dirname, '..', 'packages', 'harness-runtime');

console.log('=== Test Lifecycle Runtime ===\n');

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
  // Import the lifecycle module
  const lifecyclePath = join(harnessRuntimeDir, 'lib', 'lifecycle.mjs');
  const lifecycleModule = await import(lifecyclePath);
  const { LIFECYCLE_STATES, LEGAL_TRANSITIONS, isLegalTransition, transition } = lifecycleModule;

  let threw = false;
  let current = null;

  console.log('Testing LIFECYCLE_STATES...\n');

  // Test 1: All expected original states exist
  const expectedStates = ['ACTIVE', 'REVIEW_READY', 'REVIEW_ACCEPTED', 'CLOSEOUT_READY', 'COMMITTED', 'PUSHED', 'COMPLETE', 'BLOCKED', 'FAILED'];
  for (const state of expectedStates) {
    assert(LIFECYCLE_STATES.includes(state), `State ${state} exists`);
  }
  // Test 1b: New validation-driven workflow states exist
  const newStates = ['PLANNING_READY', 'PLANNED', 'PROVEN', 'DEFERRED'];
  for (const state of newStates) {
    assert(LIFECYCLE_STATES.includes(state), `State ${state} exists`);
  }
  assert(LIFECYCLE_STATES.length === 13, 'Exactly 13 lifecycle states (9 original + 4 validation-driven)');

  console.log('\nTesting LEGAL_TRANSITIONS...\n');

  // Test 2: ACTIVE transitions
  assert(LEGAL_TRANSITIONS.ACTIVE.includes('REVIEW_READY'), 'ACTIVE → REVIEW_READY allowed');
  assert(LEGAL_TRANSITIONS.ACTIVE.includes('BLOCKED'), 'ACTIVE → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.ACTIVE.includes('FAILED'), 'ACTIVE → FAILED allowed');
  assert(!LEGAL_TRANSITIONS.ACTIVE.includes('COMMITTED'), 'ACTIVE → COMMITTED not allowed');
  assert(!LEGAL_TRANSITIONS.ACTIVE.includes('COMPLETE'), 'ACTIVE → COMPLETE not allowed');

  // Test 3: REVIEW_READY transitions
  assert(LEGAL_TRANSITIONS.REVIEW_READY.includes('REVIEW_ACCEPTED'), 'REVIEW_READY → REVIEW_ACCEPTED allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_READY.includes('BLOCKED'), 'REVIEW_READY → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_READY.includes('FAILED'), 'REVIEW_READY → FAILED allowed');
  assert(!LEGAL_TRANSITIONS.REVIEW_READY.includes('CLOSEOUT_READY'), 'REVIEW_READY → CLOSEOUT_READY not allowed');

  // Test 4: REVIEW_ACCEPTED transitions
  assert(LEGAL_TRANSITIONS.REVIEW_ACCEPTED.includes('CLOSEOUT_READY'), 'REVIEW_ACCEPTED → CLOSEOUT_READY allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_ACCEPTED.includes('BLOCKED'), 'REVIEW_ACCEPTED → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_ACCEPTED.includes('FAILED'), 'REVIEW_ACCEPTED → FAILED allowed');

  // Test 5: CLOSEOUT_READY transitions
  assert(LEGAL_TRANSITIONS.CLOSEOUT_READY.includes('COMMITTED'), 'CLOSEOUT_READY → COMMITTED allowed');
  assert(LEGAL_TRANSITIONS.CLOSEOUT_READY.includes('BLOCKED'), 'CLOSEOUT_READY → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.CLOSEOUT_READY.includes('FAILED'), 'CLOSEOUT_READY → FAILED allowed');

  // Test 6: COMMITTED transitions
  assert(LEGAL_TRANSITIONS.COMMITTED.includes('PUSHED'), 'COMMITTED → PUSHED allowed');
  assert(LEGAL_TRANSITIONS.COMMITTED.includes('BLOCKED'), 'COMMITTED → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.COMMITTED.includes('FAILED'), 'COMMITTED → FAILED allowed');

  // Test 7: PUSHED transitions
  assert(LEGAL_TRANSITIONS.PUSHED.includes('COMPLETE'), 'PUSHED → COMPLETE allowed');
  assert(LEGAL_TRANSITIONS.PUSHED.includes('BLOCKED'), 'PUSHED → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.PUSHED.includes('FAILED'), 'PUSHED → FAILED allowed');

  // Test 8: Terminal states
  assert(LEGAL_TRANSITIONS.COMPLETE.length === 0, 'COMPLETE has no outgoing transitions');
  assert(LEGAL_TRANSITIONS.BLOCKED.includes('ACTIVE'), 'BLOCKED → ACTIVE allowed (recovery)');
  assert(LEGAL_TRANSITIONS.FAILED.includes('ACTIVE'), 'FAILED → ACTIVE allowed (recovery)');

  console.log('\nTesting new validation-driven workflow states...\n');

  // Test 8b: PLANNING_READY transitions
  assert(LEGAL_TRANSITIONS.PLANNING_READY.includes('PLANNED'), 'PLANNING_READY → PLANNED allowed');
  assert(LEGAL_TRANSITIONS.PLANNING_READY.includes('ACTIVE'), 'PLANNING_READY → ACTIVE allowed');
  assert(LEGAL_TRANSITIONS.PLANNING_READY.includes('BLOCKED'), 'PLANNING_READY → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.PLANNING_READY.includes('FAILED'), 'PLANNING_READY → FAILED allowed');
  assert(LEGAL_TRANSITIONS.PLANNING_READY.includes('DEFERRED'), 'PLANNING_READY → DEFERRED allowed');
  assert(!LEGAL_TRANSITIONS.PLANNING_READY.includes('REVIEW_READY'), 'PLANNING_READY → REVIEW_READY not allowed');

  // Test 8c: PLANNED transitions
  assert(LEGAL_TRANSITIONS.PLANNED.includes('ACTIVE'), 'PLANNED → ACTIVE allowed');
  assert(LEGAL_TRANSITIONS.PLANNED.includes('BLOCKED'), 'PLANNED → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.PLANNED.includes('FAILED'), 'PLANNED → FAILED allowed');
  assert(LEGAL_TRANSITIONS.PLANNED.includes('DEFERRED'), 'PLANNED → DEFERRED allowed');
  assert(!LEGAL_TRANSITIONS.PLANNED.includes('REVIEW_READY'), 'PLANNED → REVIEW_READY not allowed');
  assert(!LEGAL_TRANSITIONS.PLANNED.includes('CLOSEOUT_READY'), 'PLANNED → CLOSEOUT_READY not allowed');

  // Test 8d: PROVEN transitions
  assert(LEGAL_TRANSITIONS.PROVEN.includes('CLOSEOUT_READY'), 'PROVEN → CLOSEOUT_READY allowed');
  assert(LEGAL_TRANSITIONS.PROVEN.includes('BLOCKED'), 'PROVEN → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.PROVEN.includes('FAILED'), 'PROVEN → FAILED allowed');
  assert(LEGAL_TRANSITIONS.PROVEN.includes('DEFERRED'), 'PROVEN → DEFERRED allowed');
  assert(!LEGAL_TRANSITIONS.PROVEN.includes('ACTIVE'), 'PROVEN → ACTIVE not allowed');

  // Test 8e: DEFERRED transitions
  assert(LEGAL_TRANSITIONS.DEFERRED.includes('PLANNING_READY'), 'DEFERRED → PLANNING_READY allowed');
  assert(LEGAL_TRANSITIONS.DEFERRED.includes('ACTIVE'), 'DEFERRED → ACTIVE allowed');
  assert(LEGAL_TRANSITIONS.DEFERRED.includes('BLOCKED'), 'DEFERRED → BLOCKED allowed');
  assert(LEGAL_TRANSITIONS.DEFERRED.includes('FAILED'), 'DEFERRED → FAILED allowed');
  assert(!LEGAL_TRANSITIONS.DEFERRED.includes('COMPLETE'), 'DEFERRED → COMPLETE not allowed');

  // Test 8f: Original states can transition to DEFERRED
  assert(LEGAL_TRANSITIONS.ACTIVE.includes('DEFERRED'), 'ACTIVE → DEFERRED allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_READY.includes('DEFERRED'), 'REVIEW_READY → DEFERRED allowed');
  assert(LEGAL_TRANSITIONS.REVIEW_ACCEPTED.includes('DEFERRED'), 'REVIEW_ACCEPTED → DEFERRED allowed');
  assert(LEGAL_TRANSITIONS.CLOSEOUT_READY.includes('DEFERRED'), 'CLOSEOUT_READY → DEFERRED allowed');
  assert(LEGAL_TRANSITIONS.COMMITTED.includes('DEFERRED'), 'COMMITTED → DEFERRED allowed');
  assert(LEGAL_TRANSITIONS.PUSHED.includes('DEFERRED'), 'PUSHED → DEFERRED allowed');

  console.log('\nTesting isLegalTransition for new states...\n');

  // Test 10b: Valid new transitions return true
  assert(isLegalTransition('ACTIVE', 'PLANNING_READY') === true, 'ACTIVE → PLANNING_READY is legal');
  assert(isLegalTransition('PLANNING_READY', 'PLANNED') === true, 'PLANNING_READY → PLANNED is legal');
  assert(isLegalTransition('PLANNED', 'ACTIVE') === true, 'PLANNED → ACTIVE is legal');
  assert(isLegalTransition('ACTIVE', 'PROVEN') === false, 'ACTIVE → PROVEN is illegal (not direct)');
  assert(isLegalTransition('PROVEN', 'CLOSEOUT_READY') === true, 'PROVEN → CLOSEOUT_READY is legal');
  assert(isLegalTransition('ACTIVE', 'DEFERRED') === true, 'ACTIVE → DEFERRED is legal');
  assert(isLegalTransition('DEFERRED', 'PLANNING_READY') === true, 'DEFERRED → PLANNING_READY is legal');
  assert(isLegalTransition('DEFERRED', 'ACTIVE') === true, 'DEFERRED → ACTIVE is legal');
  assert(isLegalTransition('REVIEW_READY', 'DEFERRED') === true, 'REVIEW_READY → DEFERRED is legal');
  assert(isLegalTransition('PLANNING_READY', 'DEFERRED') === true, 'PLANNING_READY → DEFERRED is legal');

  // Test 10c: Invalid new transitions return false
  assert(isLegalTransition('PLANNING_READY', 'REVIEW_READY') === false, 'PLANNING_READY → REVIEW_READY is illegal');
  assert(isLegalTransition('PLANNED', 'CLOSEOUT_READY') === false, 'PLANNED → CLOSEOUT_READY is illegal');
  assert(isLegalTransition('PROVEN', 'ACTIVE') === false, 'PROVEN → ACTIVE is illegal');
  assert(isLegalTransition('DEFERRED', 'COMPLETE') === false, 'DEFERRED → COMPLETE is illegal');

  // Test 10d: Self-transitions for new states are illegal
  assert(isLegalTransition('PLANNING_READY', 'PLANNING_READY') === false, 'PLANNING_READY → PLANNING_READY is illegal');
  assert(isLegalTransition('PLANNED', 'PLANNED') === false, 'PLANNED → PLANNED is illegal');
  assert(isLegalTransition('PROVEN', 'PROVEN') === false, 'PROVEN → PROVEN is illegal');
  assert(isLegalTransition('DEFERRED', 'DEFERRED') === false, 'DEFERRED → DEFERRED is illegal');

  console.log('\nTesting transition function for new states...\n');

  // Test 13b: Valid new transitions return next state
  assert(transition('ACTIVE', 'PLANNING_READY') === 'PLANNING_READY', 'transition returns new state');
  assert(transition('PLANNING_READY', 'PLANNED') === 'PLANNED', 'transition returns planned state');
  assert(transition('DEFERRED', 'ACTIVE') === 'ACTIVE', 'transition returns recovered state from deferred');

  // Test 13c: Invalid new transitions throw
  threw = false;
  try {
    transition('PLANNING_READY', 'REVIEW_READY');
  } catch (err) {
    threw = true;
    assert(err.message.includes('Illegal transition'), 'Throws on illegal new transition');
  }
  assert(threw, 'Throws on illegal new transition');

  console.log('\nTesting full validation-driven workflow path...\n');

  // Test 16b: Full validation-driven workflow path
  const validationPath = ['ACTIVE', 'PLANNING_READY', 'PLANNED', 'ACTIVE', 'REVIEW_READY', 'REVIEW_ACCEPTED', 'PROVEN', 'CLOSEOUT_READY', 'COMMITTED', 'PUSHED', 'COMPLETE'];
  current = validationPath[0];
  for (let i = 1; i < validationPath.length; i++) {
    const next = validationPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'COMPLETE', 'Full validation-driven path reaches COMPLETE');

  // Test 16c: Deferred and recovery path
  const deferredPath = ['ACTIVE', 'DEFERRED', 'PLANNING_READY', 'PLANNED', 'ACTIVE'];
  current = deferredPath[0];
  for (let i = 1; i < deferredPath.length; i++) {
    const next = deferredPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'ACTIVE', 'Deferred recovery path works');

  // Test 16d: Deferred from review path
  const deferredReviewPath = ['ACTIVE', 'REVIEW_READY', 'DEFERRED', 'ACTIVE', 'REVIEW_READY'];
  current = deferredReviewPath[0];
  for (let i = 1; i < deferredReviewPath.length; i++) {
    const next = deferredReviewPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'REVIEW_READY', 'Deferred from review path works');

  console.log('\nTesting isLegalTransition...\n');

  // Test 9: Valid transitions return true
  assert(isLegalTransition('ACTIVE', 'REVIEW_READY') === true, 'ACTIVE → REVIEW_READY is legal');
  assert(isLegalTransition('REVIEW_READY', 'REVIEW_ACCEPTED') === true, 'REVIEW_READY → REVIEW_ACCEPTED is legal');
  assert(isLegalTransition('REVIEW_ACCEPTED', 'CLOSEOUT_READY') === true, 'REVIEW_ACCEPTED → CLOSEOUT_READY is legal');
  assert(isLegalTransition('CLOSEOUT_READY', 'COMMITTED') === true, 'CLOSEOUT_READY → COMMITTED is legal');
  assert(isLegalTransition('COMMITTED', 'PUSHED') === true, 'COMMITTED → PUSHED is legal');
  assert(isLegalTransition('PUSHED', 'COMPLETE') === true, 'PUSHED → COMPLETE is legal');
  assert(isLegalTransition('BLOCKED', 'ACTIVE') === true, 'BLOCKED → ACTIVE is legal');
  assert(isLegalTransition('FAILED', 'ACTIVE') === true, 'FAILED → ACTIVE is legal');

  // Test 10: Invalid transitions return false
  assert(isLegalTransition('ACTIVE', 'COMMITTED') === false, 'ACTIVE → COMMITTED is illegal');
  assert(isLegalTransition('REVIEW_READY', 'CLOSEOUT_READY') === false, 'REVIEW_READY → CLOSEOUT_READY is illegal');
  assert(isLegalTransition('COMPLETE', 'ACTIVE') === false, 'COMPLETE → ACTIVE is illegal');
  assert(isLegalTransition('PUSHED', 'REVIEW_READY') === false, 'PUSHED → REVIEW_READY is illegal');

  // Test 11: Self-transitions are illegal (not in transitions)
  assert(isLegalTransition('ACTIVE', 'ACTIVE') === false, 'ACTIVE → ACTIVE is illegal');
  assert(isLegalTransition('COMPLETE', 'COMPLETE') === false, 'COMPLETE → COMPLETE is illegal');

  console.log('\nTesting transition function...\n');

  // Test 12: Valid transition returns next state
  assert(transition('ACTIVE', 'REVIEW_READY') === 'REVIEW_READY', 'transition returns next state');
  assert(transition('BLOCKED', 'ACTIVE') === 'ACTIVE', 'transition returns recovered state');

  // Test 13: Invalid transition throws
  threw = false;
  try {
    transition('ACTIVE', 'COMMITTED');
  } catch (err) {
    threw = true;
    assert(err.message.includes('Illegal transition'), 'Throws on illegal transition');
    assert(err.message.includes('ACTIVE → COMMITTED'), 'Error message includes states');
  }
  assert(threw, 'Throws on illegal transition');

  // Test 14: Unknown current state throws
  threw = false;
  try {
    transition('UNKNOWN', 'ACTIVE');
  } catch (err) {
    threw = true;
    assert(err.message.includes('Unknown state'), 'Throws on unknown current state');
  }
  assert(threw, 'Throws on unknown current state');

  // Test 15: Unknown next state throws
  threw = false;
  try {
    transition('ACTIVE', 'UNKNOWN');
  } catch (err) {
    threw = true;
    assert(err.message.includes('Unknown state'), 'Throws on unknown next state');
  }
  assert(threw, 'Throws on unknown next state');

  console.log('\nTesting full workflow path...\n');

  // Test 16: Full QUICK workflow path
  const quickPath = ['ACTIVE', 'REVIEW_READY', 'REVIEW_ACCEPTED', 'CLOSEOUT_READY', 'COMMITTED', 'PUSHED', 'COMPLETE'];
  current = quickPath[0];
  for (let i = 1; i < quickPath.length; i++) {
    const next = quickPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'COMPLETE', 'Full QUICK path reaches COMPLETE');

  // Test 17: Full STANDARD/DEEP workflow path (same states, different agents)
  const standardPath = ['ACTIVE', 'REVIEW_READY', 'REVIEW_ACCEPTED', 'CLOSEOUT_READY', 'COMMITTED', 'PUSHED', 'COMPLETE'];
  current = standardPath[0];
  for (let i = 1; i < standardPath.length; i++) {
    const next = standardPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'COMPLETE', 'Full STANDARD path reaches COMPLETE');

  // Test 18: Blocked recovery path
  const blockedPath = ['ACTIVE', 'BLOCKED', 'ACTIVE', 'REVIEW_READY'];
  current = blockedPath[0];
  for (let i = 1; i < blockedPath.length; i++) {
    const next = blockedPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'REVIEW_READY', 'Blocked recovery path works');

  // Test 19: Failed recovery path
  const failedPath = ['ACTIVE', 'FAILED', 'ACTIVE', 'REVIEW_READY'];
  current = failedPath[0];
  for (let i = 1; i < failedPath.length; i++) {
    const next = failedPath[i];
    assert(isLegalTransition(current, next) === true, `${current} → ${next} is legal`);
    current = transition(current, next);
  }
  assert(current === 'REVIEW_READY', 'Failed recovery path works');

} catch (error) {
  console.error('\n✗ Test execution failed:', error.message);
  console.error(error.stack);
  failed++;
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