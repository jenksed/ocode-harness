import { statSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import {
  VALIDATION_REGISTRY_SCHEMA_VERSION,
  createValidationRegistry,
  evaluateValidationRegistryFreshness,
  validateValidationRegistry,
} from './validation-registry.mjs';
import { runtimeResourcePath } from './runtime-paths.mjs';

export { createValidationRegistry, evaluateValidationRegistryFreshness, validateValidationRegistry } from './validation-registry.mjs';

export const COMMAND_ADMISSION_SCHEMA_VERSION = VALIDATION_REGISTRY_SCHEMA_VERSION;
export const COMMAND_RISK_CLASSES = Object.freeze({
  OBSERVE: 'OBSERVE', VALIDATE: 'VALIDATE', WORKSPACE_EFFECT: 'WORKSPACE_EFFECT',
  REPOSITORY_EFFECT: 'REPOSITORY_EFFECT', REMOTE_EFFECT: 'REMOTE_EFFECT',
  DESTRUCTIVE: 'DESTRUCTIVE', UNKNOWN: 'UNKNOWN',
});
export const COMMAND_DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', DENY: 'DENY' });

const OBSERVE = new Set(['pwd', 'ls', 'rg', 'grep', 'head', 'tail', 'wc', 'file', 'stat', 'which', 'command -v']);
const DESTRUCTIVE = /^(?:rm\s+-[^\n]*r|git\s+(?:reset\s+--hard|clean\b)|find\b.*\s-delete\b)/;
const REMOTE = /^(?:git\s+push\b|git\s+fetch\b|git\s+pull\b|curl\b|wget\b|ssh\b|scp\b)/;
const WORKSPACE = /^(?:mkdir|touch|cp|mv|sed\s+-i|perl\s+-i|npm\s+(?:install|ci)|pnpm\s+(?:install|add)|yarn\s+(?:add|install))\b/;
const SHELL_COMPOSITION = /[\n\r;&|><`$\\]|\$\(|\)\s*\(/;
const OBSERVATION_SHAPED_MUTATION = /^(?:git\s+(?:show|diff|log)\b.*(?:--output(?:=|\s)|-o\s)|find\b.*\s-(?:delete|exec|execdir|ok|okdir)\b|tree\b.*\s(?:-o\s|--output(?:=|\s)))/;
const NATIVE_STRUCTURAL_DENIES = Object.freeze({
  '*>*': 'deny',
  '*<*': 'deny',
  'git push': 'deny',
  'git push *': 'deny',
  'git reset --hard': 'deny',
  'git reset --hard *': 'deny',
  'git clean': 'deny',
  'git clean *': 'deny',
  'git add': 'deny',
  'git add *': 'deny',
  'git commit': 'deny',
  'git commit *': 'deny',
  'rm -rf *': 'deny',
});

const OBSERVATION_PATTERNS = new Set([
  // Native Bash ALLOW is deliberately narrower than semantic observation.
  // Commands with command-native output/action options stay outside wildcard
  // admission and receive the native policy's normal routing instead.
  'ls', 'ls *', 'pwd', 'rg', 'rg *', 'grep', 'grep *', 'find', 'find *',
  'head', 'head *', 'tail', 'tail *', 'wc', 'wc *', 'file', 'file *',
  'stat', 'stat *', 'tree', 'tree *', 'which', 'which *', 'command -v', 'command -v *',
  'git status', 'git status *',
  'git diff', 'git log', 'git show',
  'git rev-parse', 'git rev-parse *', 'git worktree list', 'git worktree list *',
  'git merge-base', 'git merge-base *', 'git rev-list', 'git rev-list *', 'git ls-tree', 'git ls-tree *',
  'git cat-file', 'git cat-file *', 'git show-ref', 'git show-ref *', 'git ls-files', 'git ls-files *',
  'git grep', 'git grep *', 'git blame', 'git blame *', 'git remote -v', 'git tag --list', 'git tag --list *',
  'git config --get', 'git config --get *',
  'git branch --show-current', 'git branch --list', 'git branch --list *',
  'git branch -a', 'git branch -r',
]);

function ensureObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function ensureString(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function normalizedCommand(command) { return ensureString(command, 'command').trim().replace(/\s+/g, ' '); }

function gitSubcommand(command) {
  const tokens = command.split(' '); const index = tokens.findIndex((token) => /(?:^|\/)git$/.test(token));
  if (index < 0) return null;
  const valueOptions = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);
  for (let i = index + 1; i < tokens.length; i += 1) {
    if (valueOptions.has(tokens[i])) { i += 1; continue; }
    if (!tokens[i].startsWith('-')) return { subcommand: tokens[i], args: tokens.slice(i + 1) };
  }
  return { subcommand: '', args: [] };
}

function gitClassification(normalized) {
  const invocation = gitSubcommand(normalized); if (!invocation) return null;
  const { subcommand, args } = invocation;
  const safe = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'merge-base', 'rev-list', 'ls-tree', 'cat-file', 'show-ref', 'ls-files', 'grep', 'blame']);
  if (safe.has(subcommand) && !args.some((arg) => arg === '-o' || arg.startsWith('--output'))) return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: `GIT_OBSERVE:${subcommand}` };
  if (subcommand === 'remote' && args[0] === '-v') return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'GIT_OBSERVE:remote-v' };
  if (subcommand === 'tag' && args[0] === '--list') return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'GIT_OBSERVE:tag-list' };
  if (subcommand === 'config' && args[0] === '--get') return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'GIT_OBSERVE:config-get' };
  if (subcommand === 'branch' && (args.length === 0 || ['--show-current', '--list', '-a', '-r'].includes(args[0]))) return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'GIT_OBSERVE:branch' };
  if (subcommand === 'worktree' && args[0] === 'list') return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'GIT_OBSERVE:worktree-list' };
  const effect = { add: 'stage', 'update-index': 'stage', commit: 'commit', merge: 'commit', rebase: 'commit', 'cherry-pick': 'commit', tag: 'commit', push: 'push', checkout: 'repository.edit', restore: 'repository.edit', switch: 'repository.edit', rm: 'repository.edit', mv: 'repository.edit', config: 'repository.edit', remote: 'repository.edit' }[subcommand];
  return effect ? { risk_class: effect === 'push' ? COMMAND_RISK_CLASSES.REMOTE_EFFECT : COMMAND_RISK_CLASSES.REPOSITORY_EFFECT, normalized, git_effect: subcommand, effect, reason: `GIT_EFFECT:${subcommand}` } : { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'UNCLASSIFIED_GIT_EFFECT' };
}

/**
 * A conservative lexical classifier. It deliberately rejects shell composition
 * rather than pretending OpenCode's unqualified prefix matcher parsed argv.
 */
export function classifyCommand(command, { validationRegistry = null } = {}) {
  const normalized = normalizedCommand(command);
  if (SHELL_COMPOSITION.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'SHELL_COMPOSITION_OR_EXPANSION' };
  if (validationRegistry?.commands?.includes(normalized)) return { risk_class: COMMAND_RISK_CLASSES.VALIDATE, normalized, reason: 'EXACT_VALIDATION_REGISTRY_MEMBER' };
  if (OBSERVATION_SHAPED_MUTATION.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.WORKSPACE_EFFECT, normalized, reason: 'OBSERVATION_SHAPED_MUTATION_PATTERN' };
  const git = gitClassification(normalized); if (git) return git;
  if (DESTRUCTIVE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.DESTRUCTIVE, normalized, reason: 'STRUCTURAL_DESTRUCTIVE_PATTERN' };
  if (REMOTE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.REMOTE_EFFECT, normalized, reason: 'REMOTE_OR_NETWORK_PATTERN' };
  if (/^find\b/.test(normalized)) return /\s-(?:delete|exec|execdir|ok|okdir)\b/.test(normalized) ? { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'FIND_EXECUTION_OR_MUTATION' } : { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'FIND_OBSERVATION' };
  if (/^tree\b/.test(normalized)) return /(?:\s-o\s|--output(?:=|\s))/.test(normalized) ? { risk_class: COMMAND_RISK_CLASSES.WORKSPACE_EFFECT, normalized, reason: 'TREE_OUTPUT_MUTATION' } : { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: 'TREE_OBSERVATION' };
  if (WORKSPACE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.WORKSPACE_EFFECT, normalized, reason: 'WORKSPACE_MUTATION_PATTERN' };
  const firstTwo = normalized.split(' ').slice(0, 2).join(' ');
  const commandFamily = OBSERVE.has(normalized) ? normalized : OBSERVE.has(firstTwo) ? firstTwo : OBSERVE.has(normalized.split(' ')[0]) ? normalized.split(' ')[0] : null;
  if (commandFamily) return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: `OBSERVE_FAMILY:${commandFamily}` };
  return { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'UNRECOGNIZED_COMMAND' };
}

/**
 * Project the already-governed role policy into OpenCode's observed last-match
 * rule order. Repository-defined validation is added only for test.execute
 * roles; structural denials are always appended last so broad observation
 * patterns cannot authorize redirection or a remote/destructive effect.
 */
export function createNativeBashPermissionRules({ baseRules = {}, validationRegistry = null, roleCapabilities = [], roleAuthority = null } = {}) {
  ensureObject(baseRules, 'baseRules');
  /**
   * OpenCode 1.18.21 chooses the last matching Bash key. Delete before setting
   * so this builder never relies on JavaScript assignment preserving an old
   * object's insertion position.
   */
  const rules = {};
  const append = (pattern, action) => {
    if (Object.hasOwn(rules, pattern)) delete rules[pattern];
    rules[pattern] = action;
  };
  for (const [pattern, action] of Object.entries(baseRules)) {
    if (typeof pattern !== 'string' || !pattern || !['allow', 'ask', 'deny'].includes(action)) throw new Error('baseRules contains an invalid native permission rule');
  }
  // A role missing any governed Git closeout authority receives a native
  // catch-all denial. This remains intentionally fail-closed until native
  // matching of executable/environment-prefixed Git forms is qualified;
  // otherwise an ASK could manufacture a missing stage/commit/push grant.
  const restricted = roleAuthority?.may_edit !== true;
  const unadmitted = restricted || baseRules['*'] === 'deny' ? 'deny' : 'ask';

  // 1. Baseline catch-all. Restricted roles must never convert an unknown
  // mutation into an operator-granted authority escalation.
  append('*', restricted ? 'deny' : (baseRules['*'] ?? 'ask'));

  // 2. Close Git broadly before restoring the narrow observation surface. This
  // position is intentional: a later observation allowance must win under
  // OpenCode's actual last-match semantics, while unknown Git remains denied.
  append('git *', 'deny');

  // 3. Explicit safe observations, in contract order.
  for (const pattern of OBSERVATION_PATTERNS) append(pattern, baseRules[pattern] ?? 'allow');
  // Precision lives in the canonical guard; these patterns only let a bounded
  // coder-owned workspace request reach OpenCode's native consent UI.
  if (roleAuthority?.may_edit === true) {
    for (const pattern of ['touch *', 'mkdir *', 'cp *', 'mv *', 'sed -i *', 'perl -i *', 'git checkout *', 'git restore *', 'git switch *', 'git rm *', 'git mv *', 'git config *', 'git remote add *']) append(pattern, 'ask');
  }

  // 4. Repository-admitted validation only for test.execute roles.
  if (validationRegistry && roleCapabilities.includes('test.execute')) {
    const registry = validateValidationRegistry(validationRegistry);
    for (const command of registry.commands) append(command, 'allow');
  } else {
    for (const pattern of Object.keys(baseRules)) {
      if (/^(?:npm|pnpm|yarn|pytest|python|go|mix|cargo)(?:\s|$)/.test(pattern)) append(pattern, unadmitted);
    }
  }

  // 5. Specific remote/destructive denials, then composition denials last.
  // The final placement prevents an observation wildcard from allowing writes.
  for (const [pattern, action] of Object.entries(NATIVE_STRUCTURAL_DENIES)) append(pattern, action);
  append('*>*', 'deny'); append('*<*', 'deny');
  return rules;
}

/**
 * Availability is intentionally a runtime observation, distinct from the
 * repository-derived registry. A missing optional toolchain narrows only the
 * effective zero-prompt surface; it never erases what the repository declared.
 */
export function resolveValidationAvailability({ registry, environment = process.env } = {}) {
  const normalized = validateValidationRegistry(registry);
  const executables = {};
  const unavailable = [];
  const resolved = new Map();
  for (const executable of [...new Set(normalized.commands.map((command) => command.split(' ')[0]))].sort()) {
    const path = (environment.PATH ?? '').split(delimiter)
      .filter((directory) => isAbsolute(directory))
      .map((directory) => resolve(directory, executable))
      .find((candidate) => {
        try { return statSync(candidate).isFile() && (statSync(candidate).mode & 0o111) !== 0; } catch { return false; }
      });
    if (path) resolved.set(executable, path);
  }
  const available_commands = [];
  for (const command of normalized.commands) {
    const executable = command.split(' ')[0];
    const path = resolved.get(executable);
    if (path) {
      available_commands.push(command);
      executables[executable] = path;
    } else {
      unavailable.push({ command, executable, reason: 'OCODE_VALIDATION_EXECUTABLE_UNAVAILABLE' });
    }
  }
  return { available_commands, unavailable_commands: unavailable, executables };
}

export function createRuntimePermissionProjection({ contracts, projectDir, environment = process.env } = {}) {
  if (!(contracts instanceof Map)) throw new Error('contracts must be a Map');
  let candidate = null;
  try { candidate = createValidationRegistry({ projectDir }); } catch { candidate = null; }
  const availability = candidate ? resolveValidationAvailability({ registry: candidate, environment }) : { available_commands: [], unavailable_commands: [], executables: {} };
  // Recreate the registry with only executable-backed commands. It retains the
  // original providers/governing files and therefore the same freshness scope.
  const validationRegistry = availability.available_commands.length
    ? createValidationRegistry({ projectDir, commands: availability.available_commands })
    : null;
  const agents = {};
  for (const [role, contract] of contracts) {
    agents[role] = {
      permission: {
        bash: createNativeBashPermissionRules({
          baseRules: contract.permissions?.bash ?? {},
          validationRegistry,
          roleCapabilities: contract.capabilities?.provides ?? [],
          roleAuthority: contract.authority,
        }),
      },
    };
  }
  return {
    agents,
    discovered_validation_registry: candidate,
    validation_registry: validationRegistry,
    validation_availability: availability,
    validation_executables: availability.executables,
  };
}

export function createValidationWrapperEnvironment({ projectDir, registry, environment = process.env, executables = {} } = {}) {
  if (!registry) return { ...environment };
  validateValidationRegistry(registry);
  const wrapperDir = runtimeResourcePath('bin', 'validation');
  return {
    ...environment,
    PATH: `${wrapperDir}${delimiter}${environment.PATH ?? ''}`,
    OCODE_VALIDATION_EXECUTABLES: JSON.stringify(executables),
    OCODE_VALIDATION_ORIGINAL_PATH: environment.PATH ?? '',
    OCODE_VALIDATION_PROJECT: resolve(projectDir),
    OCODE_VALIDATION_REGISTRY: JSON.stringify(registry),
  };
}

/** Resolve only executables named by the current exact-command registry before
 * the validation wrapper is placed on PATH. This prevents a repository-local
 * basename shadow from becoming the tool that an admitted command executes. */
export function resolveValidationExecutables({ registry, environment = process.env } = {}) {
  return resolveValidationAvailability({ registry, environment }).executables;
}

export function decideCommandAdmission({ command, role, roleCapabilities = [], roleAuthority = null, validationRegistry = null, projectDir = null } = {}) {
  ensureString(role, 'role');
  const classified = classifyCommand(command, { validationRegistry });
  const provenance = { classifier: 'OCODE_COMMAND_ADMISSION_V1', role, risk_class: classified.risk_class, reason: classified.reason };
  if (classified.risk_class === COMMAND_RISK_CLASSES.DESTRUCTIVE || classified.risk_class === COMMAND_RISK_CLASSES.REMOTE_EFFECT) return { decision: COMMAND_DECISIONS.DENY, effect: classified.effect ?? null, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.REPOSITORY_EFFECT) {
    if (classified.effect && roleAuthority) {
      const effectDecision = decideEffectAdmission({ effect: classified.effect, role, authority: roleAuthority });
      return effectDecision.decision === COMMAND_DECISIONS.DENY ? { ...effectDecision, ...provenance } : { decision: COMMAND_DECISIONS.ASK, effect: classified.effect, role, reason: 'MODELED_EFFECT_REQUIRES_OPERATOR_CONSENT', ...provenance };
    }
    return { decision: COMMAND_DECISIONS.ASK, ...provenance };
  }
  // An exact registry match is a repository-defined validation operation, not
  // an unclassified workspace mutation. This must precede the read-only-role
  // unknown-command fail-close path so verifier/reviewer test.execute remains
  // usable without granting any broader Bash authority.
  if (classified.risk_class === COMMAND_RISK_CLASSES.VALIDATE && roleCapabilities.includes('test.execute')) {
    const freshness = projectDir ? evaluateValidationRegistryFreshness(validationRegistry, { projectDir }) : { status: 'CURRENT' };
    return freshness.status === 'CURRENT'
      ? { decision: COMMAND_DECISIONS.ALLOW, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status }
      : { decision: COMMAND_DECISIONS.DENY, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status, reason: 'STALE_VALIDATION_REGISTRY' };
  }
  if (classified.risk_class === COMMAND_RISK_CLASSES.VALIDATE) return { decision: COMMAND_DECISIONS.DENY, ...provenance, reason: 'VALIDATION_CAPABILITY_MISSING' };
  if (classified.risk_class === COMMAND_RISK_CLASSES.WORKSPACE_EFFECT) {
    const effectDecision = decideEffectAdmission({ effect: 'repository.edit', role, authority: roleAuthority });
    return effectDecision.decision === COMMAND_DECISIONS.DENY ? { ...effectDecision, ...provenance } : { decision: COMMAND_DECISIONS.ASK, effect: 'repository.edit', role, reason: 'MODELED_EFFECT_REQUIRES_OPERATOR_CONSENT', ...provenance };
  }
  if (classified.risk_class === COMMAND_RISK_CLASSES.OBSERVE) return { decision: COMMAND_DECISIONS.ALLOW, ...provenance };
  return { decision: COMMAND_DECISIONS.DENY, ...provenance };
}

/** Resolve an intended effect before selecting a tool. Permission cannot grant
 * constitutional authority; denied effects identify their admitted owner. */
export function decideEffectAdmission({ effect, role, authority = {}, owner = null } = {}) {
  ensureString(effect, 'effect');
  ensureString(role, 'role');
  authority = authority ?? {};
  const authorityByEffect = { 'repository.edit': 'may_edit', stage: 'may_stage', commit: 'may_commit', push: 'may_push' };
  const field = authorityByEffect[effect];
  if (!field) return { decision: COMMAND_DECISIONS.ASK, effect, role, reason: 'EFFECT_NOT_CLASSIFIED' };
  if (authority[field] === true) return { decision: COMMAND_DECISIONS.ALLOW, effect, role, reason: 'ROLE_AUTHORITY_GRANTED' };
  return {
    decision: COMMAND_DECISIONS.DENY,
    code: 'OCODE_ROLE_EFFECT_DENIED',
    effect,
    role,
    owner: owner || (effect === 'repository.edit' ? 'coder' : 'deterministic-runtime'),
    action: effect === 'repository.edit' ? 'DELEGATE_TO_AUTHORIZED_OWNER' : 'ROUTE_TO_DETERMINISTIC_RUNTIME',
    reason: 'ROLE_CONSTITUTIONAL_AUTHORITY_MISSING',
  };
}
