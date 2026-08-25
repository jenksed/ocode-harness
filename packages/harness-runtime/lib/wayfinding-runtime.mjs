import { ADMISSION_KINDS, ADMISSION_REQUEST_SCHEMA_VERSION, evaluateAdmission } from './admission.mjs';
import { loadAgentContracts } from './agent-contract.mjs';
import { executeGovernedRole } from './execution.mjs';
import { validateWayfindingRequest, validateWayfindingResult } from './wayfinding.mjs';

export const WAYFINDING_RESULT_PROMPT_CONTRACT = `Return exactly this WayfindingResult v1 JSON shape (no extra fields): {"schema_version":1,"uncertainty_map":{"schema_version":1,"objective":"...","knowns":[],"unknowns":[],"blocking_unknowns":[],"evidence_refs":[],"decision_points":[],"planning_status":"READY_TO_PLAN","exit_conditions":[]},"planning_readiness":"READY_TO_PLAN","evidence_requests":[],"route_alternatives":[],"recommended_route":null,"exit_conditions":[],"exploration_budget":{"max_rounds":1,"max_evidence_requests":1,"max_external_requests":0,"rounds_used":0,"evidence_requests_used":0,"external_requests_used":0}}. planning_readiness and uncertainty_map.planning_status must match and be READY_TO_PLAN, PLAN_PREMATURE, BLOCKED, or ESCALATION_REQUIRED. READY_TO_PLAN has no blocking_unknowns; PLAN_PREMATURE requires blocking unknowns and evidence_requests; BLOCKED and ESCALATION_REQUIRED require exit_conditions.`;

export function buildWayfindingPrompt(request, correction = null) {
  const input = validateWayfindingRequest(request);
  const context = { objective: input.objective, constraints: input.constraints, evidence: input.available_evidence, exploration_budget: input.exploration_budget };
  return correction
    ? `${WAYFINDING_RESULT_PROMPT_CONTRACT} Previous validation error: ${correction}. Context: ${JSON.stringify(context)}`
    : `Assess planning readiness; do not create a task graph. ${WAYFINDING_RESULT_PROMPT_CONTRACT} Context: ${JSON.stringify(context)}`;
}
export function parseWayfindingResult(raw) {
  const start = String(raw).indexOf('{');
  if (start < 0) throw new Error('STRUCTURED_OUTPUT_INVALID: no JSON object');
  let value; try { value = JSON.parse(String(raw).slice(start)); } catch { throw new Error('STRUCTURED_OUTPUT_INVALID: malformed JSON'); }
  try { return validateWayfindingResult(value); } catch (error) { throw new Error(`STRUCTURED_OUTPUT_INVALID: ${error.message}`); }
}
export function wayfinderAdmission(contract) {
  return evaluateAdmission({ contract, request: { schema_version: ADMISSION_REQUEST_SCHEMA_VERSION, kind: ADMISSION_KINDS.ASSIGNMENT, subject: { role: 'wayfinder' }, requirements: { capabilities: ['repository.read', 'uncertainty.assess'] }, requested_authority: { edit: false, stage: false, commit: false, push: false } } });
}
export function runWayfinding(options) {
  const request = validateWayfindingRequest(options.request);
  const { contracts } = loadAgentContracts({ baseDir: options.baseDir }); const contract = contracts.get('wayfinder');
  const admissionDecision = wayfinderAdmission(contract);
  if (admissionDecision.decision !== 'ALLOW') return { success: false, failure_classification: 'ADMISSION_DENY', admission_decision: admissionDecision, repair_count: 0 };
  const invoke = options.execute || executeGovernedRole;
  const invokeSafely = (prompt) => {
    try { return invoke({ ...options, role: 'wayfinder', admissionDecision, prompt }); }
    catch (error) { return { success: false, failure_classification: 'OPENCODE_PRE_EXECUTION_FAILURE', admission_decision: admissionDecision, runtime_diagnostics: { stage: 'pre_execution', error: error.message }, execution: null, session_id: null, export_result: null, ledger_record: null }; }
  };
  const first = invokeSafely(buildWayfindingPrompt(request));
  if (!first.success) return { ...first, wayfinding_result: null, repair_count: 0 };
  try { return { ...first, wayfinding_result: parseWayfindingResult(first.model_output ?? first.execution.stdout), repair_count: 0 }; }
  catch (error) {
    const second = invokeSafely(buildWayfindingPrompt(request, error.message));
    if (!second.success) return { ...second, wayfinding_result: null, repair_count: 1 };
    try { return { ...second, wayfinding_result: parseWayfindingResult(second.model_output ?? second.execution.stdout), repair_count: 1 }; }
    catch (secondError) { return { ...second, success: false, failure_classification: 'STRUCTURED_OUTPUT_INVALID', wayfinding_result: null, structured_output_error: secondError.message, repair_count: 1 }; }
  }
}
