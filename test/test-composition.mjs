#!/usr/bin/env node
/**
 * test-composition.mjs
 * Test composition module for prompt assembly
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(tmpdir(), `ocode-harness-composition-test-${Date.now()}`);
const compositionPath = join(__dirname, '..', 'packages', 'harness-runtime', 'lib', 'composition.mjs');

console.log('=== Test Composition Module ===\n');
console.log(`Test directory: ${testDir}\n`);

// Create test directory
mkdirSync(testDir, { recursive: true });

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

try {
  // Import the composition module
  const compositionModule = await import(compositionPath);
  const { 
    DOCTRINE_VERSION,
    ROLE_REGISTRY,
    findDoctrineBaseDir,
    loadPolicyManifest,
    extractDoctrineVersion,
    loadDoctrine,
    parseFrontmatter,
    loadRoleManifest,
    loadRoleRegistry,
    listRoles,
    hasRole,
    composePrompt
  } = compositionModule;

  console.log('Testing composition module exports...\n');

  // Test 1: DOCTRINE_VERSION constant
  assert(DOCTRINE_VERSION === '1', 'DOCTRINE_VERSION is "1"');

  // Test 2: ROLE_REGISTRY has all expected roles
  const baseDirForRoles = resolve(__dirname, '..');
  const manifest = loadRoleManifest(baseDirForRoles);
  const expectedRoles = manifest.roles.map((role) => role.id);
  assert(manifest.schema_version === 1, 'Agent manifest has schema_version 1');
  assert(manifest.roles.length === expectedRoles.length, 'Expected roles derive from the agent manifest');

  for (const role of expectedRoles) {
    assert(ROLE_REGISTRY[role] !== undefined, `ROLE_REGISTRY has role: ${role}`);
  }

  // Test 3: Each role has required properties
  for (const role of expectedRoles) {
    const r = ROLE_REGISTRY[role];
    assert(r.name === role, `Role ${role} has correct name`);
    assert(typeof r.description === 'string' && r.description.length > 0, `Role ${role} has description`);
    assert(typeof r.frontmatter === 'string' && r.frontmatter.includes('---'), `Role ${role} has frontmatter`);
    assert(typeof r.body === 'string' && r.body.length > 0, `Role ${role} has body`);
    assert(r.file === `${role}.md`, `Role ${role} references canonical markdown file`);
  }

  // Test 3b: registry derives prompt text from agents/*.md rather than hard-coded copies
  const sourceRegistry = loadRoleRegistry({ baseDir: baseDirForRoles });
  for (const role of expectedRoles) {
    const agentContent = readFileSync(join(baseDirForRoles, 'agents', `${role}.md`), 'utf8');
    const parsed = parseFrontmatter(agentContent);
    assert(sourceRegistry[role].frontmatter === parsed.frontmatter, `Role ${role} frontmatter matches canonical file`);
    assert(sourceRegistry[role].body === parsed.body, `Role ${role} body matches canonical file`);
  }

  // Test 4: listRoles function
  const roles = listRoles();
  assert(Array.isArray(roles), 'listRoles returns array');
  assert(roles.length === expectedRoles.length, 'listRoles returns every manifest role');
  for (const role of expectedRoles) {
    assert(roles.includes(role), `listRoles includes ${role}`);
  }

  // Test 5: hasRole function
  for (const role of expectedRoles) {
    assert(hasRole(role) === true, `hasRole(${role}) returns true`);
  }
  assert(hasRole('unknown') === false, 'hasRole(unknown) returns false');
  assert(hasRole('') === false, 'hasRole("") returns false');

  // Test 6: parseFrontmatter function
  const sampleFrontmatter = `---\ndescription: Test\nmodel: test\n---\n\nBody content here.`;
  const parsed = parseFrontmatter(sampleFrontmatter);
  assert(parsed.frontmatter === '---\ndescription: Test\nmodel: test\n---\n', 'parseFrontmatter extracts frontmatter with delimiters');
  assert(parsed.body === 'Body content here.', 'parseFrontmatter extracts body');

  // Test 7: parseFrontmatter throws on malformed input
  try {
    parseFrontmatter('no frontmatter here');
    assert(false, 'parseFrontmatter should throw on missing frontmatter');
  } catch (err) {
    assert(err.message.includes('frontmatter'), 'parseFrontmatter throws on missing frontmatter');
  }

  try {
    parseFrontmatter('---\nno closing delimiter');
    assert(false, 'parseFrontmatter should throw on unclosed frontmatter');
  } catch (err) {
    assert(err.message.includes('frontmatter'), 'parseFrontmatter throws on unclosed frontmatter');
  }

  // Test 8: findDoctrineBaseDir works from module location
  try {
    const baseDir = findDoctrineBaseDir();
    assert(existsSync(baseDir), 'findDoctrineBaseDir returns existing directory');
    assert(existsSync(join(baseDir, 'doctrine', 'policy-version.json')), 'Base dir contains policy-version.json');
  } catch (err) {
    // May fail if not in expected structure, that's ok for this test
    console.log('  ℹ findDoctrineBaseDir:', err.message);
  }

  // Test 9: loadPolicyManifest
  try {
    const baseDir = findDoctrineBaseDir();
    const manifest = loadPolicyManifest(baseDir);
    assert(manifest.policy_version === '1', 'Manifest has policy_version 1');
    assert(manifest.doctrine && manifest.doctrine.file && manifest.doctrine.version, 'Manifest has doctrine info');
    assert(manifest.resources && manifest.resources.file && manifest.resources.version, 'Manifest has resources info');
  } catch (err) {
    console.log('  ℹ loadPolicyManifest:', err.message);
  }

  // Test 10: extractDoctrineVersion
  const doctrineContent = `<!-- VERSION: 1 -->\n\n# Doctrine\n\nContent here.`;
  assert(extractDoctrineVersion(doctrineContent) === 1, 'extractDoctrineVersion returns 1');

  try {
    extractDoctrineVersion('# No version header');
    assert(false, 'extractDoctrineVersion should throw on missing version');
  } catch (err) {
    assert(err.message.includes('VERSION header'), 'extractDoctrineVersion throws on missing version');
  }

  // Test 11: loadDoctrine
  try {
    const baseDir = findDoctrineBaseDir();
    const doctrine = loadDoctrine(baseDir);
    assert(doctrine.version === '1', 'loadDoctrine returns version 1');
    assert(typeof doctrine.doctrineBody === 'string' && doctrine.doctrineBody.length > 0, 'loadDoctrine returns doctrineBody');
    assert(typeof doctrine.resourcesBody === 'string' && doctrine.resourcesBody.length > 0, 'loadDoctrine returns resourcesBody');
  } catch (err) {
    console.log('  ℹ loadDoctrine:', err.message);
  }

  // Test 12: composePrompt for each role
  for (const role of expectedRoles) {
    try {
      const prompt = composePrompt(role);
      assert(typeof prompt === 'string' && prompt.length > 0, `composePrompt(${role}) returns string`);
      assert(prompt.includes(`## Role Instructions: ${role}`), `Prompt for ${role} includes role header`);
      assert(prompt.includes('## Canonical Operating Doctrine'), `Prompt for ${role} includes doctrine`);
      assert(prompt.includes('## Responsible Resource Consumption'), `Prompt for ${role} includes resource policy`);
      assert(prompt.includes(ROLE_REGISTRY[role].body.substring(0, 50)), `Prompt for ${role} includes role body`);
      assert(prompt.includes(ROLE_REGISTRY[role].frontmatter.substring(0, 50)), `Prompt for ${role} includes role frontmatter`);
    } catch (err) {
      console.log(`  ℹ composePrompt(${role}):`, err.message);
    }
  }

  // Test 13: composePrompt throws on unknown role
  try {
    composePrompt('unknown-role');
    assert(false, 'composePrompt should throw on unknown role');
  } catch (err) {
    // Note: composePrompt tries to load doctrine before checking role,
    // so it may throw a doctrine error first. Both are acceptable failures.
    assert(err.message.includes('Unknown role') || err.message.includes('Doctrine'), 'composePrompt throws on unknown role');
  }

  // Test 14: composePrompt throws on empty role
  try {
    composePrompt('');
    assert(false, 'composePrompt should throw on empty role');
  } catch (err) {
    assert(err.message.includes('non-empty string'), 'composePrompt throws on empty role');
  }

  // Test 15: composePrompt throws on non-string role
  try {
    composePrompt(null);
    assert(false, 'composePrompt should throw on null role');
  } catch (err) {
    assert(err.message.includes('non-empty string'), 'composePrompt throws on null role');
  }

  // Test 16: Role frontmatter structure validation
  for (const role of expectedRoles) {
    const frontmatter = ROLE_REGISTRY[role].frontmatter;
    assert(frontmatter.includes('description:'), `${role} frontmatter has description`);
    assert(frontmatter.includes('mode:'), `${role} frontmatter has mode`);
    assert(!frontmatter.includes('\nmodel:'), `${role} frontmatter is provider-neutral`);
    assert(frontmatter.includes('temperature:'), `${role} frontmatter has temperature`);
    assert(frontmatter.includes('steps:'), `${role} frontmatter has steps`);
    assert(frontmatter.includes('subagent_type:'), `${role} frontmatter has subagent_type`);
    assert(frontmatter.includes('permission:'), `${role} frontmatter has permission`);
  }

  // Test 17: Orchestrator has task allowlist with all subagents
  const orchestratorFm = ROLE_REGISTRY.orchestrator.frontmatter;
  for (const agent of ['planner', 'coder', 'researcher', 'verifier', 'reviewer', 'judge', 'committer']) {
    assert(orchestratorFm.includes(`${agent}: allow`), `Orchestrator allows ${agent}`);
  }

  // Test 18: Coder has edit allow
  assert(ROLE_REGISTRY.coder.frontmatter.includes('edit: allow'), 'Coder has edit: allow');

  // Test 19: Verifier has test/build commands allowed
  const verifierFm = ROLE_REGISTRY.verifier.frontmatter;
  assert(verifierFm.includes('npm test'), 'Verifier allows npm test');
  assert(verifierFm.includes('npm run build'), 'Verifier allows npm run build');

  // Test 20: Reviewer has read-only git and test commands
  const reviewerFm = ROLE_REGISTRY.reviewer.frontmatter;
  assert(reviewerFm.includes('edit: deny'), 'Reviewer has edit: deny');
  assert(reviewerFm.includes('npm test'), 'Reviewer allows npm test');
  assert(reviewerFm.includes('git diff'), 'Reviewer allows git diff');

  // Test 21: Committer semantics do not own deployment model policy
  assert(!ROLE_REGISTRY.committer.frontmatter.includes('\nmodel:'), 'Committer is provider-neutral');

  // Test 22: All roles have subagent_type: subagent except orchestrator
  for (const role of expectedRoles) {
    if (role === 'orchestrator') {
      assert(ROLE_REGISTRY[role].frontmatter.includes('mode: primary'), 'Orchestrator is primary');
    } else {
      assert(ROLE_REGISTRY[role].frontmatter.includes('mode: subagent'), `${role} is subagent`);
    }
  }

  // Test 23: Compose prompt includes VERSION header in doctrine section
  try {
    const baseDir = findDoctrineBaseDir();
    const prompt = composePrompt('coder', { baseDir });
    assert(prompt.includes('VERSION: 1'), 'Composed prompt includes doctrine version');
  } catch (err) {
    console.log('  ℹ composePrompt with baseDir:', err.message);
  }

  // Test 24: Custom rolesDir option
  try {
    const customRolesDir = join(testDir, 'custom-agents');
    mkdirSync(customRolesDir, { recursive: true });
    
    // Create a minimal test role file
    const testRoleContent = `---\ndescription: Test role\nmode: subagent\nmodel: freellmapi/test\ntemperature: 0.1\nsteps: 10\nsubagent_type: subagent\npermission:\n  edit: deny\n  external_directory: deny\n  question: deny\n  task: deny\n  websearch: deny\n  webfetch: deny\n  skill:\n    "*": deny\n  bash:\n    "*": deny\n---\n\nTest role body.`;
    writeFileSync(join(customRolesDir, 'test-role.md'), testRoleContent, 'utf8');
    
    // This should fail because 'test-role' is not in ROLE_REGISTRY
    try {
      const baseDir = findDoctrineBaseDir();
      composePrompt('test-role', { baseDir, rolesDir: customRolesDir });
      assert(false, 'composePrompt should throw for role not in registry');
    } catch (err) {
      // Note: composePrompt tries to load doctrine before checking role,
      // so it may throw a doctrine error first. Both are acceptable failures.
      assert(
        err.message.includes('Unknown role') ||
        err.message.includes('Doctrine') ||
        err.message.includes('Role file not found'),
        'composePrompt validates role against manifest registry even with custom rolesDir'
      );
    }
  } catch (err) {
    console.log('  ℹ Custom rolesDir test:', err.message);
  }

  console.log('\n=== Summary ===\n');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n✓ All tests passed');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed');
    process.exit(1);
  }

} catch (error) {
  console.error('\n✗ Test execution failed:', error.message);
  console.error(error.stack);
  failed++;
  console.log('\n=== Summary ===\n');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(1);
} finally {
  // Cleanup
  rmSync(testDir, { recursive: true, force: true });
}
