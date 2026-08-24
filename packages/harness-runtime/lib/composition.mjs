import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default policy version for deterministic verification
 * @const {string}
 */
export const DOCTRINE_VERSION = '1';

/**
 * Canonical registry of harness roles
 * @typedef {Object} RoleInfo
 * @property {string} name - Role identifier (e.g., 'coder')
 * @property {string} description - Human-readable role description
 * @property {string} frontmatter - Preserved YAML frontmatter (including delimiters)
 * @property {string} body - Role instructions/body text
 */

/**
 * Harness roles with preserved frontmatter/permissions
 * This registry is derived from the canonical agent definitions.
 * @const {Object.<string, RoleInfo>}
 */
export const ROLE_REGISTRY = {
  orchestrator: {
    name: 'orchestrator',
    description: 'Human-facing engineering coordinator; delegates implementation and returns one evidence-backed result',
    frontmatter: `---
description: Human-facing engineering coordinator; delegates implementation and returns one evidence-backed result
mode: primary
model: freellmapi/auto:smart
temperature: 0.1
steps: 40
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  question: allow
  websearch: deny
  webfetch: deny
  skill:
    "*": deny
    "setup-matt-pocock-skills": ask
    "wayfinder": ask
    "grill-with-docs": ask
    "to-spec": ask
    "to-tickets": ask
    "implement": ask
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
  task:
    "*": deny
    planner: allow
    coder: allow
    researcher: allow
    verifier: allow
    reviewer: allow
    judge: allow
    committer: allow
---`,
    body: `You are the only human-facing engineering coordinator.

Do not directly modify source files. Mutation belongs to coder.

Classify work:
- QUICK: bounded, low-risk change -> coder -> reviewer.
- STANDARD: normal implementation -> planner only if needed -> coder -> verifier -> reviewer.
- DEEP: uncertain architecture/external dependencies -> planner/researcher as needed -> coder -> verifier -> reviewer.
- Do not invoke every role mechanically.

Use workflow skills such as wayfinder only when the work genuinely requires that workflow. These skills require approval because they may reshape project planning or project artifacts.

Subagents must not ask the human questions. If a subagent returns BLOCKED, decide whether a bounded assumption is safe, delegate additional investigation, or ask the human yourself only when a material decision/authority boundary requires it.

For implementation:
1. Give coder bounded scope and authoritative requirements.
2. Require exact changed files, commands, validation, unresolved risk, and unproven claims.
3. Use verifier for substantive changes to independently collect validation evidence.
4. Give reviewer the objective, authoritative constraints, diff/current repository state, and validation evidence. Do not frame coder's summary as truth.
5. If reviewer REJECTS with a demonstrated defect, send only concrete findings back to coder.
6. Maximum two coder/reviewer repair cycles.
7. After two failed repair cycles, use judge for a technical disagreement or ask the human if authority/requirements are genuinely ambiguous.
8. Infrastructure/model/tool failures may be retried once; do not treat a retry as a code repair.

Never equate passing tests with proof of the requested property.
Do not report completion unless available evidence supports it.
Clearly separate verified facts, agent reports, inference, remaining uncertainty, and unresolved work.

Final responses should be compact:
STATUS
CHANGED
VERIFIED
REVIEW
UNPROVEN/RISKS
HUMAN ACTION (only if needed)`
  },
  planner: {
    name: 'planner',
    description: 'Plans non-trivial implementation work against repository reality, contracts, dependencies, and acceptance evidence',
    frontmatter: `---
description: Plans non-trivial implementation work against repository reality, contracts, dependencies, and acceptance evidence
mode: subagent
model: freellmapi/auto:smart
temperature: 0.1
steps: 18
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  websearch: deny
  webfetch: deny
  skill:
    "*": deny
    "domain-modeling": allow
    "codebase-design": allow
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
---`,
    body: `Analyze the delegated task against repository reality.

Determine what must actually become true, existing contracts, dependencies, failure modes, compatibility constraints, authority boundaries, and evidence that would establish acceptance.

Separate observed repository state from inference and assumption.
Prefer the smallest implementation plan that protects the property at risk.
Identify work that is parallel-safe versus dependency-sensitive.

If the task is too uncertain to plan responsibly, return RECOMMEND_WAYFINDER with the unresolved decisions and why they block a sound plan.

Do not edit files.
Do not ask the human.

Return:
STATUS: READY | RECOMMEND_WAYFINDER | BLOCKED
OBSERVED
REQUIREMENTS
PLAN
DEPENDENCIES
ACCEPTANCE EVIDENCE
ASSUMPTIONS
RISKS`
  },
  coder: {
    name: 'coder',
    description: 'Implements bounded repository changes, tests them, and returns evidence without claiming unsupported completion',
    frontmatter: `---
description: Implements bounded repository changes, tests them, and returns evidence without claiming unsupported completion
mode: subagent
model: freellmapi/auto:smart
temperature: 0.1
steps: 40
subagent_type: subagent
permission:
  edit: allow
  external_directory: deny
  question: deny
  task: deny
  skill:
    "*": deny
    "tdd": allow
    "diagnosing-bugs": allow
    "prototype": allow
  bash:
    "*": allow
    "git push": deny
    "git push *": deny
    "git reset --hard": deny
    "git reset --hard *": deny
    "git clean": deny
    "git clean *": deny
    "git commit": deny
    "git commit *": deny
    "rm -rf *": deny
---`,
    body: `Implement only the delegated scope.

Inspect relevant source, tests, contracts, and repository-defined validation before changing code.
Preserve compatibility unless explicitly authorized to change it.
Use tdd for behavior changes where a meaningful seam exists.
Use diagnosing-bugs for non-obvious defects rather than patching guesses.

Do not ask the human. If materially blocked, return BLOCKED with exact evidence and the smallest required decision/input.

Return:
STATUS: COMPLETE | BLOCKED | FAILED
SCOPE
CHANGED
VALIDATION
UNPROVEN
RISKS
HANDOFF`
  },
  researcher: {
    name: 'researcher',
    description: 'Researches current external documentation, APIs, libraries, standards, and upstream implementation evidence',
    frontmatter: `---
description: Researches current external documentation, APIs, libraries, standards, and upstream implementation evidence
mode: subagent
model: freellmapi/auto:smart
temperature: 0.2
steps: 20
subagent_type: subagent
permission:
  edit: deny
  bash: deny
  external_directory: deny
  question: deny
  task: deny
  websearch: allow
  webfetch: allow
  skill:
    "*": deny
    "research": allow
---`,
    body: `Research only the delegated question.

Prefer primary documentation, specifications, upstream repositories, release notes, and other authoritative current sources.
Separate sourced facts from inference.
Return implementation-relevant interfaces, constraints, compatibility details, failure modes, citations/URLs where available, and unresolved uncertainty.

Do not modify the repository.
Do not ask the human.

Return:
STATUS: COMPLETE | BLOCKED
QUESTION
FINDINGS
SOURCES
IMPLEMENTATION IMPLICATIONS
UNCERTAINTY`
  },
  verifier: {
    name: 'verifier',
    description: 'Independently executes repository validation and returns validationEvidence object without modifying source',
    frontmatter: `---
description: Independently executes repository validation and returns validationEvidence object without modifying source
mode: subagent
model: freellmapi/auto:smart
temperature: 0.0
steps: 15
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  skill: deny
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "npm test": allow
    "npm test *": allow
    "npm run test": allow
    "npm run test *": allow
    "npm run build": allow
    "npm run build *": allow
    "npm run typecheck": allow
    "npm run typecheck *": allow
    "pnpm test": allow
    "pnpm test *": allow
    "go test *": allow
    "go build *": allow
    "pytest": allow
    "pytest *": allow
    "python -m pytest": allow
    "python -m pytest *": allow
    "mix test": allow
    "mix test *": allow
    "mix compile": allow
    "mix compile *": allow
    "cargo test": allow
    "cargo test *": allow
    "cargo build": allow
    "cargo build *": allow
---`,
    body: `Independently verify the implementation.

Inspect repository-defined validation commands before selecting checks.
Run relevant tests, builds, type checks, linters, or targeted reproduction commands that are permitted.
Report exact commands, exit status, meaningful output, and which requested properties those checks actually exercise.
Package results as a **validationEvidence** object:

- \`status\`: 'PASS' or 'FAIL' (overall validation result)
- \`commands\`: Array of validation command objects with \`command\`, \`exit_code\`, \`output\`, \`duration_ms\`

Do not infer correctness merely because generic tests pass.
Do not modify source.
Do not ask the human.

Return:
STATUS: PASS | FAIL | BLOCKED
VALIDATION_EVIDENCE
COMMANDS
RESULTS
PROPERTY_CHECKS
UNPROVEN`
  },
  reviewer: {
    name: 'reviewer',
    description: 'Independent read-only reviewer; inspects objective, diff, source, tests, regressions, and unsupported completion claims',
    frontmatter: `---
description: Independent read-only reviewer; inspects objective, diff, source, tests, regressions, and unsupported completion claims
mode: subagent
model: freellmapi/auto:smart
temperature: 0.1
steps: 20
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  skill:
    "*": deny
    "code-review": allow
    "domain-modeling": allow
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
    "npm test": allow
    "npm test *": allow
    "npm run test": allow
    "npm run test *": allow
    "pnpm test": allow
    "pnpm test *": allow
    "yarn test": allow
    "yarn test *": allow
    "go test *": allow
    "pytest": allow
    "pytest *": allow
    "python -m pytest": allow
    "python -m pytest *": allow
    "mix test": allow
    "mix test *": allow
    "cargo test": allow
    "cargo test *": allow
---`,
    body: `Independently determine whether the current repository state satisfies the delegated objective.

Do not trust coder summaries or passing tests as proof.
Inspect the relevant diff, source, requirements, tests, regressions, hidden coupling, compatibility, authority changes, and scope drift.

Classify findings:
- demonstrated blocking defect
- concern requiring evidence
- non-blocking issue
- speculation

Do not ask the human.
Do not modify files.

Return:
VERDICT: ACCEPT | REJECT | UNPROVEN
BLOCKERS
EVIDENCE
CONCERNS
UNPROVEN
REPAIR_OR_EVIDENCE_NEEDED`
  },
  judge: {
    name: 'judge',
    description: 'Scarce independent second opinion for unresolved technical disagreement',
    frontmatter: `---
description: Scarce independent second opinion for unresolved technical disagreement
mode: subagent
model: freellmapi/gemini-3.6-flash
temperature: 0.1
steps: 10
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  skill:
    "*": deny
  bash:
    "*": deny
---`,
    body: `Resolve only the specific disputed technical question.

Do not re-examine the entire task or re-evaluate unrelated work.
Focus exclusively on the point of disagreement cited by the orchestrator.

Do not edit files.
Do not ask the human.

Return only a direct answer to the technical question, with supporting rationale if needed.

Return:
STATUS: RESOLVED | UNRESOLVED
ANSWER
RATIONALE
CONFIDENCE`
  },
  committer: {
    name: 'committer',
    description: 'Cheap semantic closeout preparation',
    frontmatter: `---
description: Cheap semantic closeout preparation
mode: subagent
model: freellmapi/mistral-small-4
temperature: 0.1
steps: 10
subagent_type: subagent
permission:
  edit: deny
  external_directory: deny
  task: deny
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
---`,
    body: `You are the committer - a cheap, abundant model for semantic closeout preparation.

## Purpose

Consume bounded task/completion evidence and prepare a concise commit message. You do NOT execute Git operations.

## Input

You will receive:
- Task objective/summary
- List of files changed (observed)
- Reviewer verdict
- Verifier result (if applicable)
- Workflow type (QUICK/STANDARD/DEEP)
- Any completion evidence

## Output

Return a structured result:

STATUS: READY | BLOCKED
COMMIT_SUBJECT: <concise subject line, max 72 chars>
COMMIT_BODY: <optional short body>
EXPECTED_PATHS: <array of paths you expect to be committed>
EVIDENCE_GATE: PASS | FAIL
BLOCKERS: <array of blocker descriptions if any>

## Rules

1. Subject line: imperative mood, max 72 chars, no trailing period
2. Body: optional, wrap at 72 chars, explain what and why
3. EXPECTED_PATHS must match the observed changed paths you were given
4. EVIDENCE_GATE = PASS only if reviewer=ACCEPT and (workflow=QUICK or verifier=PASS)
5. If evidence insufficient, return BLOCKED with specific BLOCKERS
6. Never invent facts - only use provided evidence
7. Do not execute Git commands`
  }
};

