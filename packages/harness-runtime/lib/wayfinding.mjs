export const WAYFINDING_REQUEST_SCHEMA_VERSION = 1;
export const UNCERTAINTY_MAP_SCHEMA_VERSION = 1;
export const EVIDENCE_REF_SCHEMA_VERSION = 1;
export const WAYFINDING_RESULT_SCHEMA_VERSION = 1;
export const PLANNING_READINESS = Object.freeze(['READY_TO_PLAN', 'PLAN_PREMATURE', 'BLOCKED', 'ESCALATION_REQUIRED']);
export const EVIDENCE_FRESHNESS = Object.freeze(['CURRENT', 'POSSIBLY_STALE', 'STALE', 'UNKNOWN']);
export const EVIDENCE_LADDER = Object.freeze(['ACCEPTED_CURRENT', 'LOCAL_FACT', 'CHEAP_INSPECTION', 'FOCUSED_DETERMINISTIC', 'BROADER_INVESTIGATION', 'EXTERNAL_RESEARCH', 'ESCALATION']);

const object = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value; };
const string = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`); return value; };
const array = (value, label) => { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value; };
const only = (value, fields, label) => { for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`Unknown ${label} field: ${key}`); };
const ids = (items, label) => { const seen = new Set(); for (const item of items) { string(item.id, `${label}.id`); if (seen.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`); seen.add(item.id); } return seen; };

export function validateWayfindingRequest(value) {
  object(value, 'WayfindingRequest'); only(value, ['schema_version', 'objective', 'constraints', 'available_evidence', 'exploration_budget'], 'WayfindingRequest');
  if (value.schema_version !== WAYFINDING_REQUEST_SCHEMA_VERSION) throw new Error('WayfindingRequest schema_version must be 1');
  string(value.objective, 'WayfindingRequest objective'); array(value.constraints, 'WayfindingRequest constraints'); array(value.available_evidence, 'WayfindingRequest available_evidence');
  return { ...value, constraints: [...value.constraints], available_evidence: value.available_evidence.map(validateEvidenceRef), exploration_budget: validateExplorationBudget(value.exploration_budget) };
}

export function validateEvidenceRef(value) {
  object(value, 'EvidenceRef'); only(value, ['schema_version', 'id', 'kind', 'claim', 'source', 'dependency_scope', 'observed_at', 'freshness', 'dependency_fingerprints'], 'EvidenceRef');
  if (value.schema_version !== EVIDENCE_REF_SCHEMA_VERSION) throw new Error('EvidenceRef schema_version must be 1');
  for (const field of ['id', 'kind', 'claim', 'source', 'observed_at']) string(value[field], `EvidenceRef ${field}`);
  if (!EVIDENCE_FRESHNESS.includes(value.freshness)) throw new Error('EvidenceRef freshness is invalid');
  array(value.dependency_scope, 'EvidenceRef dependency_scope'); if (!value.dependency_scope.length) throw new Error('EvidenceRef dependency_scope must not be empty');
  value.dependency_scope.forEach((scope) => string(scope, 'EvidenceRef dependency scope'));
  object(value.dependency_fingerprints, 'EvidenceRef dependency_fingerprints');
  return { ...value, dependency_scope: [...value.dependency_scope].sort(), dependency_fingerprints: { ...value.dependency_fingerprints } };
}

export function assessEvidenceFreshness(ref, currentDependencyFingerprints) {
  const evidence = validateEvidenceRef(ref); object(currentDependencyFingerprints, 'currentDependencyFingerprints');
  const changed = evidence.dependency_scope.some((scope) => currentDependencyFingerprints[scope] !== undefined && currentDependencyFingerprints[scope] !== evidence.dependency_fingerprints[scope]);
  return changed ? 'POSSIBLY_STALE' : evidence.freshness;
}

export function validateExplorationBudget(value) {
  object(value, 'ExplorationBudget'); only(value, ['max_rounds', 'max_evidence_requests', 'max_external_requests', 'rounds_used', 'evidence_requests_used', 'external_requests_used'], 'ExplorationBudget');
  for (const field of ['max_rounds', 'max_evidence_requests', 'max_external_requests', 'rounds_used', 'evidence_requests_used', 'external_requests_used']) if (!Number.isInteger(value[field]) || value[field] < 0) throw new Error(`ExplorationBudget ${field} must be a non-negative integer`);
  return { ...value };
}
export function explorationExhausted(value) { const budget = validateExplorationBudget(value); return (budget.max_rounds > 0 && budget.rounds_used >= budget.max_rounds) || (budget.max_evidence_requests > 0 && budget.evidence_requests_used >= budget.max_evidence_requests) || (budget.max_external_requests > 0 && budget.external_requests_used >= budget.max_external_requests); }

