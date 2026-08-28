/**
 * @file Lane identity primitives.
 *
 * Owns: laneId format, workspaceSlug format, git commit SHA pattern,
 *       SHA-256 fingerprint pattern, checkpointClass enum,
 *       and all identity normalization helpers.
 *
 * Reference conventions follow the repository's existing closed-vocabulary
 * discipline: lowercase, dot-namespace-free lane IDs and deterministic
 * fingerprint patterns.
 */

export const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const BRANCH_NAME_PATTERN = /^[a-z0-9][a-z0-9./_-]*$/;

export const EXACT_COMMIT = 'EXACT_COMMIT';
export const LANE_CHECKPOINT_REQUIREMENT = 'LANE_CHECKPOINT_REQUIREMENT';
export const BASE_TYPES = [EXACT_COMMIT, LANE_CHECKPOINT_REQUIREMENT];

export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const CHECKPOINT_CLASSES = ['WORK', 'VERIFIED', 'REVIEWED', 'ACCEPTED'];
export const CHECKPOINT_CLASS = {
  WORK: 'WORK',
  VERIFIED: 'VERIFIED',
  REVIEWED: 'REVIEWED',
  ACCEPTED: 'ACCEPTED',
};

export function assertLaneId(value, label = 'laneId') {
  if (typeof value !== 'string' || !LANE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must match ${LANE_ID_PATTERN.source}: ${value}`);
  }
  return value;
}

export function assertGitSha(value, label = 'value') {
  if (typeof value !== 'string' || !GIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase Git commit SHA-1 (40 hex chars): ${value}`);
  }
  return value;
}

export function assertSHA256(value, label = 'value') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 fingerprint (64 hex chars): ${value}`);
  }
  return value;
}

export function assertBranchName(value, label = 'branchName') {
  if (typeof value !== 'string' || value === '' || !BRANCH_NAME_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-empty branch name matching ${BRANCH_NAME_PATTERN.source}: ${value}`);
  }
  // Additional safety checks
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//') || value.includes('../') ||
      value.includes('./') || value.endsWith('.lock') || value.includes('@{') ||
      value.includes('~') || value.includes('^') || value.includes(':') ||
      value.includes('?') || value.includes('*') || value.includes('[') ||
      value.includes('\\') || /\s/.test(value) || /\u0000/.test(value)) {
    throw new Error(`${label} contains unsafe characters: ${value}`);
  }
  return value;
}

export function assertCheckpointId(value) {
  return assertLaneId(value, 'checkpoint_id');
}

export function assertWorkspaceSlug(value) {
  if (typeof value !== 'string' || !WORKSPACE_SLUG_PATTERN.test(value) || value.includes('/')) {
    throw new Error(
      `workspace.slug must be a portable logical identifier matching ${WORKSPACE_SLUG_PATTERN.source} (no separators): ${value}`,
    );
  }
  return value;
}

export function normalizedLaneId(value) {
  return assertLaneId(value);
}

export function normalizedWorkspaceSlug(value) {
  return assertWorkspaceSlug(value);
}

export function normalizedBranchName(value) {
  return assertBranchName(value);
}

/**
 * Normalize and validate a LaneBase checkout reference.
 *
 * EXACT_COMMIT requires a 40-char lowercase git SHA.
 * LANE_CHECKPOINT_REQUIREMENT requires a lane_id and a minimum_class.
 */
export function checkoutReference(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LaneBase must be an object');
  }
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (key !== 'kind' && key !== 'commit' && key !== 'laneId' && key !== 'minimum_class') {
      throw new Error(`Unknown LaneBase field: ${key}`);
    }
  }
  if (raw.kind === EXACT_COMMIT) {
    if (raw.laneId !== null && raw.laneId !== undefined) {
      throw new Error('LaneBase EXACT_COMMIT must not carry laneId');
    }
    assertGitSha(raw.commit, 'LaneBase EXACT_COMMIT commit');
    return { kind: EXACT_COMMIT, commit: raw.commit, laneId: null };
  }
  if (raw.kind === LANE_CHECKPOINT_REQUIREMENT) {
    if (raw.laneId === null || raw.laneId === undefined || typeof raw.laneId !== 'string') {
      throw new Error('LaneBase LANE_CHECKPOINT_REQUIREMENT requires laneId');
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'laneId') === false) {
      throw new Error('LaneBase LANE_CHECKPOINT_REQUIREMENT requires laneId');
    }
    if (raw.minimum_class === null || raw.minimum_class === undefined || typeof raw.minimum_class !== 'string') {
      throw new Error('LaneBase LANE_CHECKPOINT_REQUIREMENT requires minimum_class');
    }
    assertLaneId(raw.laneId, 'LaneBase LANE_CHECKPOINT_REQUIREMENT laneId');
    oneOf(raw.minimum_class, CHECKPOINT_CLASSES, 'LaneBase LANE_CHECKPOINT_REQUIREMENT minimum_class');
    return { kind: LANE_CHECKPOINT_REQUIREMENT, laneId: raw.laneId, minimum_class: raw.minimum_class };
  }
  throw new Error(`LaneBase kind must be one of ${BASE_TYPES.join(', ')}`);
}

// Helper for oneOf validation (moved from contract.mjs to avoid circular dependency)
function oneOf(value, set, label) {
  if (!set.includes(value)) {
    throw new Error(`${label} must be one of ${set.join(', ')}: ${value}`);
  }
  return value;
}
