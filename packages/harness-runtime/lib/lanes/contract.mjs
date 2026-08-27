/**
 * @file Lane contract validators.
 *
 * Owns: field-level normalization and validation for every L0 domain type.
 *
 * Uses the repository's established canonicalize/canonicalJSONStringify
 * for deterministic serialization and the same SHA-256 fingerprint convention
 * as agent-contract.mjs.
 *
 * Validation discipline:
 *   - schema_version required
 *   - unknown fields rejected (additionalProperties = false semantics)
 *   - strings normalized
 *   - IDs validated via regex
 *   - duplicate arrays rejected
 *   - repository-relative paths validated (no absolute, no "..", not ".")
 *   - canonical serialization used
 *   - fingerprints matched to /^[0-9a-f]{64}$/
 */

import { canonicalJSONStringify } from '../agent-contract.mjs';
import { createHash } from 'node:crypto';
import {
  assertLaneId, assertSHA256, assertWorkspaceSlug,
  normalizedLaneId, normalizedWorkspaceSlug,
  checkoutReference,
  EXACT_COMMIT, LANE_CHECKPOINT, BASE_TYPES,
  CHECKPOINT_CLASSES,
  CHECKPOINT_CLASS,
} from './identity.mjs';
import { validateDirectedGraph } from './graph.mjs';

// ---------------------------------------------------------------------------
// Generic object helpers
// ---------------------------------------------------------------------------

