import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJSONStringify } from './agent-contract.mjs';

export const VALIDATION_REGISTRY_SCHEMA_VERSION = 2;
export const VALIDATION_PROVIDER_IDS = Object.freeze(['elixir', 'go', 'node', 'python', 'rust']);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const normalizedCommand = (command) => {
  if (typeof command !== 'string' || !command.trim()) throw new Error('Validation command must be a non-empty string');
  return command.trim().replace(/\s+/g, ' ');
};
const sorted = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right));
const read = (projectDir, path) => {
  const absolute = resolve(projectDir, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
};

function nodeProvider(projectDir) {
  const source = read(projectDir, 'package.json');
  if (source === null) return null;
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new Error('INVALID_PROJECT_CONFIGURATION: package.json is not valid JSON'); }
  const scripts = parsed?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return { id: 'node', commands: [], governing_files: ['package.json'] };
  const commands = [];
  if (typeof scripts.test === 'string') commands.push('npm test');
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body === 'string' && /^(?:test|build|lint|typecheck)(?::[A-Za-z0-9._-]+)*$/.test(name)) commands.push(`npm run ${name}`);
  }
  return { id: 'node', commands: sorted(commands), governing_files: ['package.json'] };
}

function elixirProvider(projectDir) {
  return read(projectDir, 'mix.exs') === null ? null : { id: 'elixir', commands: ['mix compile', 'mix test'], governing_files: ['mix.exs'] };
}

function pythonProvider(projectDir) {
  const paths = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'];
  const sources = Object.fromEntries(paths.map((path) => [path, read(projectDir, path)]));
  const configured = sources['pytest.ini'] !== null
    || Object.values(sources).some((source) => source !== null && /(?:^\s*\[tool\.pytest|^\s*\[tool:pytest\]|^\s*\[pytest\]|^\s*deps\s*=.*\bpytest\b)/mi.test(source));
  if (!configured) return null;
  return { id: 'python', commands: ['pytest', 'python -m pytest'], governing_files: paths.filter((path) => sources[path] !== null) };
}

function goProvider(projectDir) {
  return read(projectDir, 'go.mod') === null ? null : { id: 'go', commands: ['go build', 'go build ./...', 'go test', 'go test ./...'], governing_files: ['go.mod'] };
}

function rustProvider(projectDir) {
  return read(projectDir, 'Cargo.toml') === null ? null : { id: 'rust', commands: ['cargo build', 'cargo test'], governing_files: ['Cargo.toml'] };
}

const PROVIDERS = [nodeProvider, elixirProvider, pythonProvider, goProvider, rustProvider];

function canonicalRegistry(registry) {
  return {
    schema_version: registry.schema_version,
    project_root: registry.project_root,
    providers: registry.providers.map((provider) => ({
      id: provider.id,
      commands: [...provider.commands],
      governing_files: [...provider.governing_files],
    })),
    commands: [...registry.commands],
    governing_files: registry.governing_files.map((file) => ({ path: file.path, fingerprint: file.fingerprint })),
  };
}

export function createValidationRegistry({ projectDir, commands = null } = {}) {
  if (typeof projectDir !== 'string' || !projectDir) throw new Error('projectDir is required');
  const providers = PROVIDERS.map((provider) => provider(projectDir)).filter(Boolean)
    .map((provider) => ({ ...provider, commands: sorted(provider.commands), governing_files: sorted(provider.governing_files) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const admitted = sorted(providers.flatMap((provider) => provider.commands));
  const selected = commands === null ? admitted : sorted(commands.map(normalizedCommand));
  for (const command of selected) if (!admitted.includes(command)) throw new Error(`Validation command is not repository-defined: ${command}`);
  const governingPaths = sorted(providers.flatMap((provider) => provider.governing_files));
  const governing_files = governingPaths.map((path) => {
    const source = read(projectDir, path);
    if (source === null) throw new Error(`Governing validation file disappeared: ${path}`);
    return { path, fingerprint: sha(source) };
  });
  const registry = { schema_version: VALIDATION_REGISTRY_SCHEMA_VERSION, project_root: '.', providers, commands: selected, governing_files };
  return { ...registry, fingerprint: sha(canonicalJSONStringify(registry)) };
}

export function validateValidationRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ValidationRegistry must be an object');
  const allowed = new Set(['schema_version', 'project_root', 'providers', 'commands', 'governing_files', 'fingerprint']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown ValidationRegistry field: ${key}`);
  if (value.schema_version !== VALIDATION_REGISTRY_SCHEMA_VERSION || value.project_root !== '.') throw new Error('ValidationRegistry schema/project root invalid');
  if (!Array.isArray(value.providers) || !Array.isArray(value.commands) || !Array.isArray(value.governing_files)) throw new Error('ValidationRegistry collections invalid');
  const providerIDs = value.providers.map((provider) => provider?.id);
  if (providerIDs.some((id) => !VALIDATION_PROVIDER_IDS.includes(id)) || JSON.stringify(providerIDs) !== JSON.stringify(sorted(providerIDs))) throw new Error('ValidationRegistry providers invalid');
  for (const provider of value.providers) {
    if (!Array.isArray(provider.commands) || !Array.isArray(provider.governing_files)
      || JSON.stringify(provider.commands) !== JSON.stringify(sorted(provider.commands))
      || JSON.stringify(provider.governing_files) !== JSON.stringify(sorted(provider.governing_files))) throw new Error('ValidationRegistry provider invalid');
  }
  if (JSON.stringify(value.commands) !== JSON.stringify(sorted(value.commands)) || value.commands.some((command) => normalizedCommand(command) !== command)) throw new Error('ValidationRegistry commands invalid');
  if (JSON.stringify(value.governing_files.map((file) => file?.path)) !== JSON.stringify(sorted(value.governing_files.map((file) => file?.path)))
    || value.governing_files.some((file) => typeof file?.path !== 'string' || !/^[a-f0-9]{64}$/.test(file?.fingerprint))) throw new Error('ValidationRegistry governing files invalid');
  const providerCommands = sorted(value.providers.flatMap((provider) => provider.commands));
  if (JSON.stringify(providerCommands.filter((command) => value.commands.includes(command))) !== JSON.stringify(value.commands)) throw new Error('ValidationRegistry commands are not provider-defined');
  const providerFiles = sorted(value.providers.flatMap((provider) => provider.governing_files));
  if (JSON.stringify(providerFiles) !== JSON.stringify(value.governing_files.map((file) => file.path))) throw new Error('ValidationRegistry governing files are not provider-defined');
  const canonical = canonicalRegistry(value);
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint) || sha(canonicalJSONStringify(canonical)) !== value.fingerprint) throw new Error('ValidationRegistry fingerprint mismatch');
  return { ...canonical, fingerprint: value.fingerprint };
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
