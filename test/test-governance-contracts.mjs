#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditAgentInventory,
  createAgentContract,
  loadAgentContracts,
  loadAgentManifest,
} from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  ADMISSION_DECISIONS,
  CAPABILITY_SCHEMA_VERSION,
  CAPABILITY_VOCABULARY,
  GOVERNANCE_STATES,
  IDENTITY_STATES,
  classifyIdentityState,
  fingerprintCapabilityVocabulary,
  validateCapabilityDeclaration,
  validateCapabilityVocabulary,
} from '../packages/harness-runtime/lib/governance.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const fixtureRoot = resolve(repoRoot, 'test', 'fixtures', 'm4a');
const readinessRoot = resolve(repoRoot, 'test', 'fixtures', 'm4-readiness');
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));

console.log('=== Test M4A Governance Contracts ===\n');

const vocabulary = validateCapabilityVocabulary();
const vocabularyIDs = vocabulary.capabilities.map(({ id }) => id);
assert.equal(vocabulary.schema_version, CAPABILITY_SCHEMA_VERSION);
assert.deepEqual(vocabularyIDs, [...vocabularyIDs].sort());
assert.equal(new Set(vocabularyIDs).size, vocabularyIDs.length);
assert.match(fingerprintCapabilityVocabulary(), /^[0-9a-f]{64}$/);
assert.equal(fingerprintCapabilityVocabulary(), fingerprintCapabilityVocabulary(CAPABILITY_VOCABULARY));
assert.throws(
  () => validateCapabilityVocabulary({ ...CAPABILITY_VOCABULARY, schema_version: 2 }),
  /schema_version must be 1/,
);
console.log('✓ Capability vocabulary is versioned, closed, sorted, and deterministic');

const declarationDir = resolve(fixtureRoot, 'capability-declarations');
const validDeclaration = validateCapabilityDeclaration(readJSON(resolve(declarationDir, 'valid.json')));
assert.deepEqual(validDeclaration.provides, ['repository.read', 'review.evaluate']);
assert.throws(
  () => validateCapabilityDeclaration(readJSON(resolve(declarationDir, 'duplicate.json'))),
  /Duplicate capability declaration/,
);
assert.throws(
  () => validateCapabilityDeclaration(readJSON(resolve(declarationDir, 'unknown.json'))),
  /Unknown capability: git\.commit/,
);
assert.throws(
  () => validateCapabilityDeclaration(readJSON(resolve(declarationDir, 'malformed.json'))),
  /Malformed capability identifier/,
);
assert.throws(
  () => validateCapabilityDeclaration({ ...validDeclaration, schema_version: 2 }),
  /schema_version must be 1/,
);
console.log('✓ Capability declarations reject duplicate, unknown, malformed, and unsupported values');

const { manifest, contracts } = loadAgentContracts({ baseDir: repoRoot });
assert.equal(contracts.size, manifest.roles.length);
const inventory = auditAgentInventory({ manifest, agentsDir: resolve(repoRoot, 'agents') });
assert.deepEqual(inventory, { agents_without_manifest: [], manifest_without_agent: [] });
for (const role of manifest.roles) {
  const contract = contracts.get(role.id);
  assert(contract, `Missing normalized contract for ${role.id}`);
  assert.equal(contract.capabilities.schema_version, CAPABILITY_SCHEMA_VERSION);
  assert(contract.capabilities.provides.length > 0, `${role.id} must provide capabilities`);
  assert.deepEqual(contract.capabilities, validateCapabilityDeclaration(role.capabilities));
  assert.equal(typeof contract.authority.may_edit, 'boolean');
  assert.equal(typeof contract.permissions, 'object');
  assert.match(contract.contract_fingerprint, /^[0-9a-f]{64}$/);
}
console.log(`✓ All ${manifest.roles.length} governed role contracts are manifest-derived and capability-complete`);

const validRoleDir = resolve(fixtureRoot, 'valid-role');
const validRole = loadAgentContracts({
  baseDir: repoRoot,
  agentsDir: validRoleDir,
  manifestPath: resolve(validRoleDir, 'manifest.json'),
});
assert.deepEqual(validRole.contracts.get('fixture_reviewer').capabilities.provides, [
  'repository.read',
  'review.evaluate',
]);

