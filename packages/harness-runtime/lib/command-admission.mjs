import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const COMMAND_ADMISSION_SCHEMA_VERSION = 1;
export const COMMAND_RISK_CLASSES = Object.freeze({
  OBSERVE: 'OBSERVE', VALIDATE: 'VALIDATE', WORKSPACE_EFFECT: 'WORKSPACE_EFFECT',
  REPOSITORY_EFFECT: 'REPOSITORY_EFFECT', REMOTE_EFFECT: 'REMOTE_EFFECT',
  AUTHORITY_REF_PREFLIGHT: 'AUTHORITY_REF_PREFLIGHT', DESTRUCTIVE: 'DESTRUCTIVE', UNKNOWN: 'UNKNOWN',
});
export const COMMAND_DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', DENY: 'DENY' });

const OBSERVE = new Set([
  'pwd', 'ls', 'rg', 'grep', 'find', 'head', 'tail', 'wc', 'file', 'stat', 'tree', 'which', 'command -v',
  'git status', 'git diff', 'git log', 'git show', 'git rev-parse', 'git worktree list', 'git branch --show-current', 'git branch --list',
]);
const DESTRUCTIVE = /^(?:rm\s+-[^\n]*r|git\s+(?:reset\s+--hard|clean\b)|find\b.*\s-delete\b)/;
const REMOTE = /^(?:git\s+push\b|git\s+fetch\b|git\s+pull\b|curl\b|wget\b|ssh\b|scp\b)/;
const AUTHORITY_REF_PREFLIGHT = /^git\s+fetch\s+--no-tags\b/;
const REPOSITORY = /^(?:git\s+(?:add|commit|merge|rebase|checkout|switch|restore|cherry-pick)\b)/;
const WORKSPACE = /^(?:mkdir|touch|cp|mv|sed\s+-i|perl\s+-i|npm\s+(?:install|ci)|pnpm\s+(?:install|add)|yarn\s+(?:add|install))\b/;
const SHELL_COMPOSITION = /[\n\r;&|><`$\\]|\$\(|\)\s*\(/;
const OBSERVATION_SHAPED_MUTATION = /^(?:git\s+(?:show|diff|log)\b.*(?:--output(?:=|\s)|-o\s)|find\b.*\s-(?:delete|exec|execdir|ok|okdir)\b|tree\b.*\s(?:-o\s|--output(?:=|\s)))/;
const NATIVE_AUTHORITY_DENIES = Object.freeze({
  'git push': 'deny',
  'git push *': 'deny',
  'git add': 'deny',
  'git add *': 'deny',
  'git commit': 'deny',
  'git commit *': 'deny',
});

// Destructive operations remain effectful, but the operator may approve one
// exact invocation through OpenCode's native permission UI. These rules grant
// no enduring role authority and composition/redirection still remains denied.
const NATIVE_DESTRUCTIVE_ASKS = Object.freeze({
  'git reset --hard': 'ask',
  'git reset --hard *': 'ask',
  'git clean': 'ask',
  'git clean *': 'ask',
  'rm -rf *': 'ask',
  // The qualified OpenCode matcher supports only trailing command wildcards;
  // it cannot distinguish `find` predicates safely. Any argument-bearing
  // find invocation is therefore approval-gated, while bare `find` remains a
  // local observation.
  'find *': 'ask',
});

const OBSERVATION_PATTERNS = new Set([
  // Native Bash ALLOW is deliberately narrower than semantic observation.
  // Commands with command-native output/action options stay outside wildcard
  // admission and receive the native policy's normal routing instead.
  'ls', 'ls *', 'pwd', 'rg', 'rg *', 'grep', 'grep *', 'find',
  'head', 'head *', 'tail', 'tail *', 'wc', 'wc *', 'file', 'file *',
  'stat', 'stat *', 'tree', 'which', 'which *', 'command -v', 'command -v *',
  'git status', 'git status *',
  'git diff', 'git log', 'git show',
  'git rev-parse', 'git rev-parse *', 'git worktree list', 'git worktree list *',
  'git branch --show-current', 'git branch --list', 'git branch --list *',
  'git branch -a', 'git branch -r',
]);

function ensureObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function ensureString(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function normalizedCommand(command) { return ensureString(command, 'command').trim().replace(/\s+/g, ' '); }

function gitEffect(command) {
  const match = command.match(/(?:^|\s)(?:\S*\/)?git\s+(?:(?:-[A-Za-z-]+(?:\s+|=)[^\s]+)\s+)*(add|commit|push|merge|rebase|cherry-pick|checkout|restore|switch|update-index|tag|rm|mv|config)\b/);
  return match?.[1] ?? null;
}

/**
 * A conservative lexical classifier. It deliberately rejects shell composition
 * rather than pretending OpenCode's unqualified prefix matcher parsed argv.
 */
export function classifyCommand(command) {
  const normalized = normalizedCommand(command);
  if (SHELL_COMPOSITION.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'SHELL_COMPOSITION_OR_EXPANSION' };
  if (DESTRUCTIVE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.DESTRUCTIVE, normalized, reason: 'DESTRUCTIVE_APPROVAL_REQUIRED' };
  if (OBSERVATION_SHAPED_MUTATION.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.WORKSPACE_EFFECT, normalized, reason: 'OBSERVATION_SHAPED_MUTATION_PATTERN' };
  const effect = gitEffect(normalized);
  if (effect === 'push') return { risk_class: COMMAND_RISK_CLASSES.REMOTE_EFFECT, normalized, git_effect: effect, reason: 'REMOTE_OR_NETWORK_PATTERN' };
  if (effect) return { risk_class: COMMAND_RISK_CLASSES.REPOSITORY_EFFECT, normalized, git_effect: effect, reason: 'REPOSITORY_MUTATION_PATTERN' };
  // Fetching an explicitly supplied authority ref updates only Git metadata;
  // it does not alter the worktree, index, HEAD, or a remote repository. It
  // remains ASK-gated so the native approval UI presents the exact refspec.
  if (AUTHORITY_REF_PREFLIGHT.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.AUTHORITY_REF_PREFLIGHT, normalized, reason: 'EXPLICIT_AUTHORITY_REF_FETCH' };
  if (REMOTE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.REMOTE_EFFECT, normalized, reason: 'REMOTE_OR_NETWORK_PATTERN' };
  if (REPOSITORY.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.REPOSITORY_EFFECT, normalized, reason: 'REPOSITORY_MUTATION_PATTERN' };
  if (WORKSPACE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.WORKSPACE_EFFECT, normalized, reason: 'WORKSPACE_MUTATION_PATTERN' };
  const firstTwo = normalized.split(' ').slice(0, 2).join(' ');
  const commandFamily = OBSERVE.has(normalized) ? normalized : OBSERVE.has(firstTwo) ? firstTwo : OBSERVE.has(normalized.split(' ')[0]) ? normalized.split(' ')[0] : null;
  if (commandFamily) return { risk_class: COMMAND_RISK_CLASSES.OBSERVE, normalized, reason: `OBSERVE_FAMILY:${commandFamily}` };
  return { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'UNRECOGNIZED_COMMAND' };
}

function packageSnapshot(projectDir) {
  const packagePath = resolve(projectDir, 'package.json');
  const source = readFileSync(packagePath, 'utf8');
  const parsed = JSON.parse(source);
  if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return { package_path: 'package.json', package_fingerprint: sha(source), scripts: {} };
  const scripts = Object.fromEntries(Object.entries(parsed.scripts).filter(([name, body]) => typeof name === 'string' && typeof body === 'string').sort(([a], [b]) => a.localeCompare(b)));
  return { package_path: 'package.json', package_fingerprint: sha(source), scripts };
}

function isValidationScriptName(name) {
  return /^(?:test|build|typecheck|lint)(?::[a-zA-Z0-9._-]+)*$/.test(name);
}

export function createValidationRegistry({ projectDir, commands = null } = {}) {
  const snapshot = packageSnapshot(projectDir);
  const admitted = new Set();
  if (snapshot.scripts.test) admitted.add('npm test');
  for (const name of Object.keys(snapshot.scripts)) if (isValidationScriptName(name)) admitted.add(`npm run ${name}`);
  const selected = commands === null ? [...admitted].sort() : [...commands].map(normalizedCommand).sort();
  for (const command of selected) if (!admitted.has(command)) throw new Error(`Validation command is not repository-defined: ${command}`);
  const registry = { schema_version: COMMAND_ADMISSION_SCHEMA_VERSION, project_package: snapshot.package_path, package_fingerprint: snapshot.package_fingerprint, commands: selected, script_definitions: snapshot.scripts };
  return { ...registry, fingerprint: sha(canonicalJSONStringify(registry)) };
}

export function validateValidationRegistry(registry) {
  ensureObject(registry, 'ValidationRegistry');
  const allowed = new Set(['schema_version', 'project_package', 'package_fingerprint', 'commands', 'script_definitions', 'fingerprint']);
  for (const key of Object.keys(registry)) if (!allowed.has(key)) throw new Error(`Unknown ValidationRegistry field: ${key}`);
  if (registry.schema_version !== COMMAND_ADMISSION_SCHEMA_VERSION) throw new Error('ValidationRegistry schema_version invalid');
  if (registry.project_package !== 'package.json') throw new Error('ValidationRegistry project_package invalid');
  if (!/^[a-f0-9]{64}$/.test(registry.package_fingerprint) || !/^[a-f0-9]{64}$/.test(registry.fingerprint)) throw new Error('ValidationRegistry fingerprint invalid');
  if (!Array.isArray(registry.commands) || !registry.commands.length || new Set(registry.commands).size !== registry.commands.length) throw new Error('ValidationRegistry commands invalid');
  ensureObject(registry.script_definitions, 'ValidationRegistry script_definitions');
  const canonical = { schema_version: registry.schema_version, project_package: registry.project_package, package_fingerprint: registry.package_fingerprint, commands: [...registry.commands].sort(), script_definitions: Object.fromEntries(Object.entries(registry.script_definitions).sort(([a], [b]) => a.localeCompare(b))) };
  if (sha(canonicalJSONStringify(canonical)) !== registry.fingerprint) throw new Error('ValidationRegistry fingerprint mismatch');
  return { ...canonical, fingerprint: registry.fingerprint };
}

export function evaluateValidationRegistryFreshness(registry, { projectDir } = {}) {
  const normalized = validateValidationRegistry(registry);
  try {
    const current = createValidationRegistry({ projectDir, commands: normalized.commands });
    return { status: current.fingerprint === normalized.fingerprint ? 'CURRENT' : 'STALE', current_fingerprint: current.fingerprint, admitted_fingerprint: normalized.fingerprint };
  } catch (error) {
    return { status: 'STALE', current_fingerprint: null, admitted_fingerprint: normalized.fingerprint, reason: error.message };
  }
}

/**
 * Project the already-governed role policy into OpenCode's observed last-match
 * rule order. Repository-defined validation is added only for test.execute
 * roles; authority denials and approval-gated destructive operations follow
 * broad observations, while composition denials remain final.
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
  const validationPatterns = new Set();
  for (const [pattern, action] of Object.entries(baseRules)) {
    if (typeof pattern !== 'string' || !pattern || !['allow', 'ask', 'deny'].includes(action)) throw new Error('baseRules contains an invalid native permission rule');
    if (/^(?:npm test|npm run |pnpm |yarn |pytest|python -m pytest|go (?:test|build)|mix (?:test|compile)|cargo (?:test|build))/.test(pattern)) validationPatterns.add(pattern);
  }
  // A role missing any governed Git closeout authority receives a native
  // catch-all denial. This remains intentionally fail-closed until native
  // matching of executable/environment-prefixed Git forms is qualified;
  // otherwise an ASK could manufacture a missing stage/commit/push grant.
  const restricted = roleAuthority && (
    roleAuthority.may_edit === false
    || roleAuthority.may_stage === false
    || roleAuthority.may_commit === false
    || roleAuthority.may_push === false
  );
  const unadmitted = restricted || baseRules['*'] === 'deny' ? 'deny' : 'ask';

  // 1. Baseline catch-all. Restricted roles must never convert an unknown
  // mutation into an operator-granted authority escalation.
  append('*', restricted ? 'deny' : (baseRules['*'] ?? 'ask'));

  // 2. Close Git broadly before restoring the narrow observation surface. This
  // position is intentional: a later observation allowance must win under
  // OpenCode's actual last-match semantics, while unknown Git remains denied.
  append('git *', 'deny');

  // 3. Explicit safe observations, in contract order.
  for (const pattern of Object.keys(baseRules)) {
    if (OBSERVATION_PATTERNS.has(pattern)) append(pattern, baseRules[pattern]);
  }

  // 4. An explicit authority-ref fetch is the sole networked Git exception.
  // It must be --no-tags and remains native-ASK-gated. This restores an
  // authoritative branch/tag/commit for inspection without granting checkout,
  // index, worktree, closeout, or remote mutation authority.
  for (const [pattern, action] of Object.entries(baseRules)) {
    if (pattern === 'git fetch --no-tags' || pattern === 'git fetch --no-tags *') append(pattern, action);
  }

  // 5. Repository-admitted validation only for test.execute roles.
  if (validationRegistry && roleCapabilities.includes('test.execute')) {
    const registry = validateValidationRegistry(validationRegistry);
    for (const command of registry.commands) append(command, 'allow');
  } else {
    for (const pattern of validationPatterns) append(pattern, unadmitted);
  }

  // 6. Direct closeout and remote effects are denied. Destructive operations
  // are ASK-gated: approval is an operator decision, never role authority.
  for (const [pattern, action] of Object.entries(NATIVE_AUTHORITY_DENIES)) append(pattern, action);
  // Only an explicitly declared destructive ASK survives projection. This
  // keeps read-only roles fail-closed even though the runtime knows the
  // approval-gated command family.
  for (const [pattern, action] of Object.entries(NATIVE_DESTRUCTIVE_ASKS)) {
    if (baseRules[pattern] === 'ask') append(pattern, action);
  }
  // Final placement prevents a destructive or observation wildcard from
  // authorizing shell composition/redirection.
  append('*>*', 'deny'); append('*<*', 'deny');
  return rules;
}

export function createRuntimePermissionProjection({ contracts, projectDir } = {}) {
  if (!(contracts instanceof Map)) throw new Error('contracts must be a Map');
  const packagePath = resolve(projectDir, 'package.json');
  const candidate = existsSync(packagePath) ? createValidationRegistry({ projectDir }) : null;
  const validationRegistry = candidate?.commands.length ? candidate : null;
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
  return { agents, validation_registry: validationRegistry };
}

export function createValidationWrapperEnvironment({ baseDir, projectDir, registry, environment = process.env, realNpm } = {}) {
  if (!registry) return { ...environment };
  validateValidationRegistry(registry);
  ensureString(realNpm, 'realNpm');
  const wrapperDir = resolve(baseDir, 'packages', 'harness-runtime', 'bin', 'validation');
  return {
    ...environment,
    PATH: `${wrapperDir}${delimiter}${environment.PATH ?? ''}`,
    OCODE_REAL_NPM: realNpm,
    OCODE_VALIDATION_ORIGINAL_PATH: environment.PATH ?? '',
    OCODE_VALIDATION_PROJECT: resolve(projectDir),
    OCODE_VALIDATION_REGISTRY: JSON.stringify(registry),
  };
}

export function decideCommandAdmission({ command, role, roleCapabilities = [], roleAuthority = null, validationRegistry = null, projectDir = null } = {}) {
  ensureString(role, 'role');
  const classified = classifyCommand(command);
  const provenance = { classifier: 'OCODE_COMMAND_ADMISSION_V1', role, risk_class: classified.risk_class, reason: classified.reason };
  if (classified.risk_class === COMMAND_RISK_CLASSES.REMOTE_EFFECT) return { decision: COMMAND_DECISIONS.DENY, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.DESTRUCTIVE) return { decision: COMMAND_DECISIONS.ASK, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.AUTHORITY_REF_PREFLIGHT) return { decision: COMMAND_DECISIONS.ASK, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.REPOSITORY_EFFECT) {
    const gitCommand = classified.git_effect;
    const effect = ['add', 'update-index'].includes(gitCommand) ? 'stage' : ['commit', 'merge', 'rebase', 'cherry-pick', 'tag'].includes(gitCommand) ? 'commit' : ['checkout', 'restore', 'switch', 'rm', 'mv', 'config'].includes(gitCommand) ? 'repository.edit' : gitCommand === 'push' ? 'push' : null;
    if (effect && roleAuthority) return { ...decideEffectAdmission({ effect, role, authority: roleAuthority }), ...provenance };
    return { decision: COMMAND_DECISIONS.ASK, ...provenance };
  }
  if (classified.risk_class === COMMAND_RISK_CLASSES.WORKSPACE_EFFECT && roleAuthority?.may_edit === false) {
    return { ...decideEffectAdmission({ effect: 'repository.edit', role, authority: roleAuthority }), ...provenance };
  }
  if (classified.risk_class === COMMAND_RISK_CLASSES.UNKNOWN && roleAuthority?.may_edit === false) {
    return { ...decideEffectAdmission({ effect: 'repository.edit', role, authority: roleAuthority }), ...provenance };
  }
  if (classified.risk_class === COMMAND_RISK_CLASSES.OBSERVE) return { decision: COMMAND_DECISIONS.ALLOW, ...provenance };
  if (validationRegistry && validationRegistry.commands?.includes(classified.normalized) && roleCapabilities.includes('test.execute')) {
    const freshness = projectDir ? evaluateValidationRegistryFreshness(validationRegistry, { projectDir }) : { status: 'CURRENT' };
    return freshness.status === 'CURRENT'
      ? { decision: COMMAND_DECISIONS.ALLOW, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status }
      : { decision: COMMAND_DECISIONS.ASK, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status, reason: 'STALE_VALIDATION_REGISTRY' };
  }
  return { decision: COMMAND_DECISIONS.ASK, ...provenance };
}

/** Resolve an intended effect before selecting a tool. Permission cannot grant
 * constitutional authority; denied effects identify their admitted owner. */
export function decideEffectAdmission({ effect, role, authority = {}, owner = null } = {}) {
  ensureString(effect, 'effect');
  ensureString(role, 'role');
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
