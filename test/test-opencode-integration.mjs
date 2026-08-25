#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildOpenCodeRuntimeOverlay,
  fingerprintBindingProfile,
  getRoleBinding,
  serializeOpenCodeRuntimeOverlay,
  validateBindingProfile,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';
import { extractAssistantModelOutput, extractAssistantModelOutputFromExport, resolveAssistantModelOutput } from '../packages/harness-runtime/lib/execution.mjs';

console.log('=== Test OpenCode Integration Primitives ===\n');

const profile = {
  schema_version: 1,
  name: 'm2_fixture',
  policy_version: 1,
  bindings: {
    reviewer: 'openai/discovered-model',
    coder: 'freellmapi/auto:coding',
  },
};

assert.equal(validateBindingProfile(profile), profile);
assert.equal(getRoleBinding(profile, 'coder'), 'freellmapi/auto:coding');
console.log('✓ Profile schema and role lookup are deterministic');

const overlay = buildOpenCodeRuntimeOverlay(profile);
assert.deepEqual(overlay, {
  agent: {
    coder: { model: 'freellmapi/auto:coding' },
    reviewer: { model: 'openai/discovered-model' },
  },
});
assert.equal(
  serializeOpenCodeRuntimeOverlay(profile),
  '{"agent":{"coder":{"model":"freellmapi/auto:coding"},"reviewer":{"model":"openai/discovered-model"}}}',
);
assert.deepEqual(profile.bindings, {
  reviewer: 'openai/discovered-model',
  coder: 'freellmapi/auto:coding',
});
console.log('✓ Overlay contains only sorted Ocode-owned agent model bindings');

const reordered = {
  schema_version: 1,
  name: 'm2_fixture',
  policy_version: 1,
  bindings: {
    coder: 'freellmapi/auto:coding',
    reviewer: 'openai/discovered-model',
  },
};
assert.equal(fingerprintBindingProfile(profile), fingerprintBindingProfile(reordered));
console.log('✓ Binding profile fingerprint is stable across key order');

assert.throws(() => getRoleBinding(profile, 'planner'), /no binding for semantic role planner/);
assert.throws(
  () => validateBindingProfile({ ...profile, bindings: { coder: 'missing-provider-prefix' } }),
  /provider\/model format/,
);
assert.throws(
  () => validateBindingProfile({ ...profile, schema_version: 2 }),
  /schema_version must be 1/,
);
assert.throws(
  () => validateBindingProfile({ ...profile, routing: { fallback: true } }),
  /Unknown binding profile field: routing/,
);
console.log('✓ Missing roles, malformed bindings, unknown schemas, and extra fields fail explicitly');

const live=[{type:'text',part:{type:'text',text:'live JSON'}}];
const exported={messages:[{info:{role:'assistant'},parts:[{type:'text',text:'export JSON'}]}]};
assert.equal(extractAssistantModelOutput(live),'live JSON');
assert.equal(extractAssistantModelOutputFromExport(exported),'export JSON');
assert.equal(resolveAssistantModelOutput({events:live,exported}),'live JSON');
assert.equal(resolveAssistantModelOutput({events:[],exported}),'export JSON');
assert.equal(extractAssistantModelOutputFromExport({messages:[{info:{role:'assistant'},parts:[{type:'text',text:'[redacted:text:secret]'}]}]}),null);
assert.equal(resolveAssistantModelOutput({events:[],exported:null}),null);
console.log('✓ sanitized export assistant-output fallback is deterministic and fail-closed');

console.log('\n✓ All tests passed');
