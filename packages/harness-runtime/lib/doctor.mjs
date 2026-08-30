import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadAgentContracts } from './agent-contract.mjs';
import { ADMITTED_CANONICAL_SKILL_IDS } from './admitted-skills.mjs';
import { CANDIDATE_CAPABILITIES } from './candidate-capabilities.mjs';
import { inspectProjectOpenCodeOwnership } from './opencode-composition.mjs';
import { runtimePackageRoot } from './runtime-paths.mjs';
import { qualifyRuntimeIdentity } from './runtime-identity.mjs';
import { resolveRuntimeState } from './runtime-state.mjs';

function releaseRoot() {
  let current = runtimePackageRoot();
  while (true) {
    if (existsSync(join(current, 'runtime-compatibility.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error('OCODE_DOCTOR_RELEASE_ROOT_MISSING');
    current = parent;
  }
}
function result(status, subject, detail, required = status === 'FAIL') { return { status, subject, detail, required }; }
function readJSON(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function owned(root, path) { return typeof path === 'string' && !relative(root, resolve(path)).startsWith('..'); }
function writable(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try { accessSync(current, constants.W_OK); return true; } catch { return false; }
}

/** Read-only candidate observation; it never creates releases, state, or authority. */
export function inspectCandidateDoctor({ projectDir = process.cwd(), environment = process.env } = {}) {
  const root = releaseRoot();
  const observations = [];
  const releasePath = join(root, 'RELEASE.json');
  const artifactPath = join(root, 'ARTIFACT.json');
  try {
    const release = readJSON(releasePath);
    observations.push(result('PASS', 'installed release identity', `version=${release.version}; source_commit=${release.source_commit}; root=${root}`));
  } catch { observations.push(result('FAIL', 'installed release identity', `missing or invalid ${releasePath}`)); }
  try {
    const artifact = readJSON(artifactPath);
    observations.push(result('PASS', 'payload manifest identity', `sha256=${artifact.payload?.manifest_sha256 || 'unavailable'}`));
  } catch { observations.push(result('WARN', 'payload manifest identity', 'ARTIFACT.json is unavailable')); }
  try {
    const identity = qualifyRuntimeIdentity({ releaseRoot: root, environment });
    observations.push(result('PASS', 'qualified OpenCode runtime', `executable=${identity.executable.path}; actual=${identity.executable.version}; expected=${identity.compatibility.required_opencode_version}; sdk=${identity.sdk.package}@${identity.sdk.version}; node=${identity.node.version}; platform=${identity.platform}; architecture=${identity.architecture}`));
  } catch (error) { observations.push(result('FAIL', 'qualified OpenCode runtime', error.message)); }

  let state;
  try {
    state = resolveRuntimeState(projectDir, { environment });
    observations.push(result(writable(state.root) ? 'PASS' : 'FAIL', 'DD1 runtime state', `root=${state.root}; worktree=${state.worktree_root}; writable=${writable(state.root)}`));
  } catch (error) { observations.push(result('FAIL', 'DD1 runtime state', error.message)); }
  try {
    const { manifest } = loadAgentContracts({ baseDir: root });
    const resources = [
      ...manifest.roles.map((role) => join(root, 'agents', role.file)),
      join(root, 'harness-runtime', 'plugins', 'pre-execution-authority-guard.mjs'),
      join(root, 'harness-runtime', 'lib', 'validation-registry.mjs'),
      join(root, 'harness-runtime', 'lib', 'admitted-skills.mjs'),
      join(root, 'opencode-config', 'opencode.json'),
    ];
    const complete = resources.every((path) => existsSync(path) && owned(root, path));
    observations.push(result(complete ? 'PASS' : 'FAIL', 'DD2 installed composition resources', `governed_agents=${manifest.roles.map((role) => role.id).join(',')}; admitted_skills=${ADMITTED_CANONICAL_SKILL_IDS.join(',')}; guard=${join(root, 'harness-runtime/plugins/pre-execution-authority-guard.mjs')}; validation_registry=${join(root, 'harness-runtime/lib/validation-registry.mjs')}`));
    if (state) {
      const ownership = inspectProjectOpenCodeOwnership({ projectRoot: state.worktree_root, governedAgentIds: manifest.roles.map((role) => role.id), admittedSkillIds: ADMITTED_CANONICAL_SKILL_IDS });
      observations.push(result('PASS', 'project OpenCode composition', `project_agents=${[...ownership.agents.keys()].join(',') || 'none'}; project_skills=${[...ownership.skills.keys()].join(',') || 'none'}`));
    }
  } catch (error) { observations.push(result('FAIL', 'DD2 installed composition resources', error.message)); }
  for (const [name, capability] of Object.entries(CANDIDATE_CAPABILITIES)) observations.push(result(capability.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'PASS', `capability ${name}`, `${capability.status}; ${capability.detail}`, false));
  return Object.freeze({ root, observations: Object.freeze(observations), healthy: !observations.some((entry) => entry.required && entry.status === 'FAIL') });
}

export function runDoctor(options = {}) {
  const report = inspectCandidateDoctor(options);
  const lines = ['OCODE DOCTOR — DAILY-DRIVER CANDIDATE'];
  for (const entry of report.observations) lines.push(`${entry.status}  ${entry.subject}: ${entry.detail}`);
  lines.push(report.healthy ? 'PASS  candidate required properties healthy' : 'FAIL  candidate required properties broken');
  return { ...report, text: lines.join('\n') };
}
