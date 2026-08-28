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
  assertLaneId, assertGitSha, assertSHA256, assertWorkspaceSlug,
  normalizedLaneId, normalizedWorkspaceSlug,
  normalizedBranchName,
  checkoutReference,
  EXACT_COMMIT, LANE_CHECKPOINT_REQUIREMENT, BASE_TYPES,
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

// ---------------------------------------------------------------------------
// Path validation (repository-relative, no absolute, no "..", not ".")
// ---------------------------------------------------------------------------

/**
 * Validate a repository-relative path segment (no absolute, no "..", not ".").
 * Checks path SEGMENTS rather than substring "..".
 */
/**
 * Validate a repository-relative path segment (no absolute, no "..", not ".").
 * Checks path SEGMENTS rather than substring "..".
 */
/**
 * Validate a repository-relative path segment (no absolute, no "..", not ".").
 * Checks path SEGMENTS rather than substring "..".
 */
function relPath(value, label) {
  str(value, label);
  if (value.includes("\\")) {
    throw new Error(`${label} must be a repository-relative normalized path (no backslashes): ${value}`);
  }

  // Split into path segments and validate each
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '') {
      throw new Error(`${label} must be a repository-relative normalized path (no empty segments): ${value}`);
    }
    if (segment === '.') {
      throw new Error(`${label} must be a repository-relative normalized path (no "." segments): ${value}`);
    }
    if (segment === '..') {
      throw new Error(`${label} must be a repository-relative normalized path (no ".." segments): ${value}`);
    }
  }

  return value;
}



// ---------------------------------------------------------------------------
// Fingerprint validation
// ---------------------------------------------------------------------------

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
// MutationClaims (six actual collections)
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
  
  // Normalize paths array
  const paths = arr(raw.paths, 'MutationClaim.paths').map(path => relPath(path, 'MutationClaim.paths item'));
  
  // Validate and normalize resource arrays
  const resources = arr(raw.resources, 'MutationClaim.resources').map(resource => {
    str(resource, 'MutationClaim.resources item');
    return resource;
  });
  
  const contracts = arr(raw.contracts, 'MutationClaim.contracts').map(contract => {
    str(contract, 'MutationClaim.contracts item');
    return contract;
  });
  
  const generated_outputs = arr(raw.generated_outputs, 'MutationClaim.generated_outputs').map(output => {
    str(output, 'MutationClaim.generated_outputs item');
    return output;
  });
  
  const repository_global_state = arr(raw.repository_global_state, 'MutationClaim.repository_global_state').map(state => {
    str(state, 'MutationClaim.repository_global_state item');
    return state;
  });
  
  const external_state = arr(raw.external_state, 'MutationClaim.external_state').map(state => {
    str(state, 'MutationClaim.external_state item');
    return state;
  });

  return {
    paths,
    resources,
    contracts,
    generated_outputs,
    repository_global_state,
    external_state,
  };
}

/**
 * Validate the array of MutationClaims.
 * Rejects: non-array, missing paths, duplicate entries.
 */
