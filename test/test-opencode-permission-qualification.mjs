import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectBashCommand } from '../packages/harness-runtime/lib/permission-projection.mjs';

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

const hookDenied = scenario('pre-execution-plugin-denies-before-native-ask');
assert.equal(hookDenied.permission_request_count, 0);
assert.equal(hookDenied.tool_states.at(-1), 'error');
assert.equal(hookDenied.plugin_events.find((event) => event.event === 'before')?.agent_from_chat_message, 'coder');
assert.equal(hookDenied.plugin_events.find((event) => event.event === 'before')?.agent_from_session_messages, 'coder');
assert.deepEqual(hookDenied.effect_after, hookDenied.effect_before);
const hookPassed = scenario('pre-execution-plugin-passes-to-native-ask');
assert.equal(hookPassed.permission_request_count, 1);
assert.equal(hookPassed.tool_results.at(-1).error, 'The user rejected permission to use this specific tool call.');

for (const id of [
  'production-guard-stage-alternates-before-native-ask',
  'production-guard-commit-alternates-before-native-ask',
  'production-guard-push-alternates-before-native-ask',
  'production-guard-child-stage-before-native-ask',
]) {
  const observed = scenario(id);
  assert.equal(observed.permission_request_count, 0, `${id} bypasses no native authority prompt`);
  assert.equal(observed.tool_states.filter((state) => state === 'error').length, observed.commands.length, `${id} rejects every governed call`);
  assert.deepEqual(observed.effect_after, observed.effect_before, `${id} leaves the governed fixture effect unchanged`);
  assert.equal(observed.tool_results.filter((entry) => entry.status === 'error').every((entry) => entry.error?.startsWith('OCODE_ROLE_EFFECT_DENIED\nrole: coder\n')), true, `${id} reports constitutional denial`);
}
const productionUnknown = scenario('production-guard-passes-unknown-command-to-native-ask');
assert.equal(productionUnknown.permission_request_count, 1);
assert.equal(productionUnknown.tool_results.at(-1).error, 'The user rejected permission to use this specific tool call.');

const runtimeParity = [
  ['orchestrator-git-status-observation', 'git status --short', 'ALLOW', 'completed'],
  ['interactive-source-orchestrator-git-status-observation', 'git status --short', 'ALLOW', 'completed'],
  ['interactive-source-orchestrator-git-rev-parse-observation', 'git rev-parse HEAD', 'ALLOW', 'completed'],
  ['interactive-source-orchestrator-git-branch-observation', 'git branch --show-current', 'ALLOW', 'completed'],
  ['interactive-source-orchestrator-git-worktree-observation', 'git worktree list', 'ALLOW', 'completed'],
  ['orchestrator-pwd-observation', 'pwd', 'ALLOW', 'completed'],
  ['orchestrator-ls-observation', 'ls', 'ALLOW', 'completed'],
  ['orchestrator-rg-observation', 'rg needle fixture.txt', 'ALLOW', 'completed'],
  ['orchestrator-grep-observation', 'grep needle fixture.txt', 'ALLOW', 'completed'],
  ['orchestrator-rev-parse-observation', 'git rev-parse HEAD', 'ALLOW', 'completed'],
  ['orchestrator-branch-observation', 'git branch --show-current', 'ALLOW', 'completed'],
  ['orchestrator-worktree-observation', 'git worktree list', 'ALLOW', 'completed'],
  ['orchestrator-git-add-denied', 'git add README.md', 'DENY', 'error'],
  ['interactive-source-orchestrator-git-add-denied', 'git add README.md', 'DENY', 'error'],
  ['orchestrator-git-commit-denied', 'git commit -m denied', 'DENY', 'error'],
  ['orchestrator-git-push-denied', 'git push origin main', 'DENY', 'error'],
  ['orchestrator-git-show-output-denied', 'git show --output=marker.txt HEAD', 'DENY', 'error'],
  ['orchestrator-git-diff-output-denied', 'git diff --output=marker.txt', 'DENY', 'error'],
  ['orchestrator-git-log-output-denied', 'git log --output=marker.txt', 'DENY', 'error'],
  ['orchestrator-find-exec-denied', 'find . -exec touch marker.txt \\;', 'DENY', 'error'],
  ['orchestrator-tree-output-denied', 'tree -o marker.txt', 'DENY', 'error'],
  ['orchestrator-redirection-denied', 'rg needle fixture.txt > marker.txt', 'DENY', 'error'],
  ['orchestrator-pwd-redirection-denied', 'pwd > marker.txt', 'DENY', 'error'],
  ['orchestrator-pipeline-write-probe', 'rg needle fixture.txt | tee marker.txt', 'DENY', 'error'],
  ['orchestrator-unknown-command-denied', 'uname -a', 'DENY', 'error'],
];
for (const [id, command, expected, terminal] of runtimeParity) {
  const observed = scenario(id);
  assert.equal(observed.permission_request_count, 0, `${id} does not prompt`);
  assert.equal(observed.tool_states.at(-1), terminal, `${id} native terminal state`);
  assert.equal(observed.marker_created, false, `${id} did not create a fixture marker`);
  assert.equal(projectBashCommand(observed.rules, command).state, expected, `${id} internal matcher equals actual OpenCode result`);
}
for (const id of ['orchestrator-git-add-denied', 'interactive-source-orchestrator-git-add-denied', 'orchestrator-git-commit-denied', 'orchestrator-git-push-denied']) {
  const observed = scenario(id);
  assert.deepEqual(observed.effect_after, observed.effect_before, `${id} protected fixture state unchanged`);
}
for (const [id, command] of [
  ['orchestrator-git-reset-approval-rejected', 'git reset --hard'],
  ['orchestrator-git-clean-approval-rejected', 'git clean -fd'],
  ['orchestrator-find-delete-approval-rejected', 'find . -delete'],
  ['orchestrator-authority-ref-fetch-approval-rejected', 'git fetch --no-tags origin refs/heads/program:refs/remotes/origin/program'],
]) {
  const observed = scenario(id);
  assert.equal(observed.permission_request_count, 1, `${id} asks exactly once`);
  assert.equal(observed.tool_states.at(-1), 'error', `${id} rejection prevents execution`);
  assert.equal(projectBashCommand(observed.rules, command).state, 'ASK', `${id} is native-ASK-gated`);
}
for (const id of ['orchestrator-git-reset-approval-rejected', 'orchestrator-git-clean-approval-rejected']) {
  const observed = scenario(id);
  assert.deepEqual(observed.effect_after, observed.effect_before, `${id} rejection preserves the protected fixture state`);
}
const generatedOrder = Object.keys(scenario('orchestrator-git-status-observation').rules);
assert.ok(generatedOrder.indexOf('git *') < generatedOrder.indexOf('git status'));
assert.ok(generatedOrder.indexOf('git status *') < generatedOrder.indexOf('git push'));
assert.ok(generatedOrder.indexOf('git push *') < generatedOrder.indexOf('*>*'));
assert.ok(generatedOrder.indexOf('*>*') < generatedOrder.indexOf('*<*'));
console.log('OPENCODE_1_18_21_PERMISSION_QUALIFICATION_PROVEN');
