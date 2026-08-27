#!/usr/bin/env node
/**
 * test-agents.mjs
 * Validate manifest-derived agents exist with correct contracts
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const agentsDir = join(__dirname, '..', 'agents');
const manifestPath = join(agentsDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedAgents = manifest.roles.map((role) => role.file);

console.log('=== Test Agents ===\n');

// Check agents directory
if (!existsSync(agentsDir)) {
  console.error('✗ Agents directory not found');
  process.exit(1);
}

console.log('Checking agents directory: ' + agentsDir + '\n');

if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json not found');
  process.exit(1);
}

const manifestFiles = manifest.roles.map(role => role.file).sort();
const expectedFiles = [...expectedAgents].sort();
if (JSON.stringify(manifestFiles) === JSON.stringify(expectedFiles)) {
  console.log('✓ manifest.json lists all canonical agents');
} else {
  console.error('✗ manifest.json does not match canonical agent files');
  process.exit(1);
}

// Check each agent file
const missingAgents = [];
const invalidAgents = [];

for (const agentFile of expectedAgents) {
  const agentPath = join(agentsDir, agentFile);

  if (!existsSync(agentPath)) {
    console.error(`✗ ${agentFile} not found`);
    missingAgents.push(agentFile);
  } else {
    try {
      const content = readFileSync(agentPath, 'utf8');

      // Check for required fields
      const requiredFields = ['---', 'description:', 'mode:', 'permission:'];

      for (const field of requiredFields) {
        if (!content.includes(field)) {
          console.error(`✗ ${agentFile} missing required field: ${field}`);
          invalidAgents.push({ file: agentFile, missing: field });
        }
      }

      // Check for harness-specific requirements. Orchestrator is allowed to
      // delegate tasks; coder is the only mutating source agent.
      const roleName = agentFile.replace('.md', '');
      const harnessRequirements = ['subagent_type:'];
      if (roleName !== 'orchestrator') {
        harnessRequirements.push('task: deny');
      }
      if (roleName !== 'coder') {
        harnessRequirements.push('edit: deny');
      }

      for (const req of harnessRequirements) {
        if (!content.includes(req)) {
          console.warn(`⚠ ${agentFile} missing harness requirement: ${req}`);
        }
      }

      console.log(`✓ ${agentFile}`);
    } catch (err) {
      console.error(`✗ ${agentFile} could not be read`);
      invalidAgents.push({ file: agentFile, error: err.message });
    }
  }
}

// Check orchestrator for specific harness contract
const orchestratorPath = join(agentsDir, 'orchestrator.md');
if (existsSync(orchestratorPath)) {
  const content = readFileSync(orchestratorPath, 'utf8');

  const allowedSubagents = [
    'planner: allow',
    'wayfinder: allow',
    'coder: allow',
    'researcher: allow',
    'verifier: allow',
    'reviewer: allow',
    'judge: allow',
  ];

  const genericSubagents = [
    'general: allow',
    'explore: allow',
    'scout: allow',
  ];

  console.log('\n=== Orchestrator Subagent Permissions ===\n');

  let allAllowed = true;
  for (const subagent of allowedSubagents) {
    if (content.includes(subagent)) {
      console.log(`✓ ${subagent}`);
    } else {
      console.error(`✗ ${subagent} not found`);
      allAllowed = false;
    }
  }

  for (const genericSubagent of genericSubagents) {
    if (!content.includes(genericSubagent)) {
      console.log(`✓ No generic subagent: ${genericSubagent}`);
    } else {
      console.error(`✗ Generic subagent found: ${genericSubagent}`);
      allAllowed = false;
    }
  }

  if (!allAllowed) {
    console.error('\n✗ Orchestrator has incorrect subagent permissions');
  }
}

console.log('\n=== Provider-neutral Semantic Agents ===\n');
for (const agentFile of expectedAgents) {
  const content = readFileSync(join(agentsDir, agentFile), 'utf8');
  if (/^model:/m.test(content)) {
    console.error(`✗ ${agentFile} contains mutable provider/model policy`);
    invalidAgents.push({ file: agentFile, field: 'model' });
  } else {
    console.log(`✓ ${agentFile} has no model policy`);
  }
}

console.log('\n=== Tool Name Constraints ===\n');
for (const agentFile of expectedAgents) {
  const content = readFileSync(join(agentsDir, agentFile), 'utf8');
  for (const required of ['## Tool names', '`ls` is a shell command, not an OpenCode tool', 'never invent a tool from a shell command name']) {
    if (!content.includes(required)) {
      console.error(`✗ ${agentFile} missing tool-name constraint: ${required}`);
      invalidAgents.push({ file: agentFile, field: required });
    }
  }
  if (!invalidAgents.some((entry) => entry.file === agentFile && entry.field?.includes('tool'))) {
    console.log(`✓ ${agentFile} distinguishes shell commands from tool names`);
  }
}

const coderPolicy = readFileSync(join(agentsDir, 'coder.md'), 'utf8');
const orchestratorPolicy = readFileSync(join(agentsDir, 'orchestrator.md'), 'utf8');
for (const required of ['"*": ask', 'EFFECT REQUEST', '"git add": deny', '"git push": deny', '"rm -rf *": deny']) {
  if (!coderPolicy.includes(required)) {
    console.error(`✗ coder primary-routing policy missing: ${required}`);
    invalidAgents.push({ file: 'coder.md', field: required });
  } else {
    console.log(`✓ coder primary-routing policy preserves ${required}`);
  }
}

for (const required of ['"*": ask', '"git push": deny', '"git reset --hard": deny', '"git clean": deny', '"rm -rf *": deny', 'native Bash tool']) {
  if (!orchestratorPolicy.includes(required)) {
    console.error(`✗ orchestrator native-ASK policy missing: ${required}`);
    invalidAgents.push({ file: 'orchestrator.md', field: required });
  } else {
    console.log(`✓ orchestrator native-ASK policy preserves ${required}`);
  }
}

console.log('\n=== Step Budget and Recovery Policy ===\n');
const expectedSteps = {
  orchestrator: 80,
  coder: 80,
  planner: 36,
  researcher: 40,
  verifier: 30,
  reviewer: 36,
  wayfinder: 24,
  judge: 20,
  committer: 15,
};
for (const [role, steps] of Object.entries(expectedSteps)) {
  const content = readFileSync(join(agentsDir, `${role}.md`), 'utf8');
  const match = content.match(/^steps:\s*(\d+)\s*$/m);
  if (!match || Number(match[1]) !== steps) {
    console.error(`✗ ${role} must have finite ${steps}-step budget`);
    invalidAgents.push({ file: `${role}.md`, field: `steps: ${steps}` });
  } else {
    console.log(`✓ ${role} has finite ${steps}-step budget`);
  }
}
for (const required of ['## Step-limit recovery', 'capacity interruption', 'fresh delegation of the same role', 'CAPACITY LIMIT REACHED', 'structural denial']) {
  if (!orchestratorPolicy.includes(required)) {
    console.error(`✗ orchestrator step-limit recovery missing: ${required}`);
    invalidAgents.push({ file: 'orchestrator.md', field: required });
  } else {
    console.log(`✓ orchestrator step-limit recovery includes ${required}`);
  }
}

console.log('\n=== Delegation Packet ===\n');
for (const required of [
  'DELEGATION PACKET',
  'ROLE',
  'OBJECTIVE',
  'IN SCOPE / OUT OF SCOPE',
  'CURRENT FACTS AND AUTHORITATIVE EVIDENCE',
  'RELEVANT FILES AND CURRENT DIFF',
  'ACCEPTANCE AND VALIDATION',
  'ALREADY COMPLETED — do not repeat',
  'RETURN FORMAT AND STOP CONDITION',
  'transcript/history and unrelated repository context',
]) {
  if (!orchestratorPolicy.includes(required)) {
    console.error(`✗ orchestrator delegation packet missing: ${required}`);
    invalidAgents.push({ file: 'orchestrator.md', field: required });
  } else {
    console.log(`✓ orchestrator delegation packet includes ${required}`);
  }
}

// Summary
console.log('\n=== Summary ===\n');

if (missingAgents.length === 0 && invalidAgents.length === 0) {
  console.log(`✓ All ${expectedAgents.length} manifest-governed agents are present, valid, and provider-neutral`);
  process.exit(0);
} else {
  console.error(`✗ ${missingAgents.length} agent(s) missing`);
  console.error(`✗ ${invalidAgents.length} agent(s) invalid`);
  process.exit(1);
}