function own(value, label) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function str(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function arr(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function int(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function bool(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

/**
 * Reject unknown keys on a plain object.
 */
function onlyKeys(value, allowed, label) {
  own(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown ${label} field: ${key}`);
    }
  }
}

/**
 * Validate a repository-relative path segment (no absolute, no "..", not ".").
 */
function relPath(value, label) {
  str(value, label);
  if (value.includes('\\') || value.startsWith('/') || value === '.' || value.includes('..')) {
    throw new Error(`${label} must be a repository-relative normalized path: ${value}`);
  }
  return value;
}

function fingerprint(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint (64 hex chars)`);
  }
  return value;
}

function oneOf(value, set, label) {
  if (!set.includes(value)) {
    throw new Error(`${label} must be one of ${set.join(', ')}: ${value}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// MutationClaims
// ---------------------------------------------------------------------------

const MUTATION_CLAIM_FIELDS = [
  'paths',
  'resources',
  'contracts',
  'generated_outputs',
  'repository_global_state',
  'external_state',
];

function normalizeMutationClaim(raw) {
  own(raw, 'MutationClaim');
  onlyKeys(raw, MUTATION_CLAIM_FIELDS, 'MutationClaim');
  const path = relPath(raw.paths, 'MutationClaim.paths');

  const boolFields = [
    'resources',
    'contracts',
    'generated_outputs',
    'repository_global_state',
    'external_state',
  ];
  for (const field of boolFields) {
    bool(raw[field], `MutationClaim.${field}`);
  }

  return {
    paths: path,
    resources: raw.resources,
    contracts: raw.contracts,
    generated_outputs: raw.generated_outputs,
    repository_global_state: raw.repository_global_state,
    external_state: raw.external_state,
  };
}

/**
 * Validate the array of MutationClaims.
 * Rejects: non-array, missing paths, missing bool fields, duplicate path entries.
 */
export function validateMutationClaims(claims) {
  const normalized = [];
  const seen = new Set();

  for (let i = 0; i < claims.length; i++) {
    const raw = claims[i];
    own(raw, `MutationClaims[${i}]`);
    const nc = normalizeMutationClaim(raw);
    if (seen.has(nc.paths)) {
      throw new Error(`Duplicate MutationClaim path "${nc.paths}" at index ${i}`);
    }
    seen.add(nc.paths);
    normalized.push(nc);
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// TaskBinding
// ---------------------------------------------------------------------------

const TASK_BINDING_FIELDS = [
  'lane_id',
  'task_id',
  'task_fingerprint',
  'agent_version',
];

export function validateTaskBinding(raw) {
  if (raw === null || raw === undefined) return null;
  own(raw, 'TaskBinding');
  onlyKeys(raw, TASK_BINDING_FIELDS, 'TaskBinding');

  const out = {};
  if (raw.lane_id !== undefined) {
    out.lane_id = assertLaneId(raw.lane_id);
  } else {
    out.lane_id = null;
  }
  if ('task_id' in raw) {
    out.task_id = str(raw.task_id, 'TaskBinding.task_id');
  } else {
    out.task_id = null;
  }
  if ('task_fingerprint' in raw) {
    out.task_fingerprint = fingerprint(raw.task_fingerprint, 'TaskBinding.task_fingerprint');
  } else {
    out.task_fingerprint = null;
  }
  if ('agent_version' in raw) {
    out.agent_version = str(raw.agent_version, 'TaskBinding.agent_version');
  } else {
    out.agent_version = null;
  }

  return out;
}

// ---------------------------------------------------------------------------
// WorkspaceIntent
// ---------------------------------------------------------------------------

const WORKSPACE_INTENT_FIELDS = ['slug', 'description'];

export function validateWorkspaceIntent(raw) {
  own(raw, 'WorkspaceIntent');
  onlyKeys(raw, WORKSPACE_INTENT_FIELDS, 'WorkspaceIntent');

  return {
    slug: normalizedWorkspaceSlug(raw.slug),
    description: raw.description || '',
  };
}

// ---------------------------------------------------------------------------
// LaneCheckpoint (type description, validated at instantiation)
// ---------------------------------------------------------------------------

const LANE_CHECKPOINT_FIELDS = [
  'checkpoint_id',
  'lane_id',
  'sha',
  'checkpoint_class',
  'evidence_refs',
  'task_fingerprint',
];

export function validateLaneCheckpoint(raw) {
  own(raw, 'LaneCheckpoint');
  onlyKeys(raw, LANE_CHECKPOINT_FIELDS, 'LaneCheckpoint');

  const evidenceRefs = arr(raw.evidence_refs, 'LaneCheckpoint.evidence_refs');
  const seen = new Set();
  for (let i = 0; i < evidenceRefs.length; i++) {
    const ref = evidenceRefs[i];
    str(ref, `LaneCheckpoint.evidence_refs[${i}]`);
    if (seen.has(ref)) {
      throw new Error(`Duplicate LaneCheckpoint evidence_ref "${ref}"`);
    }
    seen.add(ref);
  }

  return {
    checkpoint_id: assertLaneId(raw.checkpoint_id),
    lane_id: assertLaneId(raw.lane_id),
    sha: assertSHA256(raw.sha, 'LaneCheckpoint.sha'),
    checkpoint_class: oneOf(raw.checkpoint_class, CHECKPOINT_CLASSES, 'LaneCheckpoint.checkpoint_class'),
    evidence_refs: evidenceRefs,
    task_fingerprint: raw.task_fingerprint ? fingerprint(raw.task_fingerprint, 'LaneCheckpoint.task_fingerprint') : null,
  };
}

// ---------------------------------------------------------------------------
// LaneDefinition
// ---------------------------------------------------------------------------

const LANE_DEFINITION_FIELDS = [
  'lane_id',
  'name',
  'description',
  'base',
  'state',
  'workspace',
  'mutation_claims',
  'task_binding',
  'integration_intent',
  'metadata',
];

const LEGAL_LANE_STATES = [
  'PENDING',
  'ACTIVE',
  'INTEGRATED',
  'CLOSEOUT_READY',
  'REVIEW_READY',
  'ABANDONED',
];

export function validateLaneDefinition(raw) {
  onlyKeys(raw, LANE_DEFINITION_FIELDS, 'LaneDefinition');

  const out = {
    lane_id: assertLaneId(raw.lane_id),
    name: str(raw.name, 'LaneDefinition.name'),
    description: str(raw.description, 'LaneDefinition.description'),
  };

  out.base = checkoutReference(raw.base);
  out.state = oneOf(raw.state, LEGAL_LANE_STATES, 'LaneDefinition.state');

  if ('workspace' in raw) {
    out.workspace = validateWorkspaceIntent(raw.workspace);
  } else {
    throw new Error('LaneDefinition requires workspace');
  }

  if ('mutation_claims' in raw) {
    out.mutation_claims = validateMutationClaims(arr(raw.mutation_claims, 'LaneDefinition.mutation_claims'));
  } else {
    out.mutation_claims = [];
  }

  if ('task_binding' in raw) {
    out.task_binding = validateTaskBinding(raw.task_binding);
  } else {
    out.task_binding = null;
  }

  if ('integration_intent' in raw) {
    out.integration_intent = validateLaneIntegrationIntent(raw.integration_intent);
  } else {
    out.integration_intent = null;
  }

  if ('metadata' in raw) {
    out.metadata = own(raw.metadata, 'LaneDefinition.metadata');
  } else {
    out.metadata = {};
  }

  return out;
}

// ---------------------------------------------------------------------------
// LaneIntegrationIntent
// ---------------------------------------------------------------------------

const LANE_INTEGRATION_INTENT_FIELDS = [
  'integration_target',
  'integration_order',
  'target_class',
];

export function validateLaneIntegrationIntent(raw) {
  own(raw, 'LaneIntegrationIntent');
  onlyKeys(raw, LANE_INTEGRATION_INTENT_FIELDS, 'LaneIntegrationIntent');

  if (!raw.integration_target && !raw.integration_order) {
    throw new Error(
      'LaneIntegrationIntent requires at least integration_target or integration_order',
    );
  }

  let it = null;
  if (raw.integration_target !== undefined && raw.integration_target !== null) {
    it = checkoutReference(raw.integration_target);
  }

  let io = null;
  if (raw.integration_order !== undefined && raw.integration_order !== null) {
    io = arr(raw.integration_order, 'LaneIntegrationIntent.integration_order');
    for (let i = 0; i < io.length; i++) {
      assertLaneId(io[i]);
    }
  }

  const out = {};
  if (it) out.integration_target = it;
  if (io) out.integration_order = io;
  if ('target_class' in raw && raw.target_class !== undefined && raw.target_class !== null) {
    out.target_class = oneOf(
      raw.target_class,
      CHECKPOINT_CLASSES,
      'LaneIntegrationIntent.target_class',
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// LanePlan
// ---------------------------------------------------------------------------

const LANE_PLAN_FIELDS = [
  'schema_version',
  'plan_id',
  'lanes',
  'dependency_graph',
  'integration_graph',
  'metadata',
];

export function validateLanePlan(raw) {
  onlyKeys(raw, LANE_PLAN_FIELDS, 'LanePlan');

  if (typeof raw.schema_version !== 'number' || raw.schema_version !== 1) {
    throw new Error(`LanePlan schema_version must be 1, got: ${raw.schema_version}`);
  }

  const planId = str(raw.plan_id, 'LanePlan.plan_id');

  if (!raw.lanes || typeof raw.lanes !== 'object' || Array.isArray(raw.lanes)) {
    throw new Error('LanePlan.lanes must be an object (map from laneId to LaneDefinition)');
  }

  const laneDefs = new Map();
  const laneIds = new Set();
  const branches = new Set();
  const slugs = new Set();

  for (const [key, val] of Object.entries(raw.lanes)) {
    if (key !== normalizedLaneId(key)) {
      throw new Error(`LanePlan.lanes key "${key}" is not a normalized laneId`);
    }
    const def = validateLaneDefinition(val);

    if (def.lane_id !== key) {
      throw new Error(`Duplicate laneId ${def.lane_id}: key "${key}" mismatches lane_id`);
    }

    if (laneIds.has(def.lane_id)) {
      throw new Error(`Duplicate laneId in LanePlan: ${def.lane_id}`);
    }
    laneIds.add(def.lane_id);
    laneDefs.set(def.lane_id, def);

    // branch uniqueness (EXACT_COMMIT ref = the resolved commit SHA = branch identity)
    if (def.base.type === EXACT_COMMIT) {
      const branch = def.base.ref;
      if (branches.has(branch)) {
        throw new Error(`Duplicate EXACT_COMMIT branch ownership "${branch}" for lane "${def.lane_id}"`);
      }
      branches.add(branch);
    }

    // workspace slug uniqueness
    if (slugs.has(def.workspace.slug)) {
      throw new Error(`Duplicate workspace.slug "${def.workspace.slug}"`);
    }
    slugs.add(def.workspace.slug);
  }

  // Graphs: validate against the resolved lane ID set.
  const depGraph = ('dependency_graph' in raw)
    ? validateDirectedGraph(arr(raw.dependency_graph, 'LanePlan.dependency_graph'), laneIds, 'LanePlan.dependency_graph')
    : { edges: [], laneIds: new Set() };

  const intGraph = ('integration_graph' in raw)
    ? validateDirectedGraph(arr(raw.integration_graph, 'LanePlan.integration_graph'), laneIds, 'LanePlan.integration_graph')
    : { edges: [], laneIds: new Set() };

  const metadata = raw.metadata ? own(raw.metadata, 'LanePlan.metadata') : {};

  return {
    schema_version: 1,
    plan_id: planId,
    lanes: Object.fromEntries(
      [...laneDefs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    dependency_graph: depGraph.edges,
    integration_graph: intGraph.edges,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint validation utility
// ---------------------------------------------------------------------------

export function validateCheckpointReference(raw) {
  return checkoutReference(raw);
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic LanePlan fingerprint.
 *
 * Identity participants (in canonical order):
 *   - schema_version
 *   - plan_id
 *   - all lanes (keys AND values, sorted by laneId)
 *   - dependency_graph (sorted edges; edge key = from + '->' + to)
 *   - integration_graph (sorted edges; edge key = from + '->' + to)
 *   - metadata (if present and non-empty)
 *
 * Excluded from identity:
 *   - absolute local worktree paths
 *   - timestamps
 *   - usernames
 *   - machine identifiers
 *   - object key insertion order
 *
 * @param {object} plan - a validated LanePlan (or its output)
 * @returns {{ plan_fingerprint: string, participating_fields: string[] }}
 */
export function computeLanePlanFingerprint(plan) {
  const sortedLaneEntries = Object.entries(plan.lanes)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, def]) => def);

  const depEdges = [...plan.dependency_graph]
    .sort((a, b) => {
      const ak = `${a.from}->${a.to}`;
      const bk = `${b.from}->${b.to}`;
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    })
    .map((e) => ({ from: e.from, to: e.to }));

  const intEdges = [...plan.integration_graph]
    .sort((a, b) => {
      const ak = `${a.from}->${a.to}`;
      const bk = `${b.from}->${b.to}`;
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    })
    .map((e) => ({ from: e.from, to: e.to }));

  const identityObject = {
    schema_version: plan.schema_version,
    plan_id: plan.plan_id,
    lanes: Object.fromEntries(
      sortedLaneEntries.map((def) => [def.lane_id, def]),
    ),
    dependency_graph: depEdges,
    integration_graph: intEdges,
  };

  if (plan.metadata && Object.keys(plan.metadata).length > 0) {
    identityObject.metadata = plan.metadata;
  }

  const canonical = canonicalJSONStringify(identityObject);
  const digest = createHash('sha256').update(canonical).digest('hex');

  return {
    plan_fingerprint: digest,
    participating_fields: [
      'schema_version',
      'plan_id',
      'lanes',
      'dependency_graph',
      'integration_graph',
      'metadata',
    ],
  };
}
