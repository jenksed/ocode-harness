import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentManifest, parseAgentMarkdown } from './agent-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default policy version for deterministic verification.
 * @const {string}
 */
export const DOCTRINE_VERSION = '1';

/**
 * Find the doctrine base directory by walking up the directory tree.
 * @param {string} [startDir] - Starting directory.
 * @returns {string} Absolute path to base directory.
 * @throws {Error} If doctrine base directory cannot be found.
 */
export function findDoctrineBaseDir(startDir) {
  const start = startDir ? resolve(startDir) : __dirname;
  let dir = start;

  while (true) {
    const policyPath = resolve(dir, 'doctrine', 'policy-version.json');
    if (existsSync(policyPath)) {
      return dir;
    }

    const parent = resolve(dir, '..');
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error('Doctrine base directory not found: could not locate doctrine/policy-version.json');
}

/**
 * Load and validate the policy version manifest.
 * @param {string} [baseDir] - Base directory.
 * @returns {Object} Parsed manifest object.
 */
export function loadPolicyManifest(baseDir) {
  const base = baseDir ? resolve(baseDir) : findDoctrineBaseDir();
  const manifestPath = resolve(base, 'doctrine', 'policy-version.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Policy version manifest not found: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`Malformed policy version manifest: ${err.message}`);
  }

  if (!manifest.policy_version) {
    throw new Error('Policy version manifest missing policy_version field');
  }
  if (!manifest.doctrine || !manifest.doctrine.file || !manifest.doctrine.version) {
    throw new Error('Policy version manifest missing doctrine.file or doctrine.version');
  }
  if (!manifest.resources || !manifest.resources.file || !manifest.resources.version) {
    throw new Error('Policy version manifest missing resources.file or resources.version');
  }

  return manifest;
}

/**
 * Extract version header from doctrine markdown file.
 * @param {string} content - Full file content.
 * @returns {number} Version number.
 */
export function extractDoctrineVersion(content) {
  const match = content.substring(0, 1000).match(/<!--\s*VERSION:\s*(\d+)\s*-->/);
  if (!match) {
    throw new Error('Doctrine file missing VERSION header (expected format: <!-- VERSION: N -->)');
  }
  return parseInt(match[1], 10);
}

/**
 * Load doctrine files and validate version consistency.
 * @param {string} [baseDir] - Base directory.
 * @returns {Object} Object with version, doctrineBody, resourcesBody.
 */
export function loadDoctrine(baseDir) {
  const base = baseDir ? resolve(baseDir) : findDoctrineBaseDir();
  const manifest = loadPolicyManifest(base);

  const doctrinePath = resolve(base, manifest.doctrine.file);
  if (!existsSync(doctrinePath)) {
    throw new Error(`Doctrine file not found: ${doctrinePath}`);
  }

  const doctrineContent = readFileSync(doctrinePath, 'utf8');
  const doctrineVersion = extractDoctrineVersion(doctrineContent);
  if (doctrineVersion !== parseInt(manifest.doctrine.version, 10)) {
    throw new Error(`Doctrine version mismatch: file has v${doctrineVersion}, manifest expects v${manifest.doctrine.version}`);
  }

  const resourcesPath = resolve(base, manifest.resources.file);
  if (!existsSync(resourcesPath)) {
    throw new Error(`Resource policy file not found: ${resourcesPath}`);
  }

  const resourcesContent = readFileSync(resourcesPath, 'utf8');
  const resourcesVersion = extractDoctrineVersion(resourcesContent);
  if (resourcesVersion !== parseInt(manifest.resources.version, 10)) {
    throw new Error(`Resource policy version mismatch: file has v${resourcesVersion}, manifest expects v${manifest.resources.version}`);
  }

  return {
    version: manifest.policy_version,
    doctrineBody: doctrineContent.replace(/<!--\s*VERSION:\s*\d+\s*-->\s*\n?/, '').trimStart(),
    resourcesBody: resourcesContent.replace(/<!--\s*VERSION:\s*\d+\s*-->\s*\n?/, '').trimStart()
  };
}

/**
 * Parse YAML frontmatter from agent markdown.
 * @param {string} content - Full file content.
 * @returns {{ frontmatter: string, body: string }}
 */
export function parseFrontmatter(content) {
  const parsed = parseAgentMarkdown(content);
  return { frontmatter: parsed.frontmatter, body: parsed.body };
}

function extractDescription(frontmatter) {
  const match = frontmatter.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Load structured role metadata from agents/manifest.json.
 * @param {string} [baseDir] - Base directory.
 * @returns {Object} Parsed manifest.
 */
export function loadRoleManifest(baseDir) {
  const base = baseDir ? resolve(baseDir) : findDoctrineBaseDir();
  const manifestPath = resolve(base, 'agents', 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Agent manifest not found: ${manifestPath}`);
  }

  return loadAgentManifest(manifestPath);
}

/**
 * Load canonical roles from agents/*.md and agents/manifest.json.
 * The markdown files own semantic instructions and OpenCode permissions.
 * The manifest owns structured governance metadata.
 * @param {Object} [options]
 * @param {string} [options.baseDir]
 * @param {string} [options.rolesDir]
 * @returns {Object.<string, Object>} Role registry.
 */
export function loadRoleRegistry(options = {}) {
  const baseDir = options.baseDir ? resolve(options.baseDir) : findDoctrineBaseDir();
  const rolesDir = options.rolesDir ? resolve(options.rolesDir) : resolve(baseDir, 'agents');
  const manifest = loadRoleManifest(baseDir);
  const registry = {};

  for (const role of manifest.roles) {
    const rolePath = resolve(rolesDir, role.file);
    if (!existsSync(rolePath)) {
      throw new Error(`Role file not found for manifest role '${role.id}': ${rolePath}`);
    }

    const content = readFileSync(rolePath, 'utf8');
    const parsed = parseFrontmatter(content);

    registry[role.id] = {
      name: role.id,
      file: role.file,
      description: extractDescription(parsed.frontmatter),
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      authority: role.authority || {},
      compatible_skills: role.compatible_skills || [],
      governance: role.governance || {}
    };
  }

  return registry;
}

export const ROLE_REGISTRY = loadRoleRegistry();

/**
 * Get list of available role names.
 * @returns {string[]} Array of role identifiers.
 */
export function listRoles() {
  return Object.keys(ROLE_REGISTRY);
}

/**
 * Check if a role is valid/known.
 * @param {string} role - Role identifier.
 * @returns {boolean} True if role exists.
 */
export function hasRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_REGISTRY, role);
}

/**
 * Compose prompt for a given role by combining doctrine and canonical role file.
 * @param {string} role - Role identifier.
 * @param {Object} [options]
 * @param {string} [options.baseDir]
 * @param {string} [options.rolesDir]
 * @returns {string} Composed prompt string.
 */
export function composePrompt(role, options = {}) {
  if (!role || typeof role !== 'string') {
    throw new Error('Role must be a non-empty string');
  }

  let baseDir;
  try {
    baseDir = options.baseDir ? resolve(options.baseDir) : findDoctrineBaseDir();
  } catch (err) {
    throw new Error(`Could not locate doctrine base directory: ${err.message}`);
  }

  const registry = options.baseDir || options.rolesDir
    ? loadRoleRegistry({ baseDir, rolesDir: options.rolesDir })
    : ROLE_REGISTRY;

  if (!Object.prototype.hasOwnProperty.call(registry, role)) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown role '${role}'. Available roles: ${available}`);
  }

  let doctrine;
  try {
    doctrine = loadDoctrine(baseDir);
  } catch (err) {
    throw new Error(`Failed to load doctrine: ${err.message}`);
  }

  const parsedRole = registry[role];

  return [
    parsedRole.frontmatter,
    '',
    '## Canonical Operating Doctrine — Agentic Agile (VERSION: 1)',
    '',
    doctrine.doctrineBody,
    '',
    '## Responsible Resource Consumption (VERSION: 1)',
    '',
    doctrine.resourcesBody,
    '',
    `## Role Instructions: ${role}`,
    '',
    parsedRole.body
  ].join('\n');
}
