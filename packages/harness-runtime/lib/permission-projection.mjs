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

/**
 * The bounded Bash-pattern subset Ocode qualifies against OpenCode 1.18.21.
 * This is intentionally not a shell parser or a general glob implementation.
 */
export function matchesOpenCodeBashPattern(pattern, command) {
  if (pattern === '*') return true;
  if (pattern === '*>*') return command.includes('>');
  if (pattern === '*<*') return command.includes('<');
  // OpenCode does not let the qualified trailing-space command wildcard cross
  // a shell-composition boundary. Redirection is deliberately not included:
  // native qualification shows it can match the wildcard, so the explicit
  // final redirection denial remains required and decisive.
  if (pattern.endsWith(' *')) {
    if (/(?:&&|\|\||(?<!\|)\|(?!\|)|;|\$\(|`)/.test(command)) return false;
    return command.startsWith(pattern.slice(0, -1));
  }
  return pattern === command;
}

/**
 * Models the effective native OpenCode 1.18.21 selection rule for Ocode's
 * qualified Bash-pattern subset: rules are evaluated in insertion order and
 * the last matching rule wins. Keep risk classification separate; this helper
 * reports the actual native permission result, not a safer approximation.
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
    .filter(([pattern]) => matchesOpenCodeBashPattern(pattern, command));
  if (matches.length === 0) {
    return {
      state: PERMISSION_PROJECTION_STATES.UNKNOWN,
      source: 'opencode.bash',
      evidence: [`no recognized bash pattern matched ${command}`],
    };
  }
  const decisive = matches.at(-1);
  return {
    state: normalizePermission(decisive[1]),
    source: 'opencode.bash',
    evidence: matches.map(([pattern, value], index) => `${index === matches.length - 1 ? 'effective ' : ''}${pattern}=${value}`),
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