export function validateMutationClaims(claims) {
  const normalized = [];
  const pathsSeen = new Set();
  const resourcesSeen = new Set();
  const contractsSeen = new Set();
  const generatedOutputsSeen = new Set();
  const repositoryGlobalStateSeen = new Set();
  const externalStateSeen = new Set();

  for (let i = 0; i < claims.length; i++) {
    const raw = claims[i];
    own(raw, `MutationClaims[${i}]`);
    const nc = normalizeMutationClaim(raw);
    
    // Check for duplicate paths
    const pathKey = nc.paths.join('|');
    if (pathsSeen.has(pathKey)) {
      throw new Error(`Duplicate MutationClaim path set "${pathKey}" at index ${i}`);
    }
    pathsSeen.add(pathKey);
    
    // Check for duplicate resources
    const resourcesKey = nc.resources.join('|');
    if (resourcesSeen.has(resourcesKey)) {
      throw new Error(`Duplicate MutationClaim resources "${resourcesKey}" at index ${i}`);
    }
    resourcesSeen.add(resourcesKey);
    
    // Check for duplicate contracts
    const contractsKey = nc.contracts.join('|');
    if (contractsSeen.has(contractsKey)) {
      throw new Error(`Duplicate MutationClaim contracts "${contractsKey}" at index ${i}`);
    }
    contractsSeen.add(contractsKey);
    
    // Check for duplicate generated_outputs
    const generatedOutputsKey = nc.generated_outputs.join('|');
    if (generatedOutputsSeen.has(generatedOutputsKey)) {
      throw new Error(`Duplicate MutationClaim generated_outputs "${generatedOutputsKey}" at index ${i}`);
    }
    generatedOutputsSeen.add(generatedOutputsKey);
    
    // Check for duplicate repository_global_state
    const repositoryGlobalStateKey = nc.repository_global_state.join('|');
    if (repositoryGlobalStateSeen.has(repositoryGlobalStateKey)) {
      throw new Error(`Duplicate MutationClaim repository_global_state "${repositoryGlobalStateKey}" at index ${i}`);
    }
    repositoryGlobalStateSeen.add(repositoryGlobalStateKey);
    
    // Check for duplicate external_state
    const externalStateKey = nc.external_state.join('|');
    if (externalStateSeen.has(externalStateKey)) {
      throw new Error(`Duplicate MutationClaim external_state "${externalStateKey}" at index ${i}`);
    }
    externalStateSeen.add(externalStateKey);
    
    normalized.push(nc);
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// TaskBinding (no lane_id, no agent_version)
// ---------------------------------------------------------------------------

const TASK_BINDING_FIELDS = [
  'task_id',
  'task_fingerprint',
];

export function validateTaskBinding(raw) {
  if (raw === null || raw === undefined) return null;
  own(raw, 'TaskBinding');
  onlyKeys(raw, TASK_BINDING_FIELDS, 'TaskBinding');

  const out = {};
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
// LaneCheckpoint (runtime checkpoint, not intent)
// ---------------------------------------------------------------------------

const LANE_CHECKPOINT_FIELDS = [
  'checkpoint_id',
  'lane_id',
  'commit',           // 40-char Git commit, not SHA-256
  'checkpoint_class',
  'evidence_refs',
  'task_fingerprint', // optional 64-char SHA-256
];

export function validateLaneCheckpoint(raw) {
  own(raw, 'LaneCheckpoint');
  onlyKeys(raw, LANE_CHECKPOINT_FIELDS, 'LaneCheckpoint');

  const evidenceRefs = arr(raw.evidence_refs, 'LaneCheckpoint.evidence_refs').map(ref => {
    str(ref, `LaneCheckpoint.evidence_refs item`);
    return ref;
  });
  
  // Check for duplicate evidence refs
  const seen = new Set();
  for (let i = 0; i < evidenceRefs.length; i++) {
    const ref = evidenceRefs[i];
    if (seen.has(ref)) {
      throw new Error(`Duplicate LaneCheckpoint evidence_ref "${ref}"`);
    }
    seen.add(ref);
  }

  return {
    checkpoint_id: assertLaneId(raw.checkpoint_id),
    lane_id: assertLaneId(raw.lane_id),
    commit: assertGitSha(raw.commit, 'LaneCheckpoint.commit'),
    checkpoint_class: oneOf(raw.checkpoint_class, CHECKPOINT_CLASSES, 'LaneCheckpoint.checkpoint_class'),
    evidence_refs: evidenceRefs,
    task_fingerprint: raw.task_fingerprint ? fingerprint(raw.task_fingerprint, 'LaneCheckpoint.task_fingerprint') : null,
  };
}

// ---------------------------------------------------------------------------
// LaneDefinition (NO state field, HAS branch field)
// ---------------------------------------------------------------------------

const LANE_DEFINITION_FIELDS = [
  'lane_id',
  'name',
  'description',
  'base',
  'branch',           // explicit branch intent
  'workspace',
  'mutation_claims',
  'task_binding',
  'integration_intent',
];

export function validateLaneDefinition(raw) {
  onlyKeys(raw, LANE_DEFINITION_FIELDS, 'LaneDefinition');

  const out = {
    lane_id: assertLaneId(raw.lane_id),
    name: str(raw.name, 'LaneDefinition.name'),
    description: str(raw.description, 'LaneDefinition.description'),
  };

  out.base = checkoutReference(raw.base);
  out.branch = normalizedBranchName(str(raw.branch, 'LaneDefinition.branch'));

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

  if ('integration_intent' in raw && raw.integration_intent !== null && raw.integration_intent !== undefined) {
    out.integration_intent = validateLaneIntegrationIntent(raw.integration_intent);
  } else {
    out.integration_intent = null;
  }

  return out;
}

// ---------------------------------------------------------------------------
// LaneIntegrationIntent (simplified - no integration_order, target uses lane identity)
// ---------------------------------------------------------------------------

const LANE_INTEGRATION_INTENT_FIELDS = [
  'target_lane_id',   // references lane identity, not checkout reference
  'target_class',     // optional minimum class for target
];

export function validateLaneIntegrationIntent(raw) {
  own(raw, 'LaneIntegrationIntent');
  onlyKeys(raw, LANE_INTEGRATION_INTENT_FIELDS, 'LaneIntegrationIntent');

  const out = {};
  
  // target_lane_id is optional (root lanes may have no target)
  if ('target_lane_id' in raw && raw.target_lane_id !== null && raw.target_lane_id !== undefined) {
    out.target_lane_id = assertLaneId(raw.target_lane_id, 'LaneIntegrationIntent.target_lane_id');
  } else {
    out.target_lane_id = null;
  }
  
  // target_class is optional
  if ('target_class' in raw && raw.target_class !== null && raw.target_class !== undefined) {
    out.target_class = oneOf(raw.target_class, CHECKPOINT_CLASSES, 'LaneIntegrationIntent.target_class');
  } else {
    out.target_class = null;
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
];

// Remove metadata from authoritative contract - it's presentation-only
// If needed for presentation, it should be handled outside the identity boundary

export function validateLanePlan(raw) {
  onlyKeys(raw, LANE_PLAN_FIELDS, 'LanePlan');

  if (typeof raw.schema_version !== 'number' || raw.schema_version !== 1) {
    throw new Error(`LanePlan schema_version must be 1, got: ${raw.schema_version}`);
  }

  const planId = str(raw.plan_id, 'LanePlan.plan_id');

  if (!raw.lanes || typeof raw.lanes !== 'object' || Array.isArray(raw.lanes)) {
    throw new Error('LanePlan.lanes must be an object (map from laneId to LaneDefinition)');
  }
  
  // Reject empty lanes map
  if (Object.keys(raw.lanes).length === 0) {
    throw new Error('LanePlan must contain at least one lane');
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

    // branch uniqueness - two lanes MAY start from the same exact commit
    // but they MUST NOT own the same intended branch
    if (branches.has(def.branch)) {
      throw new Error(`Duplicate branch ownership "${def.branch}" for lane "${def.lane_id}"`);
    }
    branches.add(def.branch);

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

  return {
    schema_version: 1,
    plan_id: planId,
    lanes: Object.fromEntries(
      [...laneDefs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), // deterministic order
    ),
    dependency_graph: depGraph.edges,
    integration_graph: intGraph.edges,
  };
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
 *       - lane_id
 *       - branch
 *       - base
 *       - workspace.slug
 *       - mutation_claims
 *       - task_binding (when present)
 *   - dependency_graph (sorted edges; edge key = from + '->' + to)
 *   - integration_graph (sorted edges; edge key = from + '->' + to)
 *
 * Excluded from identity:
 *   - name/description (presentation-only)
 *   - absolute local worktree paths
 *   - timestamps
 *   - usernames
 *   - machine identifiers
 *   - object key insertion order
 *   - arbitrary metadata fields
 */

export function computeLanePlanFingerprint(plan) {
  // Sort lanes by laneId for deterministic ordering
  const sortedLaneEntries = Object.entries(plan.lanes)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, def]) => def);

  // Normalize mutation claims for deterministic ordering
  const normalizedLanes = sortedLaneEntries.map(def => ({
    lane_id: def.lane_id,
    branch: def.branch,
    base: def.base,
    workspace: {
      slug: def.workspace.slug,
      // description excluded from identity (presentation-only)
    },
    mutation_claims: def.mutation_claims.map(claim => ({
      // Sort arrays for deterministic ordering
      paths: [...claim.paths].sort(),
      resources: [...claim.resources].sort(),
      contracts: [...claim.contracts].sort(),
      generated_outputs: [...claim.generated_outputs].sort(),
      repository_global_state: [...claim.repository_global_state].sort(),
      external_state: [...claim.external_state].sort(),
    })).sort((a, b) => {
      // Sort mutation claims by their normalized representation
      const keyA = JSON.stringify({
        paths: a.paths,
        resources: a.resources,
        contracts: a.contracts,
        generated_outputs: a.generated_outputs,
        repository_global_state: a.repository_global_state,
        external_state: a.external_state,
      });
      const keyB = JSON.stringify({
        paths: b.paths,
        resources: b.resources,
        contracts: b.contracts,
        generated_outputs: b.generated_outputs,
        repository_global_state: b.repository_global_state,
        external_state: b.external_state,
      });
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    }),
    task_binding: def.task_binding ? {
      task_id: def.task_binding.task_id,
      task_fingerprint: def.task_binding.task_fingerprint,
    } : null,
    integration_intent: def.integration_intent ? {
      target_lane_id: def.integration_intent.target_lane_id,
      // target_class excluded - presentation only
    } : null,
  }));

  // Sort dependency edges deterministically
  const depEdges = [...plan.dependency_graph]
    .map(edge => ({ from: edge.from, to: edge.to }))
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      return a.to < b.to ? -1 : 1;
    });

  // Sort integration edges deterministically
  const intEdges = [...plan.integration_graph]
    .map(edge => ({ from: edge.from, to: edge.to }))
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      return a.to < b.to ? -1 : 1;
    });

  const identityObject = {
    schema_version: plan.schema_version,
    plan_id: plan.plan_id,
    lanes: Object.fromEntries(
      normalizedLanes.map(def => [def.lane_id, def]),
    ),
    dependency_graph: depEdges,
    integration_graph: intEdges,
  };

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
    ],
  };
}
