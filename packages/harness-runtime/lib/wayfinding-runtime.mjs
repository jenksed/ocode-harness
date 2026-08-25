import { ADMISSION_KINDS, ADMISSION_REQUEST_SCHEMA_VERSION, evaluateAdmission } from './admission.mjs';
import { loadAgentContracts } from './agent-contract.mjs';
import { executeGovernedRole } from './execution.mjs';
import { validateWayfindingRequest, validateWayfindingResult } from './wayfinding.mjs';

export function buildWayfindingPrompt(request, correction = null) {
  const input = validateWayfindingRequest(request);
  const context = { objective: input.objective, constraints: input.constraints, evidence: input.available_evidence, exploration_budget: input.exploration_budget };
  return correction
    ? `Return ONLY valid WayfindingResult JSON. Previous validation error: ${correction}. Context: ${JSON.stringify(context)}`
    : `Assess planning readiness. Return ONLY valid WayfindingResult JSON; do not create a task graph. Context: ${JSON.stringify(context)}`;
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
  const first = invoke({ ...options, role: 'wayfinder', admissionDecision, prompt: buildWayfindingPrompt(request) });
  if (!first.success) return { ...first, wayfinding_result: null, repair_count: 0 };
  try { return { ...first, wayfinding_result: parseWayfindingResult(first.model_output ?? first.execution.stdout), repair_count: 0 }; }
  catch (error) {
    const second = invoke({ ...options, role: 'wayfinder', admissionDecision, prompt: buildWayfindingPrompt(request, error.message) });
    if (!second.success) return { ...second, wayfinding_result: null, repair_count: 1 };
    try { return { ...second, wayfinding_result: parseWayfindingResult(second.model_output ?? second.execution.stdout), repair_count: 1 }; }
    catch (secondError) { return { ...second, success: false, failure_classification: 'STRUCTURED_OUTPUT_INVALID', wayfinding_result: null, structured_output_error: secondError.message, repair_count: 1 }; }
  }
}
