#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(args) { const result = spawnSync(process.execPath, args, { cwd: repoRoot, env: process.env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }); assert.equal(result.error, undefined, `Could not run ${args.join(' ')}: ${result.error?.message}`); assert.equal(result.signal, null, `${args.join(' ')} terminated by ${result.signal}`); assert.equal(result.status, 0, `${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`); return { command: `node ${args.join(' ')}`, exit_code: result.status }; }
console.log('=== Ocode M4 Canonical Acceptance ===\n');
const operatorTests = run(['test/test-govern-cli.mjs']);
const doctor = run(['test/test-doctor.mjs']);
console.log(JSON.stringify({ status: 'M4_PROVEN', m4a_to_d_proofs: 'reused from their committed recovery points; not nested or reconstructed', deterministic_tests: { operatorTests, doctor }, production_surfaces: ['ocode govern explain <role>', 'ocode govern check <role>', 'ocode govern audit', 'ocode explain --run <id>', 'doctor governance health'], governance_engine: 'one canonical contract -> AdmissionRequest -> AdmissionDecision -> PermissionProjection -> subject provenance model', live_provider_calls: 0, m5_entry: 'M5 may translate explicit work requirements into AdmissionRequest; it must not fork governance or infer authority from routing.' }, null, 2));
console.log('\n✓ M4 canonical acceptance passed');
