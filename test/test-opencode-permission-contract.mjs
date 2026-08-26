#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdkPackage = JSON.parse(readFileSync(resolve(root, 'node_modules/@opencode-ai/sdk/package.json'), 'utf8'));
const types = readFileSync(resolve(root, 'node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts'), 'utf8');
const record = readFileSync(resolve(root, 'docs/architecture/opencode-1.18.21-permission-contract.md'), 'utf8');

assert.equal(sdkPackage.version, '1.18.21');
assert.match(types, /export type Permission = \{/);
assert.match(types, /type: "permission\.updated"/);
assert.match(types, /response: "once" \| "always" \| "reject"/);
assert.match(record, /CHARACTERIZATION SUFFICIENT: NO/);
assert.match(record, /does not authorize the ASK governance implementation/i);

const version = execFileSync('opencode', ['--version'], { encoding: 'utf8' }).trim();
const help = spawnSync('opencode', ['run', '--help'], { encoding: 'utf8' });
assert.equal(help.status, 0, help.stderr);
const runHelp = `${help.stdout}${help.stderr}`;
assert.equal(version, '1.18.21');
assert.match(runHelp, /auto-approve permissions that are not explicitly denied/i);
console.log('OPENCODE_1_18_21_PERMISSION_CONTRACT_PREFLIGHT_PROVEN');
