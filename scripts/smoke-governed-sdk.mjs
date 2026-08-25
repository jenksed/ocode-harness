import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { evaluateAdmission } from '../packages/harness-runtime/lib/admission.mjs';
import { executeGovernedRole } from '../packages/harness-runtime/lib/execution.mjs';

const root = resolve('.');
const project = mkdtempSync(join(tmpdir(), 'ocode-sdk-smoke-'));
const { contracts } = loadAgentContracts({ baseDir: root });
const admission = evaluateAdmission({
  contract: contracts.get('coder'),
  request: {
    schema_version: 1,
    kind: 'ASSIGNMENT',
    subject: { role: 'coder' },
    requirements: { capabilities: [] },
    requested_authority: { edit: false, stage: false, commit: false, push: false },
  },
});
const permission = {
  edit: 'deny', bash: 'deny', read: 'deny', glob: 'deny', grep: 'deny', list: 'deny',
  skill: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny', question: 'deny',
  external_directory: 'deny',
};
const result = await executeGovernedRole({
  transport: 'sdk',
  baseDir: root,
  projectDir: project,
  role: 'coder',
  profileName: 'free',
  admissionDecision: admission,
  env: {
    ...process.env,
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { coder: { permission } } }),
  },
  prompt: 'Return exactly this JSON object and do nothing else: {"sdk_transport":"PASS"}',
});
console.log(JSON.stringify({
  transport: result.transport,
  completion_source: result.completion_source,
  termination: result.execution.termination,
  duration_ms: result.execution.duration_ms,
  event_count: result.events.length,
  session_id: result.session_id,
  model_output: result.model_output,
  binding: result.reconciliation.state,
  subject: result.subject_reconciliation.state,
  prompt_submissions: result.execution.prompt_submissions,
  cleanup: result.execution.cleanup,
  error: result.execution.spawn_error,
}));
if (!result.success || result.model_output !== '{"sdk_transport":"PASS"}') {
  throw new Error(`SDK_SMOKE_FAILED:${result.failure_classification ?? result.execution.spawn_error ?? 'OUTPUT_MISMATCH'}`);
}
console.log('SDK_EXECUTION_RETURNED');
