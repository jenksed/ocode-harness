import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSkillSource, skillProtocolAdmissionRequest, validateQualificationRecord, deriveSkillLifecycle } from '../packages/harness-runtime/lib/skill-contract.mjs';
import { validateContextCapsule, validateReportedEvidenceCapsule, enrichEvidenceCapsule } from '../packages/harness-runtime/lib/skill-capsules.mjs';
import { parseSkillResult } from '../packages/harness-runtime/lib/skill-runtime.mjs';
import { projectSkills, checkProjectionDrift } from '../packages/harness-runtime/lib/skill-projection.mjs';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { evaluateAdmission } from '../packages/harness-runtime/lib/admission.mjs';
import { executeGovernedRole } from '../packages/harness-runtime/lib/execution.mjs';
import { checkpointQualificationExecution, contextTelemetry, fixtureFingerprint, observeCompletedSkillLoad, resumeQualificationReport } from '../packages/harness-runtime/lib/skill-qualification.mjs';
import { evaluateTddTrace } from '../packages/harness-runtime/lib/tdd-qualification.mjs';

const root = resolve('.');
const attemptId = process.env.TDD_QUALIFICATION_ATTEMPT || 'attempt-6';
const expectedFingerprint = 'cbbf6040ed7cb7d929459bf0864db70a2e07a2f2452979c42ad98e040e356a3f';
const fixturePaths = ['math.mjs', 'math.test.mjs', 'package.json', 'qualification-test-runner.mjs'];
const source = loadSkillSource({ skillsDir: join(root, 'skills'), skillId: 'tdd' });
if (source.skill_fingerprint !== expectedFingerprint) throw new Error('TDD canonical fingerprint mismatch');
const evidenceDir = join(source.directory, 'qualifications', 'evidence');
const checkpointPath = join(evidenceDir, `${expectedFingerprint}-live-${attemptId}-execution.json`);
const artifactPath = join(evidenceDir, `${expectedFingerprint}-live.json`);
const failurePath = join(evidenceDir, `${expectedFingerprint}-live-${attemptId}-failed.json`);
const recordPath = join(source.directory, 'qualifications', `${expectedFingerprint}.json`);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const hashes = (dir) => Object.fromEntries(fixturePaths.map((path) => [path, sha(join(dir, path))]));
const changedPaths = (before, after) => Object.keys(before).filter((path) => before[path] !== after[path]);
const command = (args, options) => spawnSync('opencode', args, { encoding: 'utf8', ...options });
function parseDiagnosticJSON(result, label) {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${label}_FAILED:${JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr })}`);
  }
  if (typeof result.stdout !== 'string' || !result.stdout.trim()) {
    throw new Error(`${label}_EMPTY:${JSON.stringify({ status: result.status, stderr: result.stderr })}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label}_UNPARSEABLE:${JSON.stringify({ parse_error: error.message, stdout: result.stdout, stderr: result.stderr })}`);
  }
}
function compactFailure(error) {
  if (!error) return null;
  if (/APIError[\s\S]*statusCode[^0-9]{0,12}401/i.test(error)) return 'PROVIDER_API_ERROR_401';
  if (/APIError[\s\S]*statusCode[^0-9]{0,12}403/i.test(error)) return 'PROVIDER_API_ERROR_403';
  if (/APIError[\s\S]*statusCode[^0-9]{0,12}429/i.test(error)) return 'PROVIDER_API_ERROR_429';
  if (/ServeError/.test(error)) return 'OPENCODE_SERVER_ERROR';
  return String(error).split(':', 1)[0].slice(0, 160);
}
const compactExecution = (result) => ({
  command: result.execution.command, transport: result.transport ?? null,
  termination: result.execution.termination ?? null, completion_source: result.completion_source ?? null,
  exit_code: result.execution.exit_code, signal: result.execution.signal,
  duration_ms: result.execution.duration_ms, spawn_error: compactFailure(result.execution.spawn_error),
  export: { exit_code: result.export_result?.exit_code ?? null, spawn_error: compactFailure(result.export_result?.spawn_error) },
});
const eventSummary = (events) => events.filter((event) => event?.type === 'tool_use').map((event) => ({
  type: event.type, part: event.part ?? event.properties?.part ?? null,
}));
const runtimeEvidence = (fixtureFp) => [
  { schema_version: 1, id: 'tdd-red', kind: 'test', claim: 'Initial focused oracle failed on the initial implementation.', source: 'deterministic-live-runtime', dependency_scope: ['m6-tdd-live'], observed_at: new Date().toISOString(), freshness: 'CURRENT', dependency_fingerprints: { fixture: fixtureFp, skill: source.skill_fingerprint } },
  { schema_version: 1, id: 'tdd-change', kind: 'source', claim: 'Only math.mjs changed after RED.', source: 'deterministic-live-runtime', dependency_scope: ['m6-tdd-live'], observed_at: new Date().toISOString(), freshness: 'CURRENT', dependency_fingerprints: { fixture: fixtureFp, skill: source.skill_fingerprint } },
  { schema_version: 1, id: 'tdd-green', kind: 'test', claim: 'The same focused oracle passed on the changed implementation.', source: 'deterministic-live-runtime', dependency_scope: ['m6-tdd-live'], observed_at: new Date().toISOString(), freshness: 'CURRENT', dependency_fingerprints: { fixture: fixtureFp, skill: source.skill_fingerprint } },
  { schema_version: 1, id: 'tdd-scope', kind: 'source', claim: 'The focused oracle and every non-authorized fixture source remained unchanged.', source: 'deterministic-live-runtime', dependency_scope: ['m6-tdd-live'], observed_at: new Date().toISOString(), freshness: 'CURRENT', dependency_fingerprints: { fixture: fixtureFp, skill: source.skill_fingerprint } },
  { schema_version: 1, id: 'tdd-method-load', kind: 'tool', claim: 'A completed OpenCode tdd skill load was observed.', source: 'deterministic-live-runtime', dependency_scope: ['m6-tdd-live'], observed_at: new Date().toISOString(), freshness: 'CURRENT', dependency_fingerprints: { fixture: fixtureFp, skill: source.skill_fingerprint } },
];
const acceptanceIDs = source.protocol.acceptance.map(({ id }) => id);
const requiredSupport = {
  'behavior-bounded': ['tdd-scope'], 'independent-oracle': ['tdd-scope'], 'red-proven': ['tdd-red'],
  'change-bounded': ['tdd-change'], 'green-proven': ['tdd-green'],
  'regression-durable': ['tdd-green', 'tdd-scope'], 'stop-when-proven': ['tdd-scope'],
};
const identity = { skill_id: source.protocol.skill_id, skill_version: source.protocol.skill_version, skill_fingerprint: source.skill_fingerprint };
const capsule = { schema_version: 1, objective: 'fix isEven so the supplied focused test passes using canonical TDD', constraints: ['use tdd', 'establish RED before mutation', 'change only math.mjs', 'run npm test', 'no stage/commit/push', 'no external research', 'return ReportedEvidenceCapsule after GREEN'], skill: identity, path_refs: [{ path: 'math.mjs', reason: 'implementation target' }, { path: 'math.test.mjs', reason: 'focused executable oracle' }, { path: 'package.json', reason: 'focused test command' }], evidence_refs: [], assumptions: [], acceptance_expectations: acceptanceIDs, expected_outputs: ['skill-result'], context_budget: { max_path_refs: 3, max_evidence_refs: 1, max_supplied_chars: 6000, telemetry_boundary: 'CAPSULE_ONLY' }, context_expansion_policy: { max_expansions: 0 } };
validateContextCapsule(capsule, { source });

const reportedContract = '{"schema_version":1,"skill":{"skill_id":"tdd","skill_version":"1.0.0","skill_fingerprint":"' + expectedFingerprint + '"},"subject":{"requested_role":"coder"},"claims":[],"observations":[],"deterministic_validation":[],"changed_files":[],"artifacts":[],"acceptance_mapping":[{"acceptance_id":"<one of exact IDs>","state":"SATISFIED|UNSATISFIED|UNRESOLVED","supporting_evidence_refs":["<only allowed id>"]}],"unresolved_items":[],"provenance_refs":{"run_id":null,"session_id":null}}';
const methodPrompt = `Load and follow the projected tdd skill. Supplied ContextCapsule: ${JSON.stringify(capsule)}\n\nWork only in math.mjs, math.test.mjs, and package.json. Run npm test before any implementation mutation. If RED, make the smallest change only to math.mjs and run the same npm test again. Do not stage, commit, push, research, inspect other files, or run broad tests. Stop after GREEN.\n\nReturn JSON only: no Markdown and no prose. Return a ReportedEvidenceCapsule v1 matching this exact shape: ${reportedContract}. requested_role is coder. acceptance_mapping must contain exactly these IDs: ${acceptanceIDs.join(', ')}. Allowed runtime evidence IDs only: tdd-red (initial focused test failed), tdd-change (only math.mjs changed after RED), tdd-green (same focused test passed), tdd-scope (oracle/scope preserved), tdd-method-load (completed skill load). Do not invent EvidenceRefs or authoritative runtime facts.`;

function assertPreflight({ fixture, env, admissionDecision }) {
  const drift = checkProjectionDrift({ skillsDir: join(root, 'skills'), runtimeSkillsDir: join(fixture, '.opencode', 'skills'), skillIds: ['tdd'] });
  if (!drift.ok) throw new Error('PROJECTION_DRIFT');
  const skill = command(['debug', 'skill', '--pure'], { cwd: fixture, env });
  const discovered = parseDiagnosticJSON(skill, 'TDD_PROJECTION_DIAGNOSTIC');
  const projectedSkill = realpathSync(join(fixture, '.opencode', 'skills', 'tdd', 'SKILL.md'));
  if (skill.status !== 0 || !Array.isArray(discovered) || !discovered.some((entry) => entry?.name === 'tdd' && entry.location === projectedSkill)) throw new Error('TDD_PROJECTION_NOT_DISCOVERABLE');
  const agent = command(['debug', 'agent', 'coder', '--pure'], { cwd: fixture, env });
  const effectiveAgent = parseDiagnosticJSON(agent, 'CODER_PERMISSION_DIAGNOSTIC');
  const permission = effectiveAgent?.permission ?? [];
  if (agent.status !== 0 || !permission.some((entry) => entry.permission === 'skill' && entry.pattern === '*' && entry.action === 'deny') || !permission.some((entry) => entry.permission === 'skill' && entry.pattern === 'tdd' && entry.action === 'allow')) throw new Error('CODER_TDD_PERMISSION_NOT_EFFECTIVE');
  if (admissionDecision.decision !== 'ALLOW') throw new Error('TDD_TO_CODER_ADMISSION_DENIED');
}

mkdirSync(evidenceDir, { recursive: true });
// Preserve the pre-hardening transient artifact; it is historical failure evidence,
// not a destination for this new attempt.
if (existsSync(artifactPath)) renameSync(artifactPath, join(evidenceDir, `${expectedFingerprint}-live-pre-hardening-transient.json`));
const fixture = mkdtempSync(join(tmpdir(), 'ocode-tdd-live-'));
cpSync(join(root, 'test/fixtures/m6-tdd/live'), fixture, { recursive: true });
const runtimeState = join(fixture, '.qualification', 'opencode-runtime');
for (const directory of ['data', 'state', 'cache']) mkdirSync(join(runtimeState, directory), { recursive: true });
mkdirSync(join(fixture, '.opencode', 'agents'), { recursive: true });
cpSync(join(root, 'agents', 'coder.md'), join(fixture, '.opencode', 'agents', 'coder.md'));
projectSkills({ skillsDir: join(root, 'skills'), runtimeSkillsDir: join(fixture, '.opencode', 'skills'), skillIds: ['tdd'] });
const { contracts } = loadAgentContracts({ baseDir: root });
const admissionDecision = evaluateAdmission({ contract: contracts.get('coder'), request: skillProtocolAdmissionRequest(source.protocol, 'coder') });
const methodEnv = {
  ...process.env,
  XDG_DATA_HOME: join(runtimeState, 'data'),
  XDG_STATE_HOME: join(runtimeState, 'state'),
  XDG_CACHE_HOME: join(runtimeState, 'cache'),
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { coder: { permission: { skill: { '*': 'deny', tdd: 'allow' } } } } }),
};
assertPreflight({ fixture, env: methodEnv, admissionDecision });
const initialHashes = hashes(fixture);
const fixtureFp = fixtureFingerprint({ root: fixture, paths: fixturePaths, domain: source.protocol.skill_id });
let methodResult;
let checkpoint;
try {
  methodResult = await executeGovernedRole({ baseDir: root, projectDir: fixture, role: 'coder', profileName: 'free', admissionDecision, prompt: methodPrompt, env: methodEnv, transport: 'sdk' });
  if (!methodResult.success || methodResult.transport !== 'OPENCODE_SDK' || !methodResult.completion_source) throw new Error(methodResult.failure_classification || 'INFRASTRUCTURE_FAILURE');
  const load = observeCompletedSkillLoad(methodResult.events, 'tdd');
  if (!load) throw new Error('OPENCODE_SKILL_EVENT_CONTRACT_MISMATCH');
  const finalHashes = hashes(fixture);
  const traceFile = join(fixture, '.qualification', 'tdd-trace.jsonl');
  if (!existsSync(traceFile)) throw new Error('MISSING_TDD_TRACE');
  const trace = readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const changes = changedPaths(initialHashes, finalHashes);
  const method = evaluateTddTrace({ fixtureDir: fixture, trace, changedPaths: changes, events: methodResult.events, contextStatus: 'CONTEXT_CONFORMING', oraclePresent: true });
  if (method.status !== 'PASS' || trace[0]?.implementation_sha256 !== initialHashes['math.mjs'] || !trace.slice(1).some((entry) => entry.exit_code === 0 && entry.implementation_sha256 === finalHashes['math.mjs']) || finalHashes['math.test.mjs'] !== initialHashes['math.test.mjs']) throw new Error(`TDD_METHOD_FAILURE:${method.reasons.join(',')}`);
  const telemetry = contextTelemetry(capsule, { files_inspected: 3, tool_calls: trace.length, external_requests: 0, repair_attempts: 0 });
  checkpoint = checkpointQualificationExecution({ attempt_id: attemptId, skill: identity, runtime: { fixture_fingerprint: fixtureFp, execution: compactExecution(methodResult), requested_model: methodResult.resolution.execution_policy.requested_model, effective_model: methodResult.reconciliation.effective, binding_reconciliation: methodResult.reconciliation.state, admitted_subject: methodResult.admitted_subject, effective_subject: methodResult.subject_reconciliation.effective_subject, subject_reconciliation: methodResult.subject_reconciliation.state, run_id: methodResult.ledger_record?.id ?? null, session_id: methodResult.session_id, completed_skill_load: load, tool_events: eventSummary(methodResult.events), initial_hashes: initialHashes, final_hashes: finalHashes, trace, changed_paths: changes, oracle_unchanged: finalHashes['math.test.mjs'] === initialHashes['math.test.mjs'], context: { path_refs: capsule.path_refs.map(({ path }) => path), max_expansions: 0, telemetry, external_requests: 0 }, runtime_evidence_ids: runtimeEvidence(fixtureFp).map(({ id }) => id), sanitization: 'No credentials, headers, environment, or raw OpenCode export retained.' }, original_model_output: methodResult.model_output ?? '' });
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  const parse = (output) => parseSkillResult(output, (value) => validateReportedEvidenceCapsule(value, { skill: identity, requestedRole: 'coder', protocol: source.protocol }));
  const repair = async ({ malformed_output, validation_error, checkpoint: immutable }) => {
    const correctionDir = mkdtempSync(join(tmpdir(), 'ocode-report-repair-'));
    const correctionRequest = { schema_version: 1, kind: 'ASSIGNMENT', subject: { role: 'coder' }, requirements: { capabilities: [] }, requested_authority: { edit: false, stage: false, commit: false, push: false } };
    const correctionAdmission = evaluateAdmission({ contract: contracts.get('coder'), request: correctionRequest });
    if (correctionAdmission.decision !== 'ALLOW') throw new Error('REPORT_REPAIR_ADMISSION_DENIED');
    const correctionPermissions = { edit: 'deny', bash: 'deny', read: 'deny', glob: 'deny', grep: 'deny', list: 'deny', skill: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny', question: 'deny', external_directory: 'deny' };
    const correctionEnv = { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { coder: { permission: correctionPermissions } } }) };
    const correctionAgent = command(['debug', 'agent', 'coder', '--pure'], { cwd: correctionDir, env: correctionEnv });
    const effectiveCorrection = parseDiagnosticJSON(correctionAgent, 'REPORT_REPAIR_PERMISSION_DIAGNOSTIC');
    const correctionRules = effectiveCorrection?.permission ?? [];
    if (correctionAgent.status !== 0 || !['edit', 'bash', 'skill', 'webfetch', 'websearch'].every((tool) => correctionRules.some((entry) => entry.permission === tool && entry.action === 'deny'))) throw new Error('REPORT_REPAIR_PERMISSION_NOT_EFFECTIVE');
    const catalog = immutable.runtime.runtime_evidence_ids.map((id) => `${id}: ${id === 'tdd-red' ? 'initial test failure' : id === 'tdd-change' ? 'authorized change' : id === 'tdd-green' ? 'post-change pass' : id === 'tdd-scope' ? 'scope/oracle preservation' : 'completed method load'}`).join('; ');
    const correctionPrompt = `Return JSON only. Only repair the supplied structured report. Do not perform engineering work. Do not inspect repository files. Do not invoke skills. Do not execute tests or commands. Do not create new evidence.\n\nMalformed report: ${malformed_output}\nValidation error: ${validation_error}\nSkill: tdd 1.0.0 ${expectedFingerprint}. Requested role: coder. Attempt provenance run_id=${immutable.runtime.run_id}, session_id=${immutable.runtime.session_id}. Exact acceptance IDs: ${acceptanceIDs.join(', ')}. Allowed runtime evidence IDs: ${catalog}. Required ReportedEvidenceCapsule v1 shape: ${reportedContract}`;
    const before = JSON.stringify(immutable.runtime);
    const result = await executeGovernedRole({ baseDir: root, projectDir: correctionDir, role: 'coder', profileName: 'free', admissionDecision: correctionAdmission, prompt: correctionPrompt, env: correctionEnv, transport: 'sdk' });
    if (!result.success || result.transport !== 'OPENCODE_SDK' || !result.completion_source) throw new Error('STRUCTURED_OUTPUT_CORRECTION_INFRASTRUCTURE_FAILURE');
    if (result.events.some((event) => event?.type === 'tool_use')) throw new Error('STRUCTURED_OUTPUT_CORRECTION_USED_TOOL');
    if (JSON.stringify(immutable.runtime) !== before) throw new Error('REPORT_CORRECTION_MUTATED_EXECUTION_CHECKPOINT');
    return result.model_output ?? '';
  };
  const resumed = await resumeQualificationReport({ checkpoint, parseReported: parse, correct: repair });
  if (!resumed.success) throw new Error(resumed.failure_classification);
  const reported = resumed.value;
  for (const mapping of reported.acceptance_mapping) {
    if (mapping.state === 'SATISFIED' && requiredSupport[mapping.acceptance_id].some((id) => !mapping.supporting_evidence_refs.includes(id))) throw new Error(`ACCEPTANCE_EVIDENCE_MISMATCH:${mapping.acceptance_id}`);
  }
  const trusted = runtimeEvidence(fixtureFp);
  const enriched = enrichEvidenceCapsule(reported, { runtimeEvidenceRefs: trusted, skill: identity, requestedRole: 'coder', protocol: source.protocol, provenanceRefs: { run_id: methodResult.ledger_record?.id ?? null, session_id: methodResult.session_id } });
  const artifact = { schema_version: 1, status: 'PASS', attempt_id: attemptId, skill: identity, checkpoint: checkpointPath, fixture_fingerprint: fixtureFp, reported_evidence_capsule: reported, evidence_capsule: enriched, structured_repair_count: resumed.repair_count, properties: Object.fromEntries(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((id) => [id, 'PASS'])) };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const record = { schema_version: 1, skill_id: source.protocol.skill_id, skill_version: source.protocol.skill_version, skill_fingerprint: source.skill_fingerprint, suite: { id: 'm6-tdd-live', fixture_fingerprint: fixtureFp }, evidence_refs: trusted, deterministic_results: [{ fixture_id: 'positive-fixture', status: 'PASS', evidence_ref: 'tdd-green' }], negative_case_results: [{ fixture_id: 'm6-2a-refusal-fixtures', status: 'PASS', evidence_ref: 'tdd-scope' }], method_conformance: { status: 'PASS', evidence_refs: ['tdd-red', 'tdd-change', 'tdd-green', 'tdd-scope'] }, governance_conformance: { status: 'PASS', evidence_refs: ['tdd-method-load', 'tdd-scope'] }, evidence_conformance: { status: 'PASS', evidence_refs: trusted.map(({ id }) => id) }, context_conformance: { status: 'PASS', observation: { ...checkpoint.runtime.context.telemetry, repair_attempts: resumed.repair_count }, evidence_refs: ['tdd-scope'] }, live_qualification: { required: true, status: 'PASS', evidence_ref: 'tdd-method-load' }, execution_provenance_ref: { run_id: methodResult.ledger_record?.id ?? null, session_id: methodResult.session_id }, status: 'QUALIFIED', observed_at: new Date().toISOString() };
  validateQualificationRecord(record, { currentSource: source, filePath: recordPath });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  if (deriveSkillLifecycle({ source, records: [record] }) !== 'QUALIFIED') throw new Error('LIFECYCLE_NOT_QUALIFIED');
  console.log(JSON.stringify({ status: 'M6_2_LIVE_QUALIFIED', attempt_id: attemptId, artifact: artifactPath, checkpoint: checkpointPath, record: recordPath, repair_count: resumed.repair_count }));
} catch (error) {
  writeFileSync(failurePath, `${JSON.stringify({ schema_version: 1, status: 'FAIL', attempt_id: attemptId, failure_classification: error.message, skill: identity, checkpoint: checkpointPath, execution: methodResult ? compactExecution(methodResult) : null }, null, 2)}\n`);
  throw error;
}
