#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync(process.execPath, ['scripts/qualify-opencode-runtime.mjs'], { encoding: 'utf8' });
const evidence = JSON.parse(output);
assert.equal(evidence.schema_version, 1);
assert.equal(evidence.contract_version, 1);
assert.equal(evidence.runtime.name, 'opencode');
assert.equal(evidence.runtime.executable_version, '1.18.21');
assert.equal(evidence.qualification_status, 'COMPATIBLE_WITH_DEGRADATION');
assert.equal(evidence.required.server_start, 'SUPPORTED');
assert.equal(evidence.required.permission_reply_once, 'SUPPORTED');
assert.equal(evidence.optional.interactive_permission_parity, 'UNKNOWN');
assert.equal(evidence.isolation.credentials, 'none');
assert.equal(evidence.isolation.project_config_disabled, true);
assert.equal(evidence.isolation.environment_controlled, true);
assert.equal(evidence.isolation.canonical_seam, 'sdk_managed_server');
console.log('OPENCODE_RUNTIME_QUALIFICATION_HARNESS_PROVEN');
