/**
 * @file L0 Lane contract tests.
 *
 * Covers the required cases A–S from the L0 product definition plus
 * deterministic fingerprint and graph-independence checks.
 *
 * Test framework: Node.js built-in `assert`.
 */

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeLib = resolve(here, '..', 'packages', 'harness-runtime', 'lib');

const { createLanePlan, computeFingerprint, CHECKPOINT_CLASSES } = await import(`${runtimeLib}/lanes/plan.mjs`);
const {
  EXACT_COMMIT, LANE_CHECKPOINT, BASE_TYPES,
  CHECKPOINT_CLASS,
  assertLaneId, assertSHA256, assertWorkspaceSlug,
  normalizedLaneId, normalizedWorkspaceSlug,
  checkoutReference,
} = await import(`${runtimeLib}/lanes/identity.mjs`);
const {
  validateDirectedGraph,
} = await import(`${runtimeLib}/lanes/graph.mjs`);
const {
  validateLanePlan,
  computeLanePlanFingerprint,
  validateCheckpointReference,
} = await import(`${runtimeLib}/lanes/contract.mjs`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 40-char lowercase hex Git commit SHAs.
const VALID_SHA = 'a1b2c3d4e5f6789012345678901234567890abcd';
const ALT_SHA   = 'f1e2d3c4b5a6978012345678901234567890feda';
const THIRD_SHA = '0123456789abcdef0123456789abcdef01234567';
const INVALID_SHA = 'not-a-sha';
const BAD_SHA_LEN = 'a1b2c3d4';

// 64-char SHA-256 for task/lane fingerprints.
const TASK_FINGERPRINT = 'a'.repeat(64);

const VALID_LANE_ID = 'lane-1';
const ALT_LANE_ID   = 'lane-2';

function laneDef(id, sha, slug) {
  return {
    lane_id: id,
    name: id,
    description: `lane ${id}`,
    base: { type: EXACT_COMMIT, ref: sha },
    state: 'PENDING',
    workspace: { slug, description: '' },
    mutation_claims: [],
  };
}

/** Build a valid minimal single-lane plan. */
function minimalPlan() {
  return {
    schema_version: 1,
    plan_id: 'lp-minimal',
    lanes: {
      [VALID_LANE_ID]: laneDef(VALID_LANE_ID, VALID_SHA, 'ws-minimal'),
    },
  };
}

/** Build a valid multi-lane plan with a dependency edge. */
function multiLanePlan() {
  return {
    schema_version: 1,
    plan_id: 'lp-multi',
    lanes: {
      [VALID_LANE_ID]: {
        ...laneDef(VALID_LANE_ID, VALID_SHA, 'ws-a'),
        mutation_claims: [{ paths: 'src/a.mjs', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false }],
      },
      [ALT_LANE_ID]: {
        ...laneDef(ALT_LANE_ID, ALT_SHA, 'ws-b'),
        base: { type: LANE_CHECKPOINT, ref: 'cp-base', laneId: VALID_LANE_ID },
        integration_intent: { integration_target: { type: EXACT_COMMIT, ref: ALT_SHA } },
      },
    },
    dependency_graph: [{ from: VALID_LANE_ID, to: ALT_LANE_ID }],
  };
}

// ---------------------------------------------------------------------------
// A. Valid minimal LanePlan
// ---------------------------------------------------------------------------

function testValidMinimalPlan() {
  const { plan, fingerprint } = createLanePlan(minimalPlan());
  assert.ok(plan, 'plan should be returned');
  assert.match(fingerprint.plan_fingerprint, /^[0-9a-f]{64}$/);
  assert.strictEqual(plan.schema_version, 1);
  assert.strictEqual(plan.plan_id, 'lp-minimal');
  assert.ok(plan.lanes[VALID_LANE_ID]);
  assert.strictEqual(plan.lanes[VALID_LANE_ID].base.type, EXACT_COMMIT);
  assert.strictEqual(plan.lanes[VALID_LANE_ID].base.ref, VALID_SHA);
  assert.deepStrictEqual(plan.dependency_graph, []);
  assert.deepStrictEqual(plan.integration_graph, []);
}

// ---------------------------------------------------------------------------
// B. Valid multi-lane LanePlan
// ---------------------------------------------------------------------------

function testValidMultiLanePlan() {
  const { plan, fingerprint } = createLanePlan(multiLanePlan());
  assert.strictEqual(Object.keys(plan.lanes).length, 2);
  assert.strictEqual(plan.lanes[ALT_LANE_ID].base.type, LANE_CHECKPOINT);
  assert.strictEqual(plan.lanes[ALT_LANE_ID].base.ref, 'cp-base');
  assert.strictEqual(plan.lanes[ALT_LANE_ID].base.laneId, VALID_LANE_ID);
  assert.deepStrictEqual(plan.dependency_graph, [{ from: 'lane-1', to: 'lane-2' }]);
  assert.match(fingerprint.plan_fingerprint, /^[0-9a-f]{64}$/);
}

// ---------------------------------------------------------------------------
// C. Deterministic fingerprint
// ---------------------------------------------------------------------------

function testDeterministicFingerprint() {
  const p1 = minimalPlan();
  const p2 = JSON.parse(JSON.stringify(p1));
  const fp1 = createLanePlan(p1).fingerprint.plan_fingerprint;
  const fp2 = createLanePlan(p2).fingerprint.plan_fingerprint;
  assert.strictEqual(fp1, fp2, 'semantically identical plans must produce identical fingerprints');

  // key insertion-order independence
  const reorderedLanes = {
    schema_version: 1,
    plan_id: 'lp-minimal',
    lanes: { 'lane-1': minimalPlan().lanes['lane-1'] },
  };
  const fp3 = createLanePlan(reorderedLanes).fingerprint.plan_fingerprint;
  assert.strictEqual(fp1, fp3, 'key insertion order must not affect fingerprint');

  // edge order independence in dependency_graph (3-node graph)
  const three = {
    schema_version: 1,
    plan_id: 'lp-three',
    lanes: {
      a: laneDef('a', VALID_SHA, 'wa'),
      b: laneDef('b', ALT_SHA, 'wb'),
      c: laneDef('c', THIRD_SHA, 'wc'),
    },
    dependency_graph: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
  };
  const threeReorder = {
    ...three,
    dependency_graph: [{ from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'a', to: 'b' }],
  };
  const fpA = createLanePlan(three).fingerprint.plan_fingerprint;
  const fpB = createLanePlan(threeReorder).fingerprint.plan_fingerprint;
  assert.strictEqual(fpA, fpB, 'edge insertion order must not affect fingerprint');
}

// ---------------------------------------------------------------------------
// D. Fingerprint changes when authority-bearing topology changes
// ---------------------------------------------------------------------------

function testFingerprintChangesOnTopology() {
  const base = minimalPlan();
  const fp0 = createLanePlan(base).fingerprint.plan_fingerprint;

  // change plan_id
  let m = JSON.parse(JSON.stringify(base));
  m.plan_id = 'lp-changed';
  assert.notStrictEqual(fp0, createLanePlan(m).fingerprint.plan_fingerprint, 'plan_id change must alter fingerprint');

  // add a lane
  m = JSON.parse(JSON.stringify(base));
  m.lanes['lane-x'] = laneDef('lane-x', ALT_SHA, 'ws-x');
  assert.notStrictEqual(fp0, createLanePlan(m).fingerprint.plan_fingerprint, 'lane addition must alter fingerprint');

  // change a SHA
  m = JSON.parse(JSON.stringify(base));
  m.lanes['lane-1'].base.ref = ALT_SHA;
  assert.notStrictEqual(fp0, createLanePlan(m).fingerprint.plan_fingerprint, 'base ref change must alter fingerprint');

  // add a dependency edge
  m = JSON.parse(JSON.stringify(base));
  m.lanes['lane-2'] = laneDef('lane-2', ALT_SHA, 'ws-y');
  m.dependency_graph = [{ from: 'lane-1', to: 'lane-2' }];
  assert.notStrictEqual(fp0, createLanePlan(m).fingerprint.plan_fingerprint, 'dependency edge must alter fingerprint');
}

// ---------------------------------------------------------------------------
// E. Duplicate lane ID rejection (key != lane_id)
// ---------------------------------------------------------------------------

function testDuplicateLaneIdRejection() {
  const p = minimalPlan();
  p.lanes['lane-1'].lane_id = 'different-id';
  assert.throws(() => createLanePlan(p), /mismatches lane_id/, 'lane_id mismatch with object key should be rejected');
}

// ---------------------------------------------------------------------------
// F. Duplicate branch (EXACT_COMMIT SHA) ownership rejection
// ---------------------------------------------------------------------------

function testDuplicateBranchRejection() {
  const p = minimalPlan();
  p.lanes['lane-2'] = laneDef('lane-2', VALID_SHA, 'ws-2');
  assert.throws(() => createLanePlan(p), /Duplicate EXACT_COMMIT branch ownership/, 'two lanes with same EXACT_COMMIT SHA must be rejected');
}

// ---------------------------------------------------------------------------
// G. Duplicate workspace slug rejection
// ---------------------------------------------------------------------------

function testDuplicateWorkspaceSlugRejection() {
  const p = minimalPlan();
  p.lanes['lane-2'] = laneDef('lane-2', ALT_SHA, 'ws-minimal');
  assert.throws(() => createLanePlan(p), /Duplicate workspace\.slug/, 'two lanes with same workspace slug must be rejected');
}

// ---------------------------------------------------------------------------
// H. Unknown dependency rejection
// ---------------------------------------------------------------------------

function testUnknownDependencyRejection() {
  const p = minimalPlan();
  p.dependency_graph = [{ from: 'lane-1', to: 'ghost' }];
  assert.throws(() => createLanePlan(p), /unknown laneId "ghost"/, 'unknown dependency target must be rejected');
}

// ---------------------------------------------------------------------------
// I. Self dependency rejection
// ---------------------------------------------------------------------------

function testSelfDependencyRejection() {
  const p = minimalPlan();
  p.dependency_graph = [{ from: 'lane-1', to: 'lane-1' }];
  assert.throws(() => createLanePlan(p), /self-dependency/, 'self-dependency in dependency_graph must be rejected');

  const pp = minimalPlan();
  pp.integration_graph = [{ from: 'lane-1', to: 'lane-1' }];
  assert.throws(() => createLanePlan(pp), /self-dependency/, 'self-dependency in integration_graph must be rejected');
}

// ---------------------------------------------------------------------------
// J. Dependency-cycle rejection
// ---------------------------------------------------------------------------

function testDependencyCycleRejection() {
  const p = minimalPlan();
  p.lanes['b'] = laneDef('b', ALT_SHA, 'ws-b');
  p.dependency_graph = [
    { from: 'lane-1', to: 'b' },
    { from: 'b', to: 'lane-1' },
  ];
  assert.throws(() => createLanePlan(p), /contains a cycle/, 'dependency cycle must be rejected');
}

// ---------------------------------------------------------------------------
// K. Integration-cycle rejection
// ---------------------------------------------------------------------------

function testIntegrationCycleRejection() {
  const p = minimalPlan();
  p.lanes['b'] = laneDef('b', ALT_SHA, 'ws-b');
  p.integration_graph = [
    { from: 'lane-1', to: 'b' },
    { from: 'b', to: 'lane-1' },
  ];
  assert.throws(() => createLanePlan(p), /contains a cycle/, 'integration cycle must be rejected');
}

// ---------------------------------------------------------------------------
// L. Unknown integration target rejection
// ---------------------------------------------------------------------------

function testUnknownIntegrationTargetRejection() {
  const p = minimalPlan();
  p.integration_graph = [{ from: 'lane-1', to: 'ghost' }];
  assert.throws(() => createLanePlan(p), /unknown laneId "ghost"/, 'unknown integration target must be rejected');
}

// ---------------------------------------------------------------------------
// M. Invalid exact SHA rejection
// ---------------------------------------------------------------------------

function testInvalidExactShaRejection() {
  const p = minimalPlan();
  p.lanes['lane-1'].base = { type: EXACT_COMMIT, ref: INVALID_SHA };
  assert.throws(() => createLanePlan(p), /Git commit SHA-1/, 'invalid exact SHA must be rejected');

  const p2 = minimalPlan();
  p2.lanes['lane-1'].base = { type: EXACT_COMMIT, ref: BAD_SHA_LEN };
  assert.throws(() => createLanePlan(p2), /Git commit SHA-1/, 'short SHA must be rejected');

  const p3 = minimalPlan();
  p3.lanes['lane-1'].base = { type: EXACT_COMMIT, ref: VALID_SHA };
  // uppercase
  p3.lanes['lane-1'].base.ref = VALID_SHA.toUpperCase();
  assert.throws(() => createLanePlan(p3), /Git commit SHA-1/, 'uppercase SHA must be rejected');
}

// ---------------------------------------------------------------------------
// N. Invalid path claim rejection
// ---------------------------------------------------------------------------

function testInvalidPathClaimRejection() {
  const p = minimalPlan();
  p.lanes['lane-1'].mutation_claims = [
    { paths: '/absolute/path.mjs', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false },
  ];
  assert.throws(() => createLanePlan(p), /repository-relative/, 'absolute path claim must be rejected');

  const p2 = minimalPlan();
  p2.lanes['lane-1'].mutation_claims = [
    { paths: '../escape.mjs', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false },
  ];
  assert.throws(() => createLanePlan(p2), /repository-relative/, 'parent-traversal path must be rejected');

  const p3 = minimalPlan();
  p3.lanes['lane-1'].mutation_claims = [
    { paths: '.', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false },
  ];
  assert.throws(() => createLanePlan(p3), /repository-relative/, 'dot path must be rejected');
}

// ---------------------------------------------------------------------------
// O. Invalid lane ID rejection
// ---------------------------------------------------------------------------

function testInvalidLaneIdRejection() {
  const p = minimalPlan();
  p.lanes['Valid-ID'] = p.lanes['lane-1'];
  delete p.lanes['lane-1'];
  assert.throws(() => createLanePlan(p), /laneId must match/, 'uppercase lane ID must be rejected');

  const p2 = minimalPlan();
  p2.lanes['lane/1'] = p2.lanes['lane-1'];
  delete p2.lanes['lane-1'];
  assert.throws(() => createLanePlan(p2), /laneId must match/, 'lane ID with slash must be rejected');

  const p3 = minimalPlan();
  p3.lanes[''] = p3.lanes['lane-1'];
  delete p3.lanes['lane-1'];
  assert.throws(() => createLanePlan(p3), /laneId must match/, 'empty lane ID must be rejected');
}

// ---------------------------------------------------------------------------
// P. Unknown contract fields rejected
// ---------------------------------------------------------------------------

function testUnknownFieldsRejection() {
  const p = minimalPlan();
  p.unknown_top_field = true;
  assert.throws(() => createLanePlan(p), /Unknown LanePlan field/, 'unknown top-level field must be rejected');

  const p2 = minimalPlan();
  p2.lanes['lane-1'].unknown_lane_field = true;
  assert.throws(() => createLanePlan(p2), /Unknown LaneDefinition field/, 'unknown lane-level field must be rejected');

  const p3 = minimalPlan();
  p3.lanes['lane-1'].workspace.extraneous = true;
  assert.throws(() => createLanePlan(p3), /Unknown WorkspaceIntent field/, 'unknown workspace field must be rejected');

  const p4 = minimalPlan();
  p4.schema_version = 2;
  assert.throws(() => createLanePlan(p4), /schema_version must be 1/, 'invalid schema_version must be rejected');

  const p5 = minimalPlan();
  p5.lanes['lane-1'].mutation_claims = [
    { paths: 'src/x.mjs', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false, bogus: true },
  ];
  assert.throws(() => createLanePlan(p5), /Unknown MutationClaim field/, 'unknown mutation claim field must be rejected');
}

// ---------------------------------------------------------------------------
// Q. Duplicate mutation claim rejected
// ---------------------------------------------------------------------------

function testDuplicateMutationClaimRejection() {
  const p = minimalPlan();
  p.lanes['lane-1'].mutation_claims = [
    { paths: 'src/dup.mjs', resources: true, contracts: false, generated_outputs: false, repository_global_state: false, external_state: false },
    { paths: 'src/dup.mjs', resources: false, contracts: true, generated_outputs: false, repository_global_state: false, external_state: false },
  ];
  assert.throws(() => createLanePlan(p), /Duplicate MutationClaim path/, 'duplicate path in mutation claims must be rejected');
}

// ---------------------------------------------------------------------------
// R. LANE_CHECKPOINT references validated
// ---------------------------------------------------------------------------

function testLaneCheckpointReferencesValidated() {
  // Valid checkpoint reference
  const base = { type: LANE_CHECKPOINT, ref: 'cp-1', laneId: 'upstream' };
  const ref = checkoutReference(base);
  assert.strictEqual(ref.type, LANE_CHECKPOINT);
  assert.strictEqual(ref.ref, 'cp-1');
  assert.strictEqual(ref.laneId, 'upstream');

  // Missing laneId
  assert.throws(() => checkoutReference({ type: LANE_CHECKPOINT, ref: 'cp-1' }), /requires laneId/, 'LANE_CHECKPOINT without laneId must be rejected');

  // Invalid base type
  assert.throws(() => checkoutReference({ type: 'UNKNOWN', ref: VALID_SHA }), /must be one of/, 'unknown base type must be rejected');

  // Invalid checkpoint id format
  assert.throws(() => checkoutReference({ type: LANE_CHECKPOINT, ref: 'bad ref', laneId: 'upstream' }), /must match/, 'invalid checkpoint id format must be rejected');
}

// ---------------------------------------------------------------------------
// S. Dependency graph and integration graph remain independently representable
// ---------------------------------------------------------------------------

function testGraphsIndependentlyRepresentable() {
  const p = {
    schema_version: 1,
    plan_id: 'lp-indep',
    lanes: {
      a: laneDef('a', VALID_SHA, 'wa'),
      b: laneDef('b', ALT_SHA, 'wb'),
      c: laneDef('c', THIRD_SHA, 'wc'),
    },
    dependency_graph: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    integration_graph: [{ from: 'a', to: 'c' }],
  };
  const { plan, fingerprint } = createLanePlan(p);
  assert.deepStrictEqual(plan.dependency_graph, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  assert.deepStrictEqual(plan.integration_graph, [{ from: 'a', to: 'c' }]);
  assert.match(fingerprint.plan_fingerprint, /^[0-9a-f]{64}$/);

  // integration-only change differs from fingerprint
  const p2 = JSON.parse(JSON.stringify(p));
  p2.integration_graph = [{ from: 'b', to: 'a' }, { from: 'a', to: 'c' }];
  const fp2 = createLanePlan(p2).fingerprint.plan_fingerprint;
  assert.notStrictEqual(fingerprint.plan_fingerprint, fp2, 'integration-only change must alter fingerprint separately');

  // dependency-only change differs
  const p3 = JSON.parse(JSON.stringify(p));
  p3.dependency_graph = [{ from: 'a', to: 'c' }, { from: 'c', to: 'b' }];
  const fp3 = createLanePlan(p3).fingerprint.plan_fingerprint;
  assert.notStrictEqual(fingerprint.plan_fingerprint, fp3, 'dependency-only change must alter fingerprint separately');
  assert.notStrictEqual(fp2, fp3, 'dependency and integration fingerprints must be independently bound');
}

// ---------------------------------------------------------------------------
// Extra: integration_graph cycle detection at plan level (independent of dep)
// ---------------------------------------------------------------------------

function testIntegrationCycleIndependentlyDetected() {
  const p = minimalPlan();
  p.lanes['b'] = laneDef('b', ALT_SHA, 'ws-b');
  p.dependency_graph = [{ from: 'lane-1', to: 'b' }]; // valid DAG
  p.integration_graph = [{ from: 'b', to: 'lane-1' }, { from: 'lane-1', to: 'b' }]; // cycle in integration only
  assert.throws(() => createLanePlan(p), /contains a cycle/, 'integration cycle must be detected even when dependency graph is acyclic');
}

// ---------------------------------------------------------------------------
// Extra: checkpoint classes enumerable
// ---------------------------------------------------------------------------

function testCheckpointClasses() {
  assert.deepStrictEqual(CHECKPOINT_CLASSES, ['WORK', 'VERIFIED', 'REVIEWED', 'ACCEPTED']);
  assert.strictEqual(CHECKPOINT_CLASS.WORK, 'WORK');
  assert.strictEqual(CHECKPOINT_CLASS.ACCEPTED, 'ACCEPTED');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const TESTS = [
  ['A. valid minimal LanePlan', testValidMinimalPlan],
  ['B. valid multi-lane LanePlan', testValidMultiLanePlan],
  ['C. deterministic fingerprint', testDeterministicFingerprint],
  ['D. fingerprint changes on topology change', testFingerprintChangesOnTopology],
  ['E. duplicate lane ID rejection', testDuplicateLaneIdRejection],
  ['F. duplicate branch ownership rejection', testDuplicateBranchRejection],
  ['G. duplicate workspace slug rejection', testDuplicateWorkspaceSlugRejection],
  ['H. unknown dependency rejection', testUnknownDependencyRejection],
  ['I. self dependency rejection', testSelfDependencyRejection],
  ['J. dependency-cycle rejection', testDependencyCycleRejection],
  ['K. integration-cycle rejection', testIntegrationCycleRejection],
  ['L. unknown integration target rejection', testUnknownIntegrationTargetRejection],
  ['M. invalid exact SHA rejection', testInvalidExactShaRejection],
  ['N. invalid path claim rejection', testInvalidPathClaimRejection],
  ['O. invalid lane ID rejection', testInvalidLaneIdRejection],
  ['P. unknown contract fields rejected', testUnknownFieldsRejection],
  ['Q. duplicate mutation claim rejected', testDuplicateMutationClaimRejection],
  ['R. LANE_CHECKPOINT references validated', testLaneCheckpointReferencesValidated],
  ['S. dependency and integration graphs independently representable', testGraphsIndependentlyRepresentable],
  ['Extra: integration cycle independently detected', testIntegrationCycleIndependentlyDetected],
  ['Extra: checkpoint classes enumerable', testCheckpointClasses],
];

let passed = 0;
let failed = 0;

for (const [name, fn] of TESTS) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

console.log(`\nL0 lane tests: ${passed} passed, ${failed} failed, ${TESTS.length} total`);

if (failed > 0) {
  process.exitCode = 1;
}
