#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync(process.execPath, ['scripts/qualify-opencode-runtime.mjs'], { encoding: 'utf8' });
const evidence = JSON.parse(output);
assert.equal(evidence.schema_version, 1);
assert.equal(evidence.contract_version, 1);
assert.equal(evidence.runtime.name, 'opencode');
assert.equal(evidence.runtime.executable_version, '1.18.21');
assert.equal(evidence.required.server_start, 'UNKNOWN');
assert.equal(evidence.qualification_status, 'UNQUALIFIED');
assert.equal(evidence.isolation.credentials, 'none');
assert.equal(evidence.isolation.project_config_disabled, true);
console.log('OPENCODE_RUNTIME_QUALIFICATION_HARNESS_PROVEN');
