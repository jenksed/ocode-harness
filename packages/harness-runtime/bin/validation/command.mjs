#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateValidationRegistryFreshness, validateValidationRegistry } from '../../lib/validation-registry.mjs';

const executable = basename(process.argv[1]);
const projectDir = process.env.OCODE_VALIDATION_PROJECT;
const serialized = process.env.OCODE_VALIDATION_REGISTRY;
let executables;
let registry;
try { executables = JSON.parse(process.env.OCODE_VALIDATION_EXECUTABLES ?? '{}'); } catch { executables = null; }
try { registry = validateValidationRegistry(JSON.parse(serialized)); } catch { registry = null; }
const realExecutable = executables?.[executable];
if (!projectDir || !registry || typeof realExecutable !== 'string' || !resolve(realExecutable).startsWith('/')) {
  console.error('OCODE_VALIDATION_WRAPPER_CONFIGURATION_MISSING');
  process.exit(126);
}
const command = [executable, ...process.argv.slice(2)].join(' ').trim().replace(/\s+/g, ' ');
if (!registry.commands.includes(command)) {
  console.error(`OCODE_VALIDATION_COMMAND_NOT_ADMITTED: ${command}`);
  process.exit(126);
}
const freshness = evaluateValidationRegistryFreshness(registry, { projectDir });
if (freshness.status !== 'CURRENT') {
  console.error('OCODE_VALIDATION_REGISTRY_STALE: governing validation configuration changed after admission; restart Ocode to readmit validation.');
  process.exit(125);
}
const environment = { ...process.env };
if (environment.OCODE_VALIDATION_ORIGINAL_PATH) environment.PATH = environment.OCODE_VALIDATION_ORIGINAL_PATH;
const result = spawnSync(realExecutable, process.argv.slice(2), { cwd: process.cwd(), env: environment, stdio: 'inherit' });
if (result.error) { console.error(`OCODE_VALIDATION_EXECUTION_FAILED: ${result.error.message}`); process.exit(126); }
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
