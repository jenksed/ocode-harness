import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const AGENT_MANIFEST_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJSONStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function parseScalar(source, lineNumber) {
  const value = source.trim();
  if (value === '') return {};
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new Error(`Malformed quoted YAML scalar at line ${lineNumber}: ${err.message}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('[') || value.startsWith('{') || value.startsWith('- ')) {
    throw new Error(`Unsupported YAML collection syntax at line ${lineNumber}`);
  }
  return value;
}

function splitMappingLine(trimmed, lineNumber) {
  let quoted = null;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted === '"') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quoted || quoted === char)) {
      quoted = quoted ? null : char;
      continue;
    }
    if (char === ':' && quoted === null) {
      return [trimmed.slice(0, index), trimmed.slice(index + 1)];
    }
  }
  throw new Error(`Malformed YAML mapping at line ${lineNumber}`);
}

function parseKey(source, lineNumber) {
  const key = source.trim();
  if (!key) throw new Error(`Empty YAML key at line ${lineNumber}`);
  if (key.startsWith('"')) {
    try {
      return JSON.parse(key);
    } catch (err) {
      throw new Error(`Malformed quoted YAML key at line ${lineNumber}: ${err.message}`);
    }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replaceAll("''", "'");
  return key;
}

export function parseSimpleYAML(source) {
  if (typeof source !== 'string') throw new Error('YAML source must be a string');
  const root = {};
  const stack = [{ indent: -2, value: root }];
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (raw.includes('\t')) throw new Error(`Tabs are not supported in YAML indentation at line ${lineNumber}`);
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`YAML indentation must use two-space steps at line ${lineNumber}`);
    const trimmed = raw.trim();
    if (trimmed.startsWith('- ')) throw new Error(`YAML sequences are not supported at line ${lineNumber}`);
    const [rawKey, rawValue] = splitMappingLine(trimmed, lineNumber);
    const key = parseKey(rawKey, lineNumber);

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1);
    if (indent !== parent.indent + 2) {
      throw new Error(`Invalid YAML indentation at line ${lineNumber}`);
    }
    if (Object.prototype.hasOwnProperty.call(parent.value, key)) {
      throw new Error(`Duplicate YAML key '${key}' at line ${lineNumber}`);
    }
    const parsedValue = parseScalar(rawValue, lineNumber);
    parent.value[key] = parsedValue;
    if (isPlainObject(parsedValue)) stack.push({ indent, value: parsedValue });
  }

  return root;
}

export function parseAgentMarkdown(content) {
  if (typeof content !== 'string') throw new Error('Agent Markdown must be a string');
  const normalized = content.replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error('Malformed agent file: frontmatter block (--- ... ---) not found or malformed');
  const body = normalized.slice(match[0].length).trimStart();
  if (!body) throw new Error('Malformed agent file: missing body after frontmatter');
  return {
    frontmatter: match[0],
    frontmatter_source: match[1],
    metadata: parseSimpleYAML(match[1]),
    body,
  };
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
}

export function validateRoleManifest(manifest) {
  if (!isPlainObject(manifest)) throw new Error('Agent manifest must be an object');
  const allowedTopLevel = new Set(['schema_version', 'roles']);
  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevel.has(key)) throw new Error(`Unknown agent manifest field: ${key}`);
  }
  if (manifest.schema_version !== AGENT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Agent manifest schema_version must be ${AGENT_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.roles) || manifest.roles.length === 0) {
    throw new Error('Agent manifest must define a non-empty roles array');
  }

  const ids = new Set();
  const files = new Set();
  for (const role of manifest.roles) {
    if (!isPlainObject(role)) throw new Error('Agent manifest role entries must be objects');
    if (typeof role.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(role.id)) {
      throw new Error('Agent manifest role entries require a valid id');
    }
    if (typeof role.file !== 'string' || !/^[a-z0-9][a-z0-9_-]*\.md$/.test(role.file)) {
      throw new Error(`Agent manifest role ${role.id} requires a safe Markdown file`);
    }
    if (ids.has(role.id)) throw new Error(`Duplicate role id in agent manifest: ${role.id}`);
    if (files.has(role.file)) throw new Error(`Duplicate role file in agent manifest: ${role.file}`);
    ids.add(role.id);
    files.add(role.file);

    if (!isPlainObject(role.authority)) throw new Error(`Manifest role ${role.id} requires authority metadata`);
    if (typeof role.authority.tier !== 'string' || !role.authority.tier) {
      throw new Error(`Manifest role ${role.id} authority.tier must be a non-empty string`);
    }
    for (const field of ['may_edit', 'may_stage', 'may_commit', 'may_push']) {
      assertBoolean(role.authority[field], `Manifest role ${role.id} authority.${field}`);
    }
    if (!isPlainObject(role.governance)) throw new Error(`Manifest role ${role.id} requires governance metadata`);
    assertBoolean(role.governance.human_facing, `Manifest role ${role.id} governance.human_facing`);
    assertBoolean(
      role.governance.deterministic_git_authority,
      `Manifest role ${role.id} governance.deterministic_git_authority`,
    );
    if (!Array.isArray(role.compatible_skills)) {
      throw new Error(`Manifest role ${role.id} compatible_skills must be an array`);
    }
  }
  return manifest;
}

export function loadAgentManifest(manifestPath) {
  if (!existsSync(manifestPath)) throw new Error(`Agent manifest not found: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Malformed agent manifest at ${manifestPath}: ${err.message}`);
  }
  return validateRoleManifest(manifest);
}

export function auditAgentInventory({ manifest, agentsDir }) {
  validateRoleManifest(manifest);
  const manifestFiles = new Set(manifest.roles.map((role) => role.file));
  const actualFiles = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((file) => file.endsWith('.md')).sort(compareCodePoints)
    : [];
  return {
    agents_without_manifest: actualFiles.filter((file) => !manifestFiles.has(file)),
    manifest_without_agent: manifest.roles
      .filter((role) => !existsSync(resolve(agentsDir, role.file)))
      .map((role) => role.file),
  };
}

export function createAgentContract(role, content) {
  const parsed = parseAgentMarkdown(content);
  const metadata = structuredClone(parsed.metadata);
  const permissions = isPlainObject(metadata.permission) ? metadata.permission : {};
  const declaredModel = metadata.model ?? null;
  delete metadata.permission;
  delete metadata.model;
  const contract = {
    schema_version: 1,
    id: role.id,
    file: role.file,
    authority: structuredClone(role.authority),
    governance: structuredClone(role.governance),
    permissions: structuredClone(permissions),
    agent_settings: metadata,
    semantic_content: parsed.body,
  };
  contract.contract_fingerprint = createHash('sha256')
    .update(canonicalJSONStringify(contract))
    .digest('hex');
  contract.declared_model = declaredModel;
  return contract;
}

export function loadAgentContracts({ baseDir, agentsDir, manifestPath } = {}) {
  const base = resolve(baseDir || dirname(dirname(dirname(dirname(__filename)))));
  const resolvedAgentsDir = resolve(agentsDir || resolve(base, 'agents'));
  const resolvedManifestPath = resolve(manifestPath || resolve(resolvedAgentsDir, 'manifest.json'));
  const manifest = loadAgentManifest(resolvedManifestPath);
  const audit = auditAgentInventory({ manifest, agentsDir: resolvedAgentsDir });
  if (audit.agents_without_manifest.length > 0) {
    throw new Error(`Agent files absent from manifest: ${audit.agents_without_manifest.join(', ')}`);
  }
  if (audit.manifest_without_agent.length > 0) {
    throw new Error(`Manifest roles reference missing agent files: ${audit.manifest_without_agent.join(', ')}`);
  }
  const contracts = new Map();
  for (const role of manifest.roles) {
    const content = readFileSync(resolve(resolvedAgentsDir, role.file), 'utf8');
    contracts.set(role.id, createAgentContract(role, content));
  }
  return { manifest, contracts, agents_dir: resolvedAgentsDir, manifest_path: resolvedManifestPath };
}

export function fingerprintAgentContract(contract) {
  const copy = structuredClone(contract);
  delete copy.contract_fingerprint;
  delete copy.declared_model;
  return createHash('sha256').update(canonicalJSONStringify(copy)).digest('hex');
}
