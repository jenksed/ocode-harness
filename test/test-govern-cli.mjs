import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendRecord, createLedgerRecord } from '../packages/harness-runtime/lib/ledger.mjs';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { activityStorePath, appendActivityEvent, createActivityEvent } from '../packages/harness-runtime/lib/activity.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repoRoot, 'packages/harness-runtime/bin/ocode.mjs');
const projectRoot = mkdtempSync(join(tmpdir(), 'ocode-govern-cli-'));
const { manifest } = loadAgentContracts({ baseDir: repoRoot });
function invoke(args) { return spawnSync(process.execPath, [cli, ...args], { cwd: projectRoot, env: { ...process.env, OCODE_HARNESS_ROOT: repoRoot }, encoding: 'utf8' }); }

try {
  const explain = invoke(['govern', 'explain', 'coder']);
  assert.equal(explain.status, 0, explain.stderr);
  assert.match(explain.stdout, /CAPABILITIES\n.*implementation\.change/);
  assert.match(explain.stdout, /AUTHORITY\nedit=true, stage=false, commit=false, push=false/);
  assert.match(explain.stdout, /PERMISSION PROJECTION/);
  assert.match(explain.stdout, /BASELINE \/ CONTRACT ADMISSION\nALLOW/);
  assert.match(explain.stdout, /GOVERNANCE STATE\nVALID/);
  console.log('✓ govern explain renders the canonical contract and provenance-bearing projection');

  const allow = invoke(['govern', 'check', 'coder', '--requires', 'implementation.change,repository.edit,test.execute', '--edit']);
  assert.equal(allow.status, 0, allow.stderr);
  assert.match(allow.stdout, /DECISION\nALLOW/);
  assert.match(allow.stdout, /PERMISSION EVALUATION\nPASS/);
  const deny = invoke(['govern', 'check', 'reviewer', '--edit']);
  assert.equal(deny.status, 1);
  assert.match(deny.stdout, /DECISION\nDENY/);
  assert.match(deny.stdout, /AUTHORITY_INSUFFICIENT/);
  console.log('✓ govern check uses the shared AdmissionRequest and AdmissionDecision engine');
  const baselineCheck = invoke(['govern', 'check', 'coder']);
  assert.equal(baselineCheck.status, 0, baselineCheck.stderr);
  assert.match(baselineCheck.stdout, /DECISION\nALLOW/);

  const audit = invoke(['govern', 'audit']);
  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /ROLE\s+IDENTITY\s+GOVERNANCE\s+ADMISSION/);
  const roleLines = audit.stdout.split('\n').filter((line) => /\s+(VALID)\s+ALLOW$/.test(line));
  assert.equal(roleLines.length, manifest.roles.length, audit.stdout);
  assert.match(audit.stdout, /committer.*VALID\s+ALLOW/);
  console.log('✓ govern audit is manifest-derived and evaluates every baseline role through production governance');

  mkdirSync(join(projectRoot, '.opencode'), { recursive: true });
  const record = createLedgerRecord({ run_id: '33333333-3333-4333-8333-333333333333', project_name: 'govern-cli-fixture', project_root: projectRoot, execution_provenance: {
    schema_version: 1, subject: { role: 'reviewer', contract_fingerprint: 'a'.repeat(64) },
    execution_policy: { profile: 'free', policy_version: 1, profile_fingerprint: 'b'.repeat(64), requested_model: 'freellmapi/auto:review', binding_source: 'profiles/free.json', fallback: 'deny' },
    effective_model: 'freellmapi/auto:review', binding_reconciliation: 'MATCH', admitted_subject: 'reviewer', effective_subject: 'reviewer', subject_reconciliation: 'MATCH', subject_reason_code: 'SUBJECT_MATCH', success: true, failure_classification: null,
  }});
  appendRecord(join(projectRoot, '.opencode', 'run-ledger.jsonl'), record);
  const runExplanation = invoke(['explain', '--run', record.run_id]);
  assert.equal(runExplanation.status, 0, runExplanation.stderr);
  assert.match(runExplanation.stdout, /ADMITTED SUBJECT\nreviewer/);
  assert.match(runExplanation.stdout, /EFFECTIVE SUBJECT\nreviewer/);
  assert.match(runExplanation.stdout, /SUBJECT RECONCILIATION\nMATCH/);
  assert.match(runExplanation.stdout, /SUBJECT REASON\nSUBJECT_MATCH/);
  console.log('✓ run explanation renders independent M3 binding and M4D subject provenance');
  appendActivityEvent(activityStorePath(projectRoot), createActivityEvent({
    event_type: 'WORKFLOW_STARTED', workflow_id: 'cli-observable-workflow', agent_role: 'orchestrator', agent_instance_id: 'cli-orchestrator', status: 'STARTED', summary: 'Fixture runtime workflow',
  }));
  appendActivityEvent(activityStorePath(projectRoot), createActivityEvent({
    event_type: 'AGENT_STARTED', workflow_id: 'cli-observable-workflow', agent_role: 'orchestrator', agent_instance_id: 'cli-orchestrator', status: 'STARTED', summary: 'Fixture runtime agent',
  }));
  const activity = invoke(['activity', '--workflow', 'cli-observable-workflow']);
  assert.equal(activity.status, 0, activity.stderr);
  assert.match(activity.stdout, /OCODE WORK/);
  assert.match(activity.stdout, /Orchestrator/);
  const rawActivity = invoke(['activity', '--raw', '--workflow', 'cli-observable-workflow']);
  assert.equal(rawActivity.status, 0, rawActivity.stderr);
  assert.equal(rawActivity.stdout.trim().split('\n').length, 2);
  assert.match(rawActivity.stdout, /"workflow_id":"cli-observable-workflow"/);
  const traceActivity = invoke(['activity', '--trace', '--workflow', 'cli-observable-workflow']);
  assert.equal(traceActivity.status, 0, traceActivity.stderr);
  assert.match(traceActivity.stdout, /workflow=cli-observable-workflow/);
  const agents = invoke(['agents']);
  assert.equal(agents.status, 0, agents.stderr);
  assert.match(agents.stdout, /ROLE\s+STATUS\s+CURRENT/);
  assert.match(agents.stdout, /Orchestrator\s+active/);
  console.log('✓ activity CLI exposes human, trace, and raw runtime records; agents reports configured versus active roles');
  console.log(JSON.stringify({ status: 'GOVERN_CLI_TESTS_PROVEN', operator_surfaces: ['explain', 'check', 'audit', 'explain --run', 'activity', 'agents'] }));
} finally { rmSync(projectRoot, { recursive: true, force: true }); }
