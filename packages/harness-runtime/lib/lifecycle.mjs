const STATES = [
  'ACTIVE', 'REVIEW_READY', 'REVIEW_ACCEPTED', 'CLOSEOUT_READY',
  'COMMITTED', 'PUSHED', 'COMPLETE', 'BLOCKED', 'FAILED',
  'PLANNING_READY', 'PLANNED', 'PROVEN', 'DEFERRED'
];

const LEGAL_TRANSITIONS_MAP = {
  ACTIVE: ['REVIEW_READY', 'BLOCKED', 'FAILED', 'PLANNING_READY', 'DEFERRED'],
  REVIEW_READY: ['REVIEW_ACCEPTED', 'BLOCKED', 'FAILED', 'DEFERRED'],
  REVIEW_ACCEPTED: ['CLOSEOUT_READY', 'PROVEN', 'BLOCKED', 'FAILED', 'DEFERRED'],
  CLOSEOUT_READY: ['COMMITTED', 'BLOCKED', 'FAILED', 'DEFERRED'],
  COMMITTED: ['PUSHED', 'BLOCKED', 'FAILED', 'DEFERRED'],
  PUSHED: ['COMPLETE', 'BLOCKED', 'FAILED', 'DEFERRED'],
  COMPLETE: [],
  BLOCKED: ['ACTIVE'],
  FAILED: ['ACTIVE'],
  PLANNING_READY: ['PLANNED', 'ACTIVE', 'BLOCKED', 'FAILED', 'DEFERRED'],
  PLANNED: ['ACTIVE', 'BLOCKED', 'FAILED', 'DEFERRED'],
  PROVEN: ['CLOSEOUT_READY', 'BLOCKED', 'FAILED', 'DEFERRED'],
  DEFERRED: ['PLANNING_READY', 'ACTIVE', 'BLOCKED', 'FAILED'],
};

export const LIFECYCLE_STATES = STATES;
export const LEGAL_TRANSITIONS = LEGAL_TRANSITIONS_MAP;

export function isLegalTransition(current, next) {
  if (!STATES.includes(current)) throw new Error(`Unknown state: ${current}`);
  if (!STATES.includes(next)) throw new Error(`Unknown state: ${next}`);
  return LEGAL_TRANSITIONS_MAP[current].includes(next);
}

export function transition(current, next) {
  if (!isLegalTransition(current, next)) {
    throw new Error(`Illegal transition: ${current} → ${next}`);
  }
  return next;
}