function validateUnknown(value) { object(value, 'unknown'); only(value, ['id', 'question', 'impact', 'blocking', 'state', 'evidence_needed'], 'unknown'); for (const f of ['id', 'question', 'impact', 'state', 'evidence_needed']) string(value[f], `unknown ${f}`); if (typeof value.blocking !== 'boolean') throw new Error('unknown blocking must be boolean'); return { ...value }; }
function validateRequest(value) { object(value, 'evidence request'); only(value, ['id', 'question', 'preferred_evidence_kind', 'dependency_scope', 'why_needed', 'blocks'], 'evidence request'); for (const f of ['id', 'question', 'preferred_evidence_kind', 'why_needed']) string(value[f], `evidence request ${f}`); array(value.dependency_scope, 'evidence request dependency_scope'); array(value.blocks, 'evidence request blocks'); return { ...value }; }
function validateRoute(value) { object(value, 'route alternative'); only(value, ['id', 'assumptions', 'supporting_evidence', 'missing_evidence', 'invalidated_by', 'tradeoffs'], 'route alternative'); string(value.id, 'route alternative id'); for (const f of ['assumptions', 'supporting_evidence', 'missing_evidence', 'invalidated_by', 'tradeoffs']) array(value[f], `route alternative ${f}`); return { ...value }; }

export function validateWayfindingResult(value) {
  object(value, 'WayfindingResult'); only(value, ['schema_version', 'uncertainty_map', 'planning_readiness', 'evidence_requests', 'route_alternatives', 'recommended_route', 'exit_conditions', 'exploration_budget'], 'WayfindingResult');
  if (value.schema_version !== WAYFINDING_RESULT_SCHEMA_VERSION) throw new Error('WayfindingResult schema_version must be 1');
  const map = object(value.uncertainty_map, 'UncertaintyMap'); only(map, ['schema_version', 'objective', 'knowns', 'unknowns', 'blocking_unknowns', 'evidence_refs', 'decision_points', 'planning_status', 'exit_conditions'], 'UncertaintyMap');
  if (map.schema_version !== UNCERTAINTY_MAP_SCHEMA_VERSION) throw new Error('UncertaintyMap schema_version must be 1'); string(map.objective, 'UncertaintyMap objective'); array(map.knowns, 'UncertaintyMap knowns'); const unknowns = array(map.unknowns, 'UncertaintyMap unknowns').map(validateUnknown); const unknownIds = ids(unknowns, 'unknown'); const blocking = array(map.blocking_unknowns, 'UncertaintyMap blocking_unknowns'); blocking.forEach((id) => { if (!unknownIds.has(id)) throw new Error(`blocking unknown is not defined: ${id}`); });
  const evidence = array(map.evidence_refs, 'UncertaintyMap evidence_refs').map(validateEvidenceRef); const evidenceIds = ids(evidence, 'EvidenceRef'); array(map.knowns, 'UncertaintyMap knowns').forEach((known) => { object(known, 'known'); string(known.claim, 'known claim'); if (known.evidence_ref && !evidenceIds.has(known.evidence_ref)) throw new Error('known references missing evidence'); });
  if (!PLANNING_READINESS.includes(value.planning_readiness)) throw new Error('PlanningReadinessDecision is invalid'); if (map.planning_status !== value.planning_readiness) throw new Error('UncertaintyMap planning_status must match PlanningReadinessDecision');
  const requests = array(value.evidence_requests, 'WayfindingResult evidence_requests').map(validateRequest); ids(requests, 'evidence request'); const routes = array(value.route_alternatives, 'WayfindingResult route_alternatives').map(validateRoute); const routeIds = ids(routes, 'route alternative');
  if (value.recommended_route !== null && !routeIds.has(value.recommended_route)) throw new Error('recommended_route must name a route alternative'); array(value.exit_conditions, 'WayfindingResult exit_conditions'); validateExplorationBudget(value.exploration_budget);
  if (value.planning_readiness === 'READY_TO_PLAN' && blocking.length) throw new Error('READY_TO_PLAN cannot have blocking unknowns');
  if (value.planning_readiness === 'PLAN_PREMATURE' && (!blocking.length || !requests.length)) throw new Error('PLAN_PREMATURE requires blocking uncertainty and evidence requests');
  if (value.planning_readiness === 'BLOCKED' && !value.exit_conditions.length) throw new Error('BLOCKED requires a blocking cause');
  if (value.planning_readiness === 'ESCALATION_REQUIRED' && !value.exit_conditions.length) throw new Error('ESCALATION_REQUIRED requires an unresolved reason');
  if (explorationExhausted(value.exploration_budget) && value.planning_readiness === 'PLAN_PREMATURE') throw new Error('exhausted exploration cannot remain PLAN_PREMATURE');
  return value;
}

export function preferredEvidenceKind(availableEvidence = []) { const current = availableEvidence.map(validateEvidenceRef).find((item) => item.freshness === 'CURRENT'); return current ? 'ACCEPTED_CURRENT' : 'LOCAL_FACT'; }
