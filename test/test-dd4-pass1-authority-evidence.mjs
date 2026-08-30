import assert from 'node:assert/strict';
import {
  createExecutionAuthority, createEffectRequest, createGitObjectId,
  executeEffectRequest, ingestEffectEvidence,
} from '../packages/harness-runtime/lib/authority-evidence.mjs';

const authority = createExecutionAuthority({ authority_id: 'dd4-pass-1', effects: ['git.observe_head'] });
const request = createEffectRequest({ authority, request_id: 'observe-head', effect: 'git.observe_head' });
const claim = { request_id: request.request_id, claim: 'HEAD = dd5f4218a3b9c7e5d4a1f6b32d8e7c5a0f9n4m21' };

// Negative A: prose alone cannot create effect evidence or acceptance.
assert.throws(() => ingestEffectEvidence({ request, report: claim }), /runtime provenance/);

// Negative B: a plausible JSON-shaped receipt has no private runtime provenance.
const forgedReceipt = { request_id: request.request_id, authority_id: authority.authority_id, effect: request.effect, success: true, exit_code: 0, observation: { kind: 'git.head', object_id: { value: 'a'.repeat(40) } } };
assert.throws(() => ingestEffectEvidence({ request, receipt: forgedReceipt, report: claim }), /runtime provenance/);

// Negative C: malformed Git-shaped text cannot become the typed observation.
assert.throws(() => createGitObjectId('dd5f4218a3b9c7e5d4a1f6b32d8e7c5a0f9n4m21'), /40- or 64-character/);

// Positive: execute the real, read-only Git substrate and ingest its receipt.
const receipt = executeEffectRequest(request, { cwd: process.cwd() });
assert.equal(receipt.success, true);
const accepted = ingestEffectEvidence({ request, receipt, report: { request_id: request.request_id, claim: `HEAD = ${receipt.observation.object_id.value}` } });
assert.equal(accepted.state, 'SATISFIED');
assert.equal(accepted.evidence.origin, 'DETERMINISTIC_RUNTIME');
assert.match(accepted.evidence.object_id, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
console.log('DD4_PASS_1_AUTHORITY_EVIDENCE_PROVEN');
