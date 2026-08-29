#!/usr/bin/env node
/** Regression coverage for executable, authority-bound subagent delegation. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTaskCapsule,
  renderTaskCapsuleDelegationContext,
} from '../packages/harness-runtime/lib/task-capsule.mjs';
import { executeGovernedTask } from '../packages/harness-runtime/lib/execution.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hex = (character) => character.repeat(64);

function capsule(overrides = {}) {
  return createTaskCapsule({
    task_id: 'inspect-promotion',
    revision: 1,
    parent_fingerprint: null,
    objective: 'Inspect RT-01 candidate-to-stable promotion without changing repository state',
    authoritative_inputs: [{
      id: 'promotion-contract',
      kind: 'PATH',
      reference: 'program/work-packages/PRG-RUNTIME-01.md',
      fingerprint: hex('a'),
      description: 'Governing promotion semantics',
    }],
    scope: { include_paths: ['packages/harness-runtime'], exclude_paths: [] },
    non_goals: ['Do not modify source or release state'],
    constraints: ['Read-only inspection; do not implement or mutate stable'],
    acceptance: [{
      id: 'promotion-inspected',
      requirement: 'Report demonstrated defects, unproven properties, and source/test evidence',
      required_evidence: ['source-trace', 'test-trace'],
    }],
    stop_conditions: ['Stop and report a material authority conflict'],
    context: {
      path_refs: ['program/work-packages/PRG-RUNTIME-01.md'],
      evidence_refs: [],
      max_supplied_chars: 8192,
      max_expansions: 1,
    },
    assumptions: [],
    provenance: { workflow_id: 'delegation-regression', run_id: null, session_id: null, role: 'orchestrator' },
    ...overrides,
  });
}

// V1: the child receives the loaded term, governing authority, constraints,
// acceptance criteria, and evidence request as one executable contract.
const explicit = capsule();
const rendered = renderTaskCapsuleDelegationContext(explicit);
for (const expected of [
  'OBJECTIVE: Inspect RT-01 candidate-to-stable promotion',
  'program/work-packages/PRG-RUNTIME-01.md',
  'Read-only inspection; do not implement or mutate stable',
  'Report demonstrated defects, unproven properties, and source/test evidence',
  'source-trace, test-trace',
]) assert.match(rendered, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
console.log('✓ V1 explicit loaded-term delegation carries objective, authority, constraints, acceptance, and evidence');

// V2: paths, rather than a copied definition, are sufficient bounded authority
// for recovery; the context tells the child to read them before escalating.
assert.match(rendered, /A loaded term is not an invitation to guess/);
assert.match(rendered, /Read the listed authoritative inputs and the bounded path_refs/);
assert.match(rendered, /BOUNDED_RECOVERY_PATHS: program\/work-packages\/PRG-RUNTIME-01\.md/);
console.log('✓ V2 authority paths support bounded repository recovery');

// V3: a title-only call cannot enter the governed task path. A caller must
// supply a valid capsule, which enriches the child assignment before execution.
assert.throws(
  () => executeGovernedTask({ role: 'reviewer', prompt: 'Inspect promotion' }),
  /requires a TaskCapsule/,
);
console.log('✓ V3 title-only delegation is refused before child execution');

// V4/V5: all child roles must return a precise bounded block for conflict or
// absent authority; they are forbidden from silently choosing or asking the
// operator to restate a recoverable term.
for (const role of ['planner', 'coder', 'researcher', 'verifier', 'reviewer', 'wayfinder', 'judge', 'committer']) {
  const policy = readFileSync(resolve(root, 'agents', `${role}.md`), 'utf8');
  assert.match(policy, /## Delegated-context recovery/);
  assert.match(policy, /BLOCKED:\s*AUTHORITY_CONFLICT/);
  assert.match(policy, /BLOCKED:\s*MISSING_AUTHORITY/);
  assert.match(policy, /Do not ask the operator\s+to\s+define a term that is recoverable/);
  assert.match(policy, /do not invent a definition/);
}
assert.match(renderTaskCapsuleDelegationContext(capsule({ authoritative_inputs: [], context: { path_refs: [], evidence_refs: [], max_supplied_chars: 8192, max_expansions: 0 } })), /AUTHORITATIVE_INPUTS:\n- \(none supplied\)/);
console.log('✓ V4/V5 children surface authority conflict or absence without semantic invention or operator escalation');

// V6: the authoritative prompt carries read-only constraints and the one role
// that can edit source explicitly gives supplied constraints priority.
assert.match(rendered, /Read-only inspection; do not implement or mutate stable/);
const coder = readFileSync(resolve(root, 'agents/coder.md'), 'utf8');
assert.match(coder, /constraints override this role's ordinary mutation permission/);
console.log('✓ V6 read-only constraints survive into child context and constrain coder authority');
