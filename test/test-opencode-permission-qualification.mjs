import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = JSON.parse(readFileSync(resolve('qualification/opencode-1.18.21-permissions.json'), 'utf8'));
assert.deepEqual(evidence.runtime, { opencode: '1.18.21', sdk: '1.18.21' });
assert.equal(evidence.method, 'local OpenAI-compatible non-inference fixture through installed SDK/server');
const scenario = (id) => {
  const found = evidence.scenarios.find((entry) => entry.id === id);
  assert(found, `missing permission scenario ${id}`);
  return found;
};

assert.equal(scenario('exact-allow').permission_request_count, 0);
assert.equal(scenario('explicit-no-match-ask').permission_request_count, 1);
assert.equal(scenario('no-match-default').permission_request_count, 0);
assert.equal(scenario('conflict-last-allow').tool_states.at(-1), 'completed');
assert.equal(scenario('conflict-last-deny').tool_states.at(-1), 'error');
for (const id of ['composition-and', 'composition-or', 'composition-pipe', 'composition-redirection', 'composition-substitution', 'composition-backticks']) {
  assert.equal(scenario(id).permission_request_count, 1, id);
}
assert.equal(scenario('wildcard-composition-redirection').marker_created, true);
assert.equal(scenario('wildcard-redirection-denied').marker_created, false);
assert.equal(scenario('wildcard-redirection-denied').tool_states.at(-1), 'error');
assert.equal(scenario('reply-once-scope').permission_request_count, 2);
assert.equal(scenario('reply-always-scope').permission_request_count, 1);
assert.equal(scenario('reply-reject').tool_states.at(-1), 'error');
assert.equal(scenario('admitted-validation').permission_request_count, 0);
assert.equal(scenario('remote-deny').permission_request_count, 0);
assert.equal(scenario('remote-deny').tool_states.at(-1), 'error');
assert.equal(scenario('low-interruption-loop').permission_request_count, 0);
assert.equal(scenario('low-interruption-loop').tool_states.filter((state) => state === 'completed').length, 4);
console.log('OPENCODE_1_18_21_PERMISSION_QUALIFICATION_PROVEN');
