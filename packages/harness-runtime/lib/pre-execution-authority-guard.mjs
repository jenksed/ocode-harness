import { decideCommandAdmission } from './command-admission.mjs';

export const PRE_EXECUTION_GUARD_DECISIONS = Object.freeze({ CONTINUE: 'CONTINUE', DENY: 'DENY' });

const EFFECT_BY_GIT_SUBCOMMAND = Object.freeze({
  add: 'stage',
  'update-index': 'stage',
  commit: 'commit',
  merge: 'commit',
  rebase: 'commit',
  'cherry-pick': 'commit',
  tag: 'commit',
  push: 'push',
  checkout: 'repository.edit',
  restore: 'repository.edit',
  switch: 'repository.edit',
  rm: 'repository.edit',
  mv: 'repository.edit',
  config: 'repository.edit',
});
const OBSERVATION_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files']);
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);
const ENV_OPTIONS_WITH_VALUE = new Set(['-u', '--unset', '-S', '--split-string']);
const SHELL_INTERPRETER = /^(?:\S*\/)?(?:sh|bash|zsh)\s+-[^\n]*c\b/;

function normalized(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('OCODE_GUARD_COMMAND_INVALID');
  return command.trim().replace(/\s+/g, ' ');
}

function authorityRecord(authorityByRole, role) {
  if (!authorityByRole || typeof authorityByRole !== 'object' || typeof role !== 'string' || !role) return null;
  const authority = authorityByRole[role];
  if (!authority || typeof authority !== 'object') return null;
  for (const key of ['may_edit', 'may_stage', 'may_commit', 'may_push']) if (typeof authority[key] !== 'boolean') return null;
  return authority;
}

/** Parse only enough argv-shaped syntax to locate a Git subcommand. */
function gitInvocation(segment) {
  const tokens = segment.split(' ').filter(Boolean);
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) index += 1;
  if (/(?:^|\/)command$/.test(tokens[index] ?? '')) {
    index += 1;
    while ((tokens[index] ?? '').startsWith('-')) index += 1;
  }
  if (/(?:^|\/)env$/.test(tokens[index] ?? '')) {
    index += 1;
    while (index < tokens.length && (tokens[index].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))) {
      if (ENV_OPTIONS_WITH_VALUE.has(tokens[index])) index += 1;
      index += 1;
    }
  }
  if (!/(?:^|\/)git$/.test(tokens[index] ?? '')) {
    return /(?:^|\s)(?:\S*\/)?(?:env|command)\b/.test(segment) && /\bgit\b/.test(segment)
      ? { subcommand: '', args: [] }
      : null;
  }
  index += 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (GIT_OPTIONS_WITH_VALUE.has(token)) { index += 2; continue; }
    if (token.startsWith('-')) { index += 1; continue; }
    return { subcommand: token, args: tokens.slice(index + 1) };
  }
  return { subcommand: '', args: [] };
}

function isBranchObservation(args) {
  if (args.length === 0) return true;
  if (args.length === 1 && ['--show-current', '-a', '-r'].includes(args[0])) return true;
  return args[0] === '--list';
}

function isWorktreeObservation(args) {
  return args[0] === 'list' && args.slice(1).every((arg) => arg === '--porcelain');
}

function resolveInvocationEffect(invocation) {
  if (Object.hasOwn(EFFECT_BY_GIT_SUBCOMMAND, invocation.subcommand)) return EFFECT_BY_GIT_SUBCOMMAND[invocation.subcommand];
  if (OBSERVATION_SUBCOMMANDS.has(invocation.subcommand)) return null;
  if (invocation.subcommand === 'branch') return isBranchObservation(invocation.args) ? null : undefined;
  if (invocation.subcommand === 'worktree') return isWorktreeObservation(invocation.args) ? null : undefined;
  return undefined;
}

/**
 * Identify only constitutional Git effects. This is not a full shell parser:
 * Git-shaped syntax that cannot be classified is retained as suspicious and
 * denied instead of being passed through an approval fallback.
 */
