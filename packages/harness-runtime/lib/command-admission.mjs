import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

export function createValidationRegistry({ projectDir, commands = null } = {}) {
  const snapshot = packageSnapshot(projectDir);
  const admitted = new Set();
  if (snapshot.scripts.test) admitted.add('npm test');
  for (const name of Object.keys(snapshot.scripts)) admitted.add(`npm run ${name}`);
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

export function decideCommandAdmission({ command, role, roleCapabilities = [], validationRegistry = null, projectDir = null } = {}) {
  ensureString(role, 'role');
  const classified = classifyCommand(command);
  const provenance = { classifier: 'OCODE_COMMAND_ADMISSION_V1', role, risk_class: classified.risk_class, reason: classified.reason };
  if (classified.risk_class === COMMAND_RISK_CLASSES.DESTRUCTIVE || classified.risk_class === COMMAND_RISK_CLASSES.REMOTE_EFFECT) return { decision: COMMAND_DECISIONS.DENY, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.REPOSITORY_EFFECT) return { decision: COMMAND_DECISIONS.ASK, ...provenance };
  if (classified.risk_class === COMMAND_RISK_CLASSES.OBSERVE) return { decision: COMMAND_DECISIONS.ALLOW, ...provenance };
  if (validationRegistry && validationRegistry.commands?.includes(classified.normalized) && roleCapabilities.includes('test.execute')) {
    const freshness = projectDir ? evaluateValidationRegistryFreshness(validationRegistry, { projectDir }) : { status: 'CURRENT' };
    return freshness.status === 'CURRENT'
      ? { decision: COMMAND_DECISIONS.ALLOW, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status }
      : { decision: COMMAND_DECISIONS.ASK, ...provenance, registry_fingerprint: validationRegistry.fingerprint, registry_status: freshness.status, reason: 'STALE_VALIDATION_REGISTRY' };
  }
  return { decision: COMMAND_DECISIONS.ASK, ...provenance };
}
