/**
 * DD2's production skill authority.
 *
 * This is deliberately not a directory scan. The six IDs are the existing
 * M6.5 production catalog (test/test-m6.5-skills.mjs), whose canonical source
 * and deterministic admission proof are already part of the accepted program.
 * DD2 does not qualify or promote additional skills.
 */
export const ADMITTED_CANONICAL_SKILL_IDS = Object.freeze([
  'adversarial-review',
  'architecture-change-design',
  'blast-radius-analysis',
  'codebase-investigation',
  'systematic-debugging',
  'tdd',
]);