const missingDir = resolve(fixtureRoot, 'missing-capability');
assert.throws(
  () => loadAgentManifest(resolve(missingDir, 'manifest.json')),
  /requires a capability declaration/,
);
console.log('✓ Valid role fixtures normalize and missing capability sections fail structurally');

const contradictionDir = resolve(readinessRoot, 'edit-authority-contradiction');
const contradiction = loadAgentContracts({
  baseDir: repoRoot,
  agentsDir: contradictionDir,
  manifestPath: resolve(contradictionDir, 'manifest.json'),
}).contracts.get('fixture_editor');
assert(contradiction.capabilities.provides.includes('repository.edit'));
assert.equal(contradiction.authority.may_edit, false);
assert.equal(contradiction.permissions.edit, 'allow');
console.log('✓ Capability, constitutional authority, and OpenCode permission remain separate fields');

const committer = contracts.get('committer');
assert(committer.capabilities.provides.includes('closeout.evaluate'));
assert.equal(committer.capabilities.provides.some((capability) => capability.startsWith('git.')), false);
for (const field of ['may_edit', 'may_stage', 'may_commit', 'may_push']) {
  assert.equal(committer.authority[field], false, `Committer ${field} must remain false`);
}
console.log('✓ Committer remains semantic-only and has no Git mutation authority');

const governanceGuidance = [
  'README.md',
  'docs/architecture.md',
  'docs/security.md',
  'docs/installation.md',
  'agents/orchestrator.md',
].map((path) => readFileSync(resolve(repoRoot, path), 'utf8')).join('\n');
for (const staleClaim of [
  'performs Git commits only',
  'committer for git commit/stage/closeout',
  'Committer: Allows git add/commit only',
  'Committer can stage and commit files',
  'Git commit/closeout agent',
  'git commit/stage/closeout data -> committer',
]) {
  assert.equal(governanceGuidance.includes(staleClaim), false, `Stale Committer claim: ${staleClaim}`);
}
assert.match(governanceGuidance, /deterministic runtime owns gate evaluation, exact staging, commit execution, and optional push/i);
console.log('✓ Project guidance assigns Git mutation to deterministic runtime, not Committer');

const driftDir = resolve(fixtureRoot, 'semantic-fingerprint-drift');
const driftManifest = loadAgentManifest(resolve(driftDir, 'manifest.json'));
const driftRole = driftManifest.roles[0];
const reference = createAgentContract(driftRole, readFileSync(resolve(driftDir, 'reference.md'), 'utf8'));
const current = createAgentContract(driftRole, readFileSync(resolve(driftDir, 'current.fixture'), 'utf8'));
assert.notEqual(current.contract_fingerprint, reference.contract_fingerprint);
assert.equal(classifyIdentityState({
  currentFingerprint: current.contract_fingerprint,
  referenceFingerprint: reference.contract_fingerprint,
}), IDENTITY_STATES.DRIFTED);
assert.equal(classifyIdentityState({
  currentFingerprint: reference.contract_fingerprint,
  referenceFingerprint: reference.contract_fingerprint,
}), IDENTITY_STATES.MATCHES_REFERENCE);
assert.equal(classifyIdentityState({
  currentFingerprint: current.contract_fingerprint,
}), IDENTITY_STATES.UNREFERENCED);
assert.notEqual(IDENTITY_STATES.DRIFTED, GOVERNANCE_STATES.INVALID);
assert.notEqual(IDENTITY_STATES.DRIFTED, ADMISSION_DECISIONS.DENY);
assert.deepEqual(
  {
    identity: IDENTITY_STATES.DRIFTED,
    governance: GOVERNANCE_STATES.VALID,
    admission: ADMISSION_DECISIONS.ALLOW,
  },
  { identity: 'DRIFTED', governance: 'VALID', admission: 'ALLOW' },
);
console.log('✓ Fingerprint drift is identity evidence and can coexist with VALID plus ALLOW');

const reorderedRole = structuredClone(validRole.manifest.roles[0]);
reorderedRole.capabilities.provides.reverse();
const validRoleContent = readFileSync(resolve(validRoleDir, 'fixture_reviewer.md'), 'utf8');
const ordered = createAgentContract(validRole.manifest.roles[0], validRoleContent);
const reordered = createAgentContract(reorderedRole, validRoleContent);
assert.equal(reordered.contract_fingerprint, ordered.contract_fingerprint);
console.log('✓ Capability order normalizes before semantic fingerprinting');

console.log('\n✓ All M4A governance contract tests passed');
