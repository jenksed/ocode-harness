import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const COMMAND_ADMISSION_SCHEMA_VERSION = 1;
export const COMMAND_RISK_CLASSES = Object.freeze({
  OBSERVE: 'OBSERVE', VALIDATE: 'VALIDATE', WORKSPACE_EFFECT: 'WORKSPACE_EFFECT',
  REPOSITORY_EFFECT: 'REPOSITORY_EFFECT', REMOTE_EFFECT: 'REMOTE_EFFECT',
  DESTRUCTIVE: 'DESTRUCTIVE', UNKNOWN: 'UNKNOWN',
});
export const COMMAND_DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', DENY: 'DENY' });

const OBSERVE = new Set([
  'pwd', 'ls', 'rg', 'grep', 'find', 'head', 'tail', 'wc', 'file', 'stat', 'tree', 'which', 'command -v',
  'git status', 'git diff', 'git log', 'git show', 'git rev-parse', 'git worktree list', 'git branch --show-current', 'git branch --list',
]);
const DESTRUCTIVE = /^(?:rm\s+-[^\n]*r|git\s+(?:reset\s+--hard|clean\b)|find\b.*\s-delete\b)/;
const REMOTE = /^(?:git\s+push\b|git\s+fetch\b|git\s+pull\b|curl\b|wget\b|ssh\b|scp\b)/;
const REPOSITORY = /^(?:git\s+(?:add|commit|merge|rebase|checkout|switch|restore|cherry-pick)\b)/;
const WORKSPACE = /^(?:mkdir|touch|cp|mv|sed\s+-i|perl\s+-i|npm\s+(?:install|ci)|pnpm\s+(?:install|add)|yarn\s+(?:add|install))\b/;
const SHELL_COMPOSITION = /[\n\r;&|><`$\\]|\$\(|\)\s*\(/;
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
  'ls', 'ls *', 'pwd', 'rg', 'rg *', 'grep', 'grep *', 'find', 'find *',
  'head', 'head *', 'tail', 'tail *', 'git status', 'git status *',
  'git diff', 'git diff *', 'git log', 'git log *', 'git show', 'git show *',
  'git rev-parse', 'git rev-parse *', 'git worktree list', 'git worktree list *',
  'git branch --show-current', 'git branch --list', 'git branch --list *',
  'git branch -a', 'git branch -r',
]);

function ensureObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; }
function ensureString(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function normalizedCommand(command) { return ensureString(command, 'command').trim().replace(/\s+/g, ' '); }

/**
 * A conservative lexical classifier. It deliberately rejects shell composition
 * rather than pretending OpenCode's unqualified prefix matcher parsed argv.
 */
export function classifyCommand(command) {
  const normalized = normalizedCommand(command);
  if (SHELL_COMPOSITION.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.UNKNOWN, normalized, reason: 'SHELL_COMPOSITION_OR_EXPANSION' };
  if (DESTRUCTIVE.test(normalized)) return { risk_class: COMMAND_RISK_CLASSES.DESTRUCTIVE, normalized, reason: 'STRUCTURAL_DESTRUCTIVE_PATTERN' };
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
 * roles; structural denials are always appended last so broad observation
 * patterns cannot authorize redirection or a remote/destructive effect.
 */
export function createNativeBashPermissionRules({ baseRules = {}, validationRegistry = null, roleCapabilities = [], roleAuthority = null } = {}) {
  ensureObject(baseRules, 'baseRules');
  const rules = {};
  const validationPatterns = [];
  for (const [pattern, action] of Object.entries(baseRules)) {
    if (typeof pattern !== 'string' || !pattern || !['allow', 'ask', 'deny'].includes(action)) throw new Error('baseRules contains an invalid native permission rule');
    if (/^(?:npm test|npm run |pnpm |yarn |pytest|python -m pytest|go (?:test|build)|mix (?:test|compile)|cargo (?:test|build))/.test(pattern)) { validationPatterns.push(pattern); continue; }
    rules[pattern] = action;
  }
  const readOnly = roleAuthority && roleAuthority.may_edit === false;
  const unadmitted = readOnly || baseRules['*'] === 'deny' ? 'deny' : 'ask';
  if (readOnly) rules['*'] = 'deny';
  for (const pattern of validationPatterns) rules[pattern] = unadmitted;
  if (validationRegistry && roleCapabilities.includes('test.execute')) {
    const registry = validateValidationRegistry(validationRegistry);
    for (const command of registry.commands) rules[command] = 'allow';
  }
  if (readOnly) {
    for (const [pattern, action] of Object.entries(baseRules)) {
      if (OBSERVATION_PATTERNS.has(pattern)) rules[pattern] = action;
    }
  }
  for (const [pattern, action] of Object.entries(NATIVE_STRUCTURAL_DENIES)) rules[pattern] = action;
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
  if (classified.risk_class === COMMAND_RISK_CLASSES.DESTRUCTIVE || classified.risk_class === COMMAND_RISK_CLASSES.REMOTE_EFFECT) return { decision: COMMAND_DECISIONS.DENY, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.REPOSITORY_EFFECT) {
    const effect = /^(?:git add)\b/.test(classified.normalized) ? 'stage' : /^(?:git commit)\b/.test(classified.normalized) ? 'commit' : null;
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
