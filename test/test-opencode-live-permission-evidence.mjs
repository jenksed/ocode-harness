import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evidence = JSON.parse(readFileSync('qualification/opencode-1.18.21-permissions.json', 'utf8'));
const scenarios = new Map(evidence.scenarios.filter(({ id }) => id.startsWith('pass3-')).map((entry) => [entry.id, entry]));
assert(scenarios.size >= 18, `expected retained Pass-3 records, found ${scenarios.size}`);
const ask = scenarios.get('pass3-coder-workspace-ask');
assert.equal(ask?.evidence_status, 'PASS');
assert.equal(ask?.observed_disposition, 'ASK');
assert.ok(ask.permission_events?.some((event) => event.type === 'permission.asked' || event.type === 'permission.updated'));
for (const id of ['pass3-coder-git-forbidden', 'pass3-coder-transitive-deny', 'pass3-reviewer-mutation-deny']) {
  const entry = scenarios.get(id);
  assert(entry, `missing ${id}`);
  assert.equal(entry.observed_disposition, 'DENY');
  assert.equal(entry.evidence_status, 'PASS');
}
for (const entry of scenarios.values()) {
  assert.ok(entry.role && entry.expected_effect && entry.expected_disposition, `${entry.id} lacks evidence contract fields`);
  assert.ok(entry.terminal_status, `${entry.id} lacks terminal status`);
}
console.log('LIVE_PERMISSION_EVIDENCE_CONTRACT_PROVEN');
