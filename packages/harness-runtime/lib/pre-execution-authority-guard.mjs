import { decideEffectAdmission } from './command-admission.mjs';

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
const NON_MUTATING_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'worktree', 'branch', 'ls-files']);

const SHELL_INTERPRETER = /^(?:\S*\/)?(?:sh|bash|zsh)\s+-[^\n]*c\b/;
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);
const ENV_OPTIONS_WITH_VALUE = new Set(['-u', '--unset', '-S', '--split-string']);

function normalized(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('OCODE_GUARD_COMMAND_INVALID');
  return command.trim().replace(/\s+/g, ' ');
}

function authorityRecord(authorityByRole, role) {
  if (!authorityByRole || typeof authorityByRole !== 'object' || !role || typeof role !== 'string') return null;
  const authority = authorityByRole[role];
  if (!authority || typeof authority !== 'object') return null;
  for (const key of ['may_edit', 'may_stage', 'may_commit', 'may_push']) {
    if (typeof authority[key] !== 'boolean') return null;
  }
  return authority;
}

function gitSubcommand(command) {
  const tokens = command.split(' ').filter(Boolean);
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
    // An `env` or `command` prefix containing a Git-shaped string could hide
    // execution behind an option such as `env -S`; let the caller fail closed.
    return /(?:^|\s)(?:\S*\/)?(?:env|command)\b/.test(command) && /\bgit\b/.test(command) ? '' : null;
  }
  index += 1;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (GIT_OPTIONS_WITH_VALUE.has(token)) { index += 1; continue; }
    if (token.startsWith('-')) continue;
    return token;
  }
  return '';
}

/**
 * Identify only governed Git effects. This is intentionally not a general
 * shell parser: an invocation that looks like Git but cannot be resolved is
 * marked suspicious so it cannot use native approval to bypass authority.
 */
export function resolvePreExecutionGuardTarget(command) {
  const value = normalized(command);
  // Splitting only identifies a possible command boundary; it deliberately
  // does not claim to parse quoted shell grammar. Any nested interpreter is
  // handled below as a fail-closed form.
  const subcommands = value.split(/(?:&&|\|\||;|\||\n)/).map((segment) => gitSubcommand(segment.trim()));
  const subcommand = subcommands.find((candidate) => candidate && EFFECT_BY_GIT_SUBCOMMAND[candidate]) ?? subcommands.find((candidate) => candidate !== null);
  const effect = subcommand ? EFFECT_BY_GIT_SUBCOMMAND[subcommand] : null;
  if (effect) return { command: value, effect, suspicious: false, reason: `GOVERNED_GIT_${subcommand.toUpperCase()}` };
  if (subcommand && NON_MUTATING_GIT_SUBCOMMANDS.has(subcommand)) return null;
  if (SHELL_INTERPRETER.test(value)) return { command: value, effect: null, suspicious: true, reason: 'NESTED_SHELL_INTERPRETER' };
  if (subcommands.some((candidate) => candidate !== null)) {
    return {
      command: value,
      effect: null,
      suspicious: true,
      reason: subcommand ? 'UNCLASSIFIED_GIT_EFFECT' : 'UNPARSED_GIT_SHAPE',
    };
  }
  return null;
}

/**
 * The guard decides only whether a Bash request may proceed to OpenCode's
 * native permission machinery. It never returns ALLOW or ASK and therefore
 * cannot grant authority.
 */
export function decidePreExecutionAuthority({ command, role = null, authorityByRole = null } = {}) {
  let target;
  try {
    target = resolvePreExecutionGuardTarget(command);
  } catch (error) {
    // A malformed Bash input cannot be a useful ordinary command. Keep the
    // error distinct for observability while refusing to let it hide Git.
    return { decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, code: 'OCODE_ROLE_EFFECT_DENIED', effect: 'governed-git-unknown', role, owner: 'deterministic-runtime', action: 'ROUTE_TO_DETERMINISTIC_RUNTIME', reason: error.message };
  }
  if (!target) return { decision: PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, reason: 'OUTSIDE_GOVERNED_GIT_SCOPE' };
  const authority = authorityRecord(authorityByRole, role);
  if (!authority) {
    return {
      decision: PRE_EXECUTION_GUARD_DECISIONS.DENY,
      code: 'OCODE_ROLE_EFFECT_DENIED',
      effect: target.effect ?? 'governed-git-unknown',
      role: role ?? 'UNKNOWN',
      owner: 'deterministic-runtime',
      action: 'ROUTE_TO_DETERMINISTIC_RUNTIME',
      reason: 'ROLE_AUTHORITY_UNAVAILABLE',
      command: target.command,
    };
  }
  if (target.suspicious) {
    return {
      decision: PRE_EXECUTION_GUARD_DECISIONS.DENY,
      code: 'OCODE_ROLE_EFFECT_DENIED',
      effect: 'governed-git-unknown',
      role,
      owner: 'deterministic-runtime',
      action: 'ROUTE_TO_DETERMINISTIC_RUNTIME',
      reason: target.reason,
      command: target.command,
    };
  }
  const effectDecision = decideEffectAdmission({ effect: target.effect, role, authority });
  return effectDecision.decision === 'DENY'
    ? { ...effectDecision, decision: PRE_EXECUTION_GUARD_DECISIONS.DENY, command: target.command, reason: target.reason }
    : { decision: PRE_EXECUTION_GUARD_DECISIONS.CONTINUE, effect: target.effect, role, reason: 'ROLE_ALREADY_OWNS_EFFECT' };
}

/** Create the immutable runtime projection directly from parsed contracts. */
export function createPreExecutionAuthorityGuardOptions({ contracts } = {}) {
  if (!(contracts instanceof Map)) throw new Error('contracts must be a Map');
  const authorityByRole = {};
  for (const [role, contract] of contracts) authorityByRole[role] = { ...contract.authority };
  return { authorityByRole };
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
