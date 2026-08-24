#!/usr/bin/env node
/**
 * test-agents.mjs
 * Validate 8 agents exist with correct contracts
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const agentsDir = join(__dirname, '..', 'agents');
const expectedAgents = [
  'orchestrator.md',
  'planner.md',
  'coder.md',
  'verifier.md',
  'reviewer.md',
  'researcher.md',
  'judge.md',
  'committer.md',
];

console.log('=== Test Agents ===\n');

// Check agents directory
if (!existsSync(agentsDir)) {
  console.error('✗ Agents directory not found');
  process.exit(1);
}

console.log('Checking agents directory: ' + agentsDir + '\n');

const manifestPath = join(agentsDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json not found');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
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
      const requiredFields = ['---', 'description:', 'mode:', 'model:'];

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

// Check judge for correct model
const judgePath = join(agentsDir, 'judge.md');
if (existsSync(judgePath)) {
  const content = readFileSync(judgePath, 'utf8');

  console.log('\n=== Judge Model ===\n');

  if (content.includes('model: freellmapi/gemini-3.6-flash')) {
    console.log('✓ Judge uses freellmapi/gemini-3.6-flash');
  } else if (content.includes('model:')) {
    console.warn(`⚠ Judge uses model: ${content.match(/model:\s*([^\n]+)/)?.[1] || 'unknown'}`);
  } else {
    console.error('✗ Judge missing model field');
  }
}

// Summary
console.log('\n=== Summary ===\n');

if (missingAgents.length === 0 && invalidAgents.length === 0) {
  console.log('✓ All 8 agents are present and valid');
  process.exit(0);
} else {
  console.error(`✗ ${missingAgents.length} agent(s) missing`);
  console.error(`✗ ${invalidAgents.length} agent(s) invalid`);
  process.exit(1);
}
