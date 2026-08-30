/** The intentionally small capability contract for the DD3 daily-driver. */
export const CANDIDATE_CAPABILITIES = Object.freeze({
  'safe-git-inspection': Object.freeze({ status: 'SUPPORTED', detail: 'Safe repository observation is allowed by the governed authority contract.' }),
  'bounded-workspace-mutation': Object.freeze({ status: 'ASK', detail: 'Bounded workspace mutation requires OpenCode approval.' }),
  'git-stage': Object.freeze({ status: 'UNSUPPORTED', detail: 'Git staging is denied for this candidate.' }),
  'git-commit': Object.freeze({ status: 'UNSUPPORTED', detail: 'Git commit is denied for this candidate.' }),
  'git-push': Object.freeze({ status: 'UNSUPPORTED', detail: 'Git push is denied for this candidate.' }),
  'project-opencode-composition': Object.freeze({ status: 'SUPPORTED QUALIFIED CATEGORIES', detail: 'Only governed agents and admitted canonical skills are composed.' }),
  'canonical-ocode-skills': Object.freeze({ status: 'SUPPORTED', detail: 'The DD2 canonical skill catalog is installed and admitted centrally.' }),
  'self-update': Object.freeze({ status: 'UNSUPPORTED', detail: 'Daily-driver self-update is not qualified.' }),
  rollback: Object.freeze({ status: 'UNSUPPORTED', detail: 'Daily-driver rollback is not qualified.' }),
  'automated-git-closeout': Object.freeze({ status: 'UNSUPPORTED', detail: 'Human Git closeout remains authoritative.' }),
});

export function candidateCapability(name) {
  const capability = CANDIDATE_CAPABILITIES[name];
  if (!capability) throw new Error(`OCODE_CAPABILITY_UNKNOWN: ${name}`);
  return capability;
}

export function requireCandidateCapability(name) {
  const capability = candidateCapability(name);
  if (capability.status !== 'UNSUPPORTED') return capability;
  const error = new Error(`OCODE_CAPABILITY_UNAVAILABLE: capability: ${name}; candidate: daily-driver; ${capability.detail}`);
  error.code = 'OCODE_CAPABILITY_UNAVAILABLE';
  throw error;
}