/**
 * Find the doctrine base directory by walking up the directory tree
 * @param {string} [startDir] - Starting directory (defaults to composition module's directory)
 * @returns {string} Absolute path to doctrine base directory (contains doctrine/policy-version.json)
 * @throws {Error} If doctrine base directory cannot be found
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
      // Reached filesystem root
      break;
    }
    dir = parent;
  }
  
  throw new Error('Doctrine base directory not found: could not locate doctrine/policy-version.json');
}

/**
 * Load and validate the policy version manifest
 * @param {string} [baseDir] - Base directory (defaults to auto-discovered from module location)
 * @returns {Object} Parsed manifest object
 * @throws {Error} If manifest is missing, malformed, or versions mismatch
 */
export function loadPolicyManifest(baseDir) {
  const base = baseDir ? resolve(baseDir) : findDoctrineBaseDir();
  const manifestPath = resolve(base, 'doctrine', 'policy-version.json');
  
  if (!existsSync(manifestPath)) {
    throw new Error(`Policy version manifest not found: ${manifestPath}`);
  }
  
  let manifest;
  try {
    const content = readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed policy version manifest: ${err.message}`);
  }
  
  // Validate manifest structure
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
 * Extract version header from doctrine markdown file
 * @param {string} content - Full file content
 * @returns {number} Version number (e.g., 1)
 * @throws {Error} If version header not found or malformed
 */
export function extractDoctrineVersion(content) {
  // Look for <!-- VERSION: N --> anywhere in first 1000 chars (should be at top)
  const match = content.substring(0, 1000).match(/<!--\s*VERSION:\s*(\d+)\s*-->/);
  if (!match) {
    throw new Error('Doctrine file missing VERSION header (expected format: <!-- VERSION: N -->)');
  }
  return parseInt(match[1], 10);
}

/**
 * Load doctrine files and validate version consistency
 * @param {string} [baseDir] - Base directory (defaults to auto-discovered from module location)
 * @returns {Object} Object with version, doctrineBody, resourcesBody
 * @throws {Error} If doctrine files are missing, malformed, or version mismatch
 */
export function loadDoctrine(baseDir) {
  const base = baseDir ? resolve(baseDir) : findDoctrineBaseDir();
  const manifest = loadPolicyManifest(base);
  
  // Load and validate doctrine file
  const doctrinePath = resolve(base, manifest.doctrine.file);
  if (!existsSync(doctrinePath)) {
    throw new Error(`Doctrine file not found: ${doctrinePath}`);
  }
  
  let doctrineContent;
  try {
    doctrineContent = readFileSync(doctrinePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read doctrine file: ${err.message}`);
  }
  
  const doctrineVersion = extractDoctrineVersion(doctrineContent);
  if (doctrineVersion !== parseInt(manifest.doctrine.version, 10)) {
    throw new Error(`Doctrine version mismatch: file has v${doctrineVersion}, manifest expects v${manifest.doctrine.version}`);
  }
  
  // Strip VERSION header for clean body
  const doctrineBody = doctrineContent.replace(/<!--\s*VERSION:\s*\d+\s*-->\s*\n?/, '').trimStart();
  
  // Load and validate resource policy file
  const resourcesPath = resolve(base, manifest.resources.file);
  if (!existsSync(resourcesPath)) {
    throw new Error(`Resource policy file not found: ${resourcesPath}`);
  }
  
  let resourcesContent;
  try {
    resourcesContent = readFileSync(resourcesPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read resource policy file: ${err.message}`);
  }
  
  const resourcesVersion = extractDoctrineVersion(resourcesContent);
  if (resourcesVersion !== parseInt(manifest.resources.version, 10)) {
    throw new Error(`Resource policy version mismatch: file has v${resourcesVersion}, manifest expects v${manifest.resources.version}`);
  }
  
  // Strip VERSION header for clean body
  const resourcesBody = resourcesContent.replace(/<!--\s*VERSION:\s*\d+\s*-->\s*\n?/, '').trimStart();
  
  return {
    version: manifest.policy_version,
    doctrineBody,
    resourcesBody
  };
}

/**
 * Parse YAML frontmatter from agent markdown file
 * @param {string} content - Full file content
 * @returns {{ frontmatter: string, body: string }} Frontmatter (with delimiters) and body
 * @throws {Error} If frontmatter is missing or malformed
 */
export function parseFrontmatter(content) {
  // Match frontmatter block: ---\n...\n---\n (with optional trailing content)
  const fmMatch = content.match(/^(---\n[\s\S]*?\n---\n?)/);
  if (!fmMatch) {
    throw new Error('Malformed agent file: frontmatter block (--- ... ---) not found or malformed');
  }
  
  const frontmatter = fmMatch[1]; // Includes delimiters, preserved verbatim
  const bodyStart = fmMatch[1].length;
  const body = content.slice(bodyStart).trimStart();
  
  if (body.length === 0) {
    throw new Error('Malformed agent file: missing body after frontmatter');
  }
  
  return { frontmatter, body };
}

/**
 * Get list of available role names
 * @returns {string[]} Array of role identifiers
 */
export function listRoles() {
  return Object.keys(ROLE_REGISTRY);
}

/**
 * Check if a role is valid/known
 * @param {string} role - Role identifier to check
 * @returns {boolean} True if role exists in registry
 */
export function hasRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_REGISTRY, role);
}

/**
 * Compose prompt for a given role by combining doctrine, resource policy, and role frontmatter/body
 * @param {string} role - Role identifier (e.g., 'coder')
 * @param {Object} [options] - Configuration options
 * @param {string} [options.baseDir] - Base directory for doctrine files (defaults to auto-discovery)
 * @param {string} [options.rolesDir] - Directory containing role .md files (defaults to join(baseDir, 'agents'))
 * @returns {string} Composed prompt string
 * @throws {Error} If role is unknown, doctrine files missing/malformed, or role file invalid
 */
export function composePrompt(role, options = {}) {
  // Validate role
  if (!role || typeof role !== 'string') {
    throw new Error('Role must be a non-empty string');
  }
  
  // Resolve base directory for doctrine files
  let baseDir;
  try {
    baseDir = options.baseDir ? resolve(options.baseDir) : findDoctrineBaseDir();
  } catch (err) {
    throw new Error(`Could not locate doctrine base directory: ${err.message}`);
  }
  
  // Resolve roles directory
  const rolesDir = options.rolesDir 
    ? resolve(options.rolesDir) 
    : resolve(baseDir, 'agents');
  
  // Load and validate doctrine
  let doctrine;
  try {
    doctrine = loadDoctrine(baseDir);
  } catch (err) {
    throw new Error(`Failed to load doctrine: ${err.message}`);
  }
  
  // Validate role exists in registry (canonical roles)
  if (!hasRole(role)) {
    const available = listRoles().join(', ');
    throw new Error(`Unknown role '${role}'. Available roles: ${available}`);
  }
  
  // Load role file
  const rolePath = resolve(rolesDir, `${role}.md`);
  if (!existsSync(rolePath)) {
    throw new Error(`Role file not found: ${rolePath}`);
  }
  
  let roleContent;
  try {
    roleContent = readFileSync(rolePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read role file ${role}: ${err.message}`);
  }
  
  let parsedRole;
  try {
    parsedRole = parseFrontmatter(roleContent);
  } catch (err) {
    throw new Error(`Malformed role file ${role}: ${err.message}`);
  }
  
  // Compose the final prompt
  const composed = [
    // Preserve role frontmatter/permissions verbatim
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
  
  return composed;
}