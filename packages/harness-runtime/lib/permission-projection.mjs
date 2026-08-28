export const PERMISSION_PROJECTION_SCHEMA_VERSION = 2;

export const PERMISSION_OPERATIONS = Object.freeze([
  'edit',
  'test',
  'stage',
  'commit',
  'push',
  'web',
]);

export const PERMISSION_PROJECTION_STATES = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  ASK: 'ASK',
  UNKNOWN: 'UNKNOWN',
  NOT_PROJECTED: 'NOT_PROJECTED',
});

const COMMAND_BY_OPERATION = Object.freeze({
  test: 'npm test',
  stage: 'git add .',
  commit: 'git commit -m ocode',
  push: 'git push origin main',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePermission(value) {
  if (value === 'allow') return PERMISSION_PROJECTION_STATES.ALLOW;
  if (value === 'ask') return PERMISSION_PROJECTION_STATES.ASK;
  if (value === 'deny') return PERMISSION_PROJECTION_STATES.DENY;
  return PERMISSION_PROJECTION_STATES.UNKNOWN;
}

function commandPatternMatches(pattern, command) {
  if (pattern === '*') return true;
  if (pattern === '*>*') return command.includes('>');
  if (pattern === '*<*') return command.includes('<');
  if (pattern.endsWith(' *')) return command.startsWith(pattern.slice(0, -1));
  return pattern === command;
}

function commandPatternSpecificity(pattern) {
  return pattern === '*' ? 0 : pattern.endsWith(' *') ? pattern.length - 2 : pattern.length + 1;
}

/**
 * Applies only the OpenCode command forms represented by current Ocode role
 * contracts: catch-all, exact command, and a trailing-space wildcard. The
 * longest matching pattern wins; an equal-specificity conflict fails closed.
 */
export function projectBashCommand(permission, command) {
  if (typeof permission === 'string') {
    return {
      state: normalizePermission(permission),
      source: 'opencode.bash.scalar',
      evidence: [`bash=${permission}`],
    };
  }
  if (!isPlainObject(permission)) {
    return {
      state: PERMISSION_PROJECTION_STATES.UNKNOWN,
      source: 'opencode.bash',
      evidence: ['bash permission absent or unsupported'],
    };
  }
  const matches = Object.entries(permission)
    .filter(([pattern]) => commandPatternMatches(pattern, command))
    .map(([pattern, value]) => ({ pattern, value, specificity: commandPatternSpecificity(pattern) }))
    .sort((left, right) => right.specificity - left.specificity || left.pattern.localeCompare(right.pattern));
  if (matches.length === 0) {
    return {
      state: PERMISSION_PROJECTION_STATES.UNKNOWN,
      source: 'opencode.bash',
      evidence: [`no recognized bash pattern matched ${command}`],
    };
  }
  const highestSpecificity = matches[0].specificity;
  const decisive = matches.filter(({ specificity }) => specificity === highestSpecificity);
  const states = [...new Set(decisive.map(({ value }) => normalizePermission(value)))];
  return {
    state: states.length === 1 ? states[0] : PERMISSION_PROJECTION_STATES.UNKNOWN,
    source: 'opencode.bash',
    evidence: decisive.map(({ pattern, value }) => `${pattern}=${value}`),
  };
}

function projectDirectPermission(permissions, operation, key) {
  const value = permissions?.[key];
  return {
    operation,
    state: normalizePermission(value),
    source: `opencode.${key}`,
    evidence: [value === undefined ? `${key}=absent` : `${key}=${value}`],
  };
}

function projectWebPermission(permissions) {
  const websearch = normalizePermission(permissions?.websearch);
  const webfetch = normalizePermission(permissions?.webfetch);
  const states = [websearch, webfetch];
  const state = states.every((value) => value === PERMISSION_PROJECTION_STATES.ALLOW)
    ? PERMISSION_PROJECTION_STATES.ALLOW
    : states.includes(PERMISSION_PROJECTION_STATES.DENY)
      ? PERMISSION_PROJECTION_STATES.DENY
      : PERMISSION_PROJECTION_STATES.UNKNOWN;
  return {
    operation: 'web',
    state,
    source: 'opencode.websearch+webfetch',
    evidence: [
      `websearch=${permissions?.websearch ?? 'absent'}`,
      `webfetch=${permissions?.webfetch ?? 'absent'}`,
    ],
  };
}

export function projectPermissions(permissions = {}) {
  if (!isPlainObject(permissions)) throw new Error('OpenCode permissions must be an object');
  const operations = {
    edit: projectDirectPermission(permissions, 'edit', 'edit'),
    web: projectWebPermission(permissions),
  };
  for (const [operation, command] of Object.entries(COMMAND_BY_OPERATION)) {
    operations[operation] = {
      operation,
      ...projectBashCommand(permissions.bash, command),
    };
  }
  return {
    schema_version: PERMISSION_PROJECTION_SCHEMA_VERSION,
    operations: Object.fromEntries(PERMISSION_OPERATIONS.map((operation) => [operation, operations[operation]])),
    not_projected: {
      // A catch-all does not establish structured authority for arbitrary shell
      // execution. It stays fail-closed even after matcher characterization.
      command_execute: PERMISSION_PROJECTION_STATES.NOT_PROJECTED,
    },
  };
}
