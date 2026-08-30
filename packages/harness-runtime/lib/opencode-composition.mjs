import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class OpenCodeCompositionError extends Error {
  constructor(code, details = {}) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = 'OpenCodeCompositionError';
    this.code = code;
    this.details = details;
  }
}

function files(root, predicate, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files(path, predicate, result);
    else if (entry.isFile() && predicate(entry.name)) result.push(path);
  }
  return result;
}

function parseJSONC(path) {
  const text = readFileSync(path, 'utf8');
  let output = '', quoted = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true; output += char;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      output += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
    } else output += char;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, '$1'));
}

function projectConfigFiles(projectRoot) {
  return [
    join(projectRoot, 'opencode.json'), join(projectRoot, 'opencode.jsonc'),
    join(projectRoot, '.opencode', 'opencode.json'), join(projectRoot, '.opencode', 'opencode.jsonc'),
  ].filter(existsSync);
}

function skillName(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\s*\n[\s\S]*?^name:\s*["']?([a-z0-9]+(?:-[a-z0-9]+)*)["']?\s*$/m);
  return match?.[1] ?? basename(resolve(path, '..'));
}

function skillFilesAt(root) { return files(root, (name) => name === 'SKILL.md'); }

/**
 * Classifies only OpenCode's documented project-owned agent/skill seams.
 * It never migrates configuration: project paths retain their project-relative
 * interpretation because OpenCode reads the original project files in place.
 */
export function inspectProjectOpenCodeOwnership({ projectRoot, governedAgentIds, admittedSkillIds }) {
  const root = resolve(projectRoot), agentIds = new Map(), skillIds = new Map(), configFiles = projectConfigFiles(root);
  for (const directory of [join(root, '.opencode', 'agent'), join(root, '.opencode', 'agents')]) {
    for (const path of files(directory, (name) => name.endsWith('.md'))) agentIds.set(basename(path, '.md'), path);
  }
  for (const directory of [join(root, '.opencode', 'skill'), join(root, '.opencode', 'skills')]) {
    for (const path of skillFilesAt(directory)) skillIds.set(skillName(path), path);
  }
  for (const path of configFiles) {
    let config;
    try { config = parseJSONC(path); } catch { continue; }
    if (config?.agent && typeof config.agent === 'object' && !Array.isArray(config.agent)) for (const id of Object.keys(config.agent)) agentIds.set(id, path);
    if (Array.isArray(config?.skills?.paths)) for (const configuredPath of config.skills.paths) {
      if (typeof configuredPath !== 'string' || !configuredPath || /^https?:/.test(configuredPath)) continue;
      for (const skillPath of skillFilesAt(resolve(dirname(path), configuredPath))) skillIds.set(skillName(skillPath), skillPath);
    }
  }
  const agent_collisions = [...agentIds].filter(([id]) => governedAgentIds.includes(id));
  const skill_collisions = [...skillIds].filter(([id]) => admittedSkillIds.includes(id));
  return { project_root: root, config_files: configFiles, agents: agentIds, skills: skillIds, agent_collisions, skill_collisions };
}

export function assertProjectOpenCodeCompositionSafe(ownership) {
  if (ownership.agent_collisions.length) throw new OpenCodeCompositionError('OCODE_PROJECT_AGENT_COLLISION', { collisions: ownership.agent_collisions.map(([id, path]) => ({ id, path })) });
  if (ownership.skill_collisions.length) throw new OpenCodeCompositionError('OCODE_PROJECT_SKILL_COLLISION', { collisions: ownership.skill_collisions.map(([id, path]) => ({ id, path })) });
  return ownership;
}
