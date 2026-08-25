#!/usr/bin/env node
import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process'; import { dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const r = spawnSync(process.execPath, ['test/test-wayfinding.mjs'], { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); console.log(JSON.stringify({ status: 'M5_CORE_PROVEN', deterministic_tests: 'test:wayfinding', live_provider_calls: 0, m5_complete: false }, null, 2));
