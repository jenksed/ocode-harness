import { validateSkillProtocol } from './skill-contract.mjs';

const REQUIRED_NEGATIVES = Object.freeze(['method-violation','authority-capability','evidence-integrity','wrong-method','refusal','context-economy']);

export function evaluateDeterministicSkillFixture({ source, fixture }) {
  const protocol = validateSkillProtocol(source.protocol);
  if (fixture.schema_version !== 1 || fixture.skill_id !== protocol.skill_id) throw new Error('fixture identity mismatch');
  const acceptance = protocol.acceptance.map((item) => item.id).sort();
  const observed = [...(fixture.positive?.observed_acceptance ?? [])].sort();
  if (JSON.stringify(observed) !== JSON.stringify(acceptance)) throw new Error('positive fixture does not close protocol acceptance');
  const evidence = new Set(fixture.positive?.runtime_evidence_ids ?? []);
  if (!evidence.size) throw new Error('positive fixture requires runtime evidence');
  const mapped = new Set();
  for (const mapping of fixture.positive?.acceptance_mapping ?? []) {
    if (!acceptance.includes(mapping.acceptance_id) || !mapping.evidence_ids?.length || mapping.evidence_ids.some((id) => !evidence.has(id))) throw new Error('positive fixture has untrusted acceptance evidence');
    if (mapped.has(mapping.acceptance_id)) throw new Error('positive fixture duplicates acceptance mapping');
    mapped.add(mapping.acceptance_id);
  }
  if (mapped.size !== acceptance.length) throw new Error('positive fixture acceptance mapping is not closed');
  if (fixture.positive.mutated !== false) throw new Error('read-only deterministic fixture mutated source');
  const context = fixture.positive.context;
  if (!context || context.expansions !== 0 || context.external_requests !== 0 || context.inspected_paths > context.supplied_paths) throw new Error('context economy violation');
  const negatives = new Map((fixture.negative_cases ?? []).map((item) => [item.kind, item]));
  for (const kind of REQUIRED_NEGATIVES) {
    const item = negatives.get(kind);
    if (!item || !['REFUSE','FAIL_CLOSED'].includes(item.outcome) || !item.reason) throw new Error(`missing fail-closed negative: ${kind}`);
  }
  if (protocol.qualification_requirements.live_qualification !== 'REQUIRED') throw new Error('production skill must require live qualification');
  return Object.freeze({ status:'PASS', skill_id:protocol.skill_id, acceptance_ids:Object.freeze(acceptance), negative_kinds:Object.freeze(REQUIRED_NEGATIVES), context:Object.freeze({...context}) });
}
