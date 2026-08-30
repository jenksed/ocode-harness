import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { ADMITTED_CANONICAL_SKILL_IDS } from '../packages/harness-runtime/lib/admitted-skills.mjs';
import { createRuntimeBoundOpenCodeEnvironment } from '../packages/harness-runtime/lib/interactive-configuration.mjs';
import { OpenCodeCompositionError, inspectProjectOpenCodeOwnership } from '../packages/harness-runtime/lib/opencode-composition.mjs';
import { checkProjectionDrift } from '../packages/harness-runtime/lib/skill-projection.mjs';
import { finalizeGovernedOpenCodeOverlay } from '../packages/harness-runtime/lib/execution.mjs';
import { createRuntimePermissionProjection } from '../packages/harness-runtime/lib/command-admission.mjs';
import { loadBindingProfile } from '../packages/harness-runtime/lib/opencode-integration.mjs';
import { runtimeResourcePath } from '../packages/harness-runtime/lib/runtime-paths.mjs';

const root = resolve('.');
const fixture = mkdtempSync(join(tmpdir(), 'ocode-composition-'));
const project = join(fixture, 'project');
const userHome = join(fixture, 'home');
const digest = (path) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
const write = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value); };

try {
  mkdirSync(project, { recursive: true });
  write(join(project, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: { fixture: { type: 'local', command: ['echo', 'fixture'] } },
    skills: { paths: ['./project-relative-skills'] },
  }));
  write(join(project, '.opencode', 'agents', 'project-agent.md'), '---\ndescription: project-owned agent\nmode: primary\n---\nProject agent instructions.\n');
  write(join(project, '.opencode', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: project-owned skill\n---\nProject skill.\n');
  write(join(project, 'project-relative-skills', 'relative-skill', 'SKILL.md'), '---\nname: relative-skill\ndescription: project-relative skill\n---\nRelative project skill.\n');
  const before = new Map([
    ['config', digest(join(project, 'opencode.json'))],
    ['agent', digest(join(project, '.opencode', 'agents', 'project-agent.md'))],
    ['skill', digest(join(project, '.opencode', 'skills', 'project-skill', 'SKILL.md'))],
  ]);
  const { manifest } = loadAgentContracts({ baseDir: root });
  const { contracts } = loadAgentContracts({ baseDir: root });
  const profile = loadBindingProfile('free', { profilesDir: join(root, 'profiles'), manifest }).profile;
  const runtime = createRuntimeBoundOpenCodeEnvironment({
    harnessRoot: root,
    projectRoot: project,
    governedAgentIds: manifest.roles.map((role) => role.id),
    environment: { ...process.env, HOME: userHome, XDG_CONFIG_HOME: join(userHome, '.config'), OPENCODE_DISABLE_PROJECT_CONFIG: '1' },
  });
  try {
    assert.equal(runtime.environment.OPENCODE_DISABLE_PROJECT_CONFIG, undefined);
    assert.equal(checkProjectionDrift({ skillsDir: join(root, 'skills'), runtimeSkillsDir: join(runtime.config_home, 'opencode', 'skills'), skillIds: ADMITTED_CANONICAL_SKILL_IDS }).ok, true);
    const environment = {
      ...runtime.environment,
      XDG_DATA_HOME: join(userHome, '.local', 'share'), XDG_STATE_HOME: join(userHome, '.local', 'state'), XDG_CACHE_HOME: join(userHome, '.cache'),
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    };
    const governedRuntime = createRuntimePermissionProjection({ contracts, projectDir: project });
    const governedOverlay = finalizeGovernedOpenCodeOverlay({ profile, role: 'coder', runtime: governedRuntime, contracts });
    const governedAgent = JSON.parse(execFileSync('opencode', ['debug', 'agent', 'coder', '--pure'], {
      cwd: project, env: { ...environment, OPENCODE_CONFIG_CONTENT: JSON.stringify(governedOverlay) }, encoding: 'utf8',
    }));
    assert.equal(governedAgent.name, 'coder');
    assert.equal(governedOverlay.plugin.filter(([path]) => path === runtimeResourcePath('plugins', 'pre-execution-authority-guard.mjs')).length, 1);
    const config = JSON.parse(execFileSync('opencode', ['debug', 'config', '--pure'], { cwd: project, env: environment, encoding: 'utf8' }));
    assert.deepEqual(config.mcp.fixture.command, ['echo', 'fixture']);
    const projectAgent = JSON.parse(execFileSync('opencode', ['debug', 'agent', 'project-agent', '--pure'], { cwd: project, env: environment, encoding: 'utf8' }));
    assert.equal(projectAgent.name, 'project-agent');
    const coder = JSON.parse(execFileSync('opencode', ['debug', 'agent', 'coder', '--pure'], { cwd: project, env: environment, encoding: 'utf8' }));
    assert.equal(coder.name, 'coder');
    const skills = JSON.parse(execFileSync('opencode', ['debug', 'skill', '--pure'], { cwd: project, env: environment, encoding: 'utf8' }));
    for (const id of ['tdd', 'project-skill', 'relative-skill']) assert.equal(skills.some((skill) => skill.name === id), true, id);
    console.log('✓ OpenCode 1.18.21 composes project MCP, project agent, project-relative skills, and ephemeral canonical skills');
    console.log('✓ OpenCode 1.18.21 resolved the governed pre-execution authority guard exactly once');
  } finally { runtime.cleanup(); }
  const preserved = { config: join(project, 'opencode.json'), agent: join(project, '.opencode', 'agents', 'project-agent.md'), skill: join(project, '.opencode', 'skills', 'project-skill', 'SKILL.md') };
  for (const [name, hash] of before) assert.equal(digest(preserved[name]), hash, `${name} remains byte-clean`);
  assert.equal(existsSync(join(project, '.opencode', 'skills', 'tdd')), false);

  write(join(project, '.opencode', 'agents', 'coder.md'), '---\nmodel: unsafe/model\npermission:\n  bash: allow\n---\nUnsafe replacement.\n');
  const agentCollision = inspectProjectOpenCodeOwnership({ projectRoot: project, governedAgentIds: manifest.roles.map((role) => role.id), admittedSkillIds: ADMITTED_CANONICAL_SKILL_IDS });
  assert.throws(() => createRuntimeBoundOpenCodeEnvironment({ harnessRoot: root, projectRoot: project, governedAgentIds: manifest.roles.map((role) => role.id) }), (error) => error instanceof OpenCodeCompositionError && error.code === 'OCODE_PROJECT_AGENT_COLLISION');
  assert.equal(agentCollision.agent_collisions[0][0], 'coder');
  rmSync(join(project, '.opencode', 'agents', 'coder.md'));
  write(join(project, '.opencode', 'skills', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: unsafe replacement\n---\nUnsafe replacement.\n');
  assert.throws(() => createRuntimeBoundOpenCodeEnvironment({ harnessRoot: root, projectRoot: project, governedAgentIds: manifest.roles.map((role) => role.id) }), (error) => error instanceof OpenCodeCompositionError && error.code === 'OCODE_PROJECT_SKILL_COLLISION');
  console.log('✓ governed agent and admitted skill collisions reject before OpenCode execution');
  console.log('DD2_OPENCODE_COMPOSITION_PROVEN');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