export function resolvePreExecutionGuardTarget(command) {
  const value = normalized(command);
  if (SHELL_INTERPRETER.test(value)) return { command: value, effect: null, suspicious: true, reason: 'NESTED_SHELL_INTERPRETER' };
  const invocations = value.split(/(?:&&|\|\||;|\||\n)/).map((segment) => gitInvocation(segment.trim())).filter(Boolean);
  if (!invocations.length) return null;
  const resolved = invocations.map((invocation) => ({ invocation, effect: resolveInvocationEffect(invocation) }));
  const governed = resolved.find((entry) => entry.effect);
  if (governed) return { command: value, effect: governed.effect, suspicious: false, reason: `GOVERNED_GIT_${governed.invocation.subcommand.toUpperCase()}` };
  if (resolved.every((entry) => entry.effect === null)) return null;
  return { command: value, effect: null, suspicious: true, reason: 'UNCLASSIFIED_GIT_EFFECT' };
}

/** Deny-only decision: CONTINUE never means native execution is allowed. */
export function decidePreExecutionAuthority({ command, role = null, authorityByRole = null, capabilitiesByRole = null, validationRegistry = null, projectDir = null } = {}) {
  const authority = authorityRecord(authorityByRole, role);
  const semantic = authority
    ? decideCommandAdmission({ command, role, roleAuthority: authority, roleCapabilities: capabilitiesByRole?.[role] ?? [], validationRegistry, projectDir })
    : null;
  if (semantic?.decision === 'DENY') return { ...semantic, decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, code: semantic.code ?? 'OCODE_COMMAND_DENIED', effect: semantic.effect ?? (semantic.reason === 'UNCLASSIFIED_GIT_EFFECT' ? 'governed-git-unknown' : null), command: semantic.normalized ?? command };
  // The canonical model is authoritative for every ordinary command. Retain
  // the legacy Git parser below solely to preserve explicit diagnostic detail
  // for malformed Git wrappers until it can be removed with its old tests.
  if (semantic) return { decision: PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, effect: semantic.effect ?? null, role, reason: semantic.reason };
  let target;
  try { target = resolvePreExecutionGuardTarget(command); } catch (error) {
    return { decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, code: 'OCODE_ROLE_EFFECT_DENIED', effect: 'governed-git-unknown', role: role ?? 'UNKNOWN', owner: 'deterministic-runtime', action: 'ROUTE_TO_DETERMINISTIC_RUNTIME', reason: error.message };
  }
  if (!target) return { decision: PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, reason: 'OUTSIDE_GOVERNED_GIT_SCOPE' };
  if (!authority) return { decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, code: 'OCODE_ROLE_EFFECT_DENIED', effect: target.effect ?? 'governed-git-unknown', role: role ?? 'UNKNOWN', owner: 'deterministic-runtime', action: 'ROUTE_TO_DETERMINISTIC_RUNTIME', reason: 'ROLE_AUTHORITY_UNAVAILABLE', command: target.command };
  if (target.suspicious) return { decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, code: 'OCODE_ROLE_EFFECT_DENIED', effect: 'governed-git-unknown', role, owner: 'deterministic-runtime', action: 'ROUTE_TO_DETERMINISTIC_RUNTIME', reason: target.reason, command: target.command };
  const effectDecision = decideEffectAdmission({ effect: target.effect, role, authority });
  return effectDecision.decision === 'DENY'
    ? { ...effectDecision, decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, command: target.command, reason: target.reason }
    : { decision: PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, effect: target.effect, role, reason: 'ROLE_ALREADY_OWNS_EFFECT' };
}

/** A launch-time projection from parsed contracts, not a new authority table. */
export function createPreExecutionAuthorityGuardOptions({ contracts } = {}) {
  if (!(contracts instanceof Map)) throw new Error('contracts must be a Map');
  const authorityByRole = {}, capabilitiesByRole = {};
  for (const [role, contract] of contracts) { authorityByRole[role] = { ...contract.authority }; capabilitiesByRole[role] = [...(contract.capabilities?.provides ?? [])]; }
  return { authorityByRole, capabilitiesByRole };
}

export function formatPreExecutionAuthorityError(decision) {
  return [
    decision.code ?? 'OCODE_ROLE_EFFECT_DENIED',
    `role: ${decision.role ?? 'UNKNOWN'}`,
    `effect: ${decision.effect ?? 'governed-git-unknown'}`,
    `owner: ${decision.owner ?? 'deterministic-runtime'}`,
    `command: ${decision.command ?? 'unavailable'}`,
    `action: ${decision.action ?? 'ROUTE_TO_DETERMINISTIC_RUNTIME'}`,
  ].join('\n');
}
