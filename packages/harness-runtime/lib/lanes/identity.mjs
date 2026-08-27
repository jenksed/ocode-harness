/**
 * @file Lane identity primitives.
 *
 * Owns: laneId format, workspaceSlug format, git commit SHA pattern,
 *      SHA-256 fingerprint pattern, checkpointClass enum,
 *      and all identity normalization helpers.
 *
 * Reference conventions follow the repository's existing closed-vocabulary
 * discipline: lowercase, dot-namespace-free lane IDs and deterministic
 * fingerprint patterns.
 */

export const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const EXACT_COMMIT = 'EXACT_COMMIT';
export const LANE_CHECKPOINT = 'LANE_CHECKPOINT';
export const BASE_TYPES = [EXACT_COMMIT, LANE_CHECKPOINT];

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

/**
 * Normalize and validate a LaneBase checkout reference.
 *
 * EXACT_COMMIT requires a 40-char lowercase git SHA.
 * LANE_CHECKPOINT requires a checkpoint_id and a laneId.
 */
export function checkoutReference(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LaneBase must be an object');
  }
  if (raw.type === EXACT_COMMIT) {
    if (raw.laneId !== null && raw.laneId !== undefined) {
      throw new Error('LaneBase EXACT_COMMIT must not carry laneId');
    }
    assertGitSha(raw.ref, 'LaneBase EXACT_COMMIT ref');
    return { type: EXACT_COMMIT, ref: raw.ref, laneId: null };
  }
  if (raw.type === LANE_CHECKPOINT) {
    if (raw.laneId === null || raw.laneId === undefined || typeof raw.laneId !== 'string') {
      throw new Error('LaneBase LANE_CHECKPOINT requires laneId');
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'laneId') === false) {
      throw new Error('LaneBase LANE_CHECKPOINT requires laneId');
    }
    assertCheckpointId(raw.ref);
    assertLaneId(raw.laneId, 'LaneBase LANE_CHECKPOINT laneId');
    return { type: LANE_CHECKPOINT, ref: raw.ref, laneId: raw.laneId };
  }
  throw new Error(`LaneBase type must be one of ${BASE_TYPES.join(', ')}`);
}
