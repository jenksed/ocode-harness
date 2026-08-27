/**
 * @file LanePlan public API.
 *
 * This is the single entry point for constructing and fingerprinting
 * a valid LanePlan.  All mutation-plan topology declarations MUST pass
 * through `createLanePlan` so that validation cannot be bypassed.
 *
 * Public surface:
 *   createLanePlan(raw)           -> validated LanePlan with fingerprint
 *   computeFingerprint(plan)      -> { plan_fingerprint, participating_fields }
 *   VALID_LANE_STATES             -> array
 *   CHECKPOINT_CLASSES            -> array
 */

import { validateLanePlan, computeLanePlanFingerprint } from './contract.mjs';

export const VALID_LANE_STATES = [
  'PENDING',
  'ACTIVE',
  'INTEGRATED',
  'CLOSEOUT_READY',
  'REVIEW_READY',
  'ABANDONED',
];

export const CHECKPOINT_CLASSES = ['WORK', 'VERIFIED', 'REVIEWED', 'ACCEPTED'];

/**
 * Validate and construct a LanePlan from its raw representation.
 *
 * Throws on the first detected contract violation.  Does not modify
 * the input object (operates on properties read from it).
 *
 * @param {object} raw - untrusted LanePlan representation
 * @returns {{ plan: object, fingerprint: { plan_fingerprint, participating_fields } }}
 */
export function createLanePlan(raw) {
  const plan = validateLanePlan(raw);
  const fingerprint = computeLanePlanFingerprint(plan);
  return { plan, fingerprint };
}

/**
 * Compute or recompute the fingerprint of an already-validated LanePlan.
 * Does not re-validate; use `createLanePlan` for validation + fingerprint.
 *
 * @param {object} plan - a plain object returned by `createLanePlan().plan`
 * @returns {{ plan_fingerprint: string, participating_fields: string[] }}
 */
export function computeFingerprint(plan) {
  return computeLanePlanFingerprint(plan);
}
