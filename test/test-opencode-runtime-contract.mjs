#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createOpenCodeRuntimeIdentity, OPTIONAL_RUNTIME_CAPABILITIES, qualifyOpenCodeRuntime, qualificationInvalidationReasons, REQUIRED_RUNTIME_CAPABILITIES, RUNTIME_CAPABILITY_STATES, RUNTIME_QUALIFICATION_STATUSES } from '../packages/harness-runtime/lib/opencode-runtime-contract.mjs';

const supported = (names) => Object.fromEntries(names.map((name) => [name, RUNTIME_CAPABILITY_STATES.SUPPORTED]));
const runtime = createOpenCodeRuntimeIdentity({ executablePath: process.execPath, executableVersion: process.version, sdkPackagePath: fileURLToPath(new URL('../node_modules/@opencode-ai/sdk/package.json', import.meta.url)), sdkVersion: '1.18.21' });
const compatible = qualifyOpenCodeRuntime({ runtime, required: supported(REQUIRED_RUNTIME_CAPABILITIES), optional: supported(OPTIONAL_RUNTIME_CAPABILITIES), observations: [{ id: 'fixture', kind: 'deterministic' }] });
assert.equal(compatible.qualification_status, RUNTIME_QUALIFICATION_STATUSES.COMPATIBLE);
const unqualified = qualifyOpenCodeRuntime({ runtime, required: { ...supported(REQUIRED_RUNTIME_CAPABILITIES), server_start: 'UNKNOWN' }, optional: supported(OPTIONAL_RUNTIME_CAPABILITIES) });
assert.equal(unqualified.qualification_status, RUNTIME_QUALIFICATION_STATUSES.UNQUALIFIED);
const incompatible = qualifyOpenCodeRuntime({ runtime, required: { ...supported(REQUIRED_RUNTIME_CAPABILITIES), permission_reply_once: 'UNSUPPORTED' }, optional: supported(OPTIONAL_RUNTIME_CAPABILITIES) });
assert.equal(incompatible.qualification_status, RUNTIME_QUALIFICATION_STATUSES.INCOMPATIBLE);
const degraded = qualifyOpenCodeRuntime({ runtime, required: supported(REQUIRED_RUNTIME_CAPABILITIES), optional: { ...supported(OPTIONAL_RUNTIME_CAPABILITIES), bash_metadata: 'UNKNOWN' } });
assert.equal(degraded.qualification_status, RUNTIME_QUALIFICATION_STATUSES.COMPATIBLE_WITH_DEGRADATION);
assert.deepEqual(qualificationInvalidationReasons({ previous: { ...compatible, adapter_fingerprint: 'one' }, currentRuntime: runtime, adapterFingerprint: 'one' }), []);
assert.deepEqual(qualificationInvalidationReasons({ previous: { ...compatible, adapter_fingerprint: 'one' }, currentRuntime: runtime, adapterFingerprint: 'two' }), ['COMPATIBILITY_ADAPTER_CHANGED']);
console.log('OPENCODE_RUNTIME_CONTRACT_PROVEN');
