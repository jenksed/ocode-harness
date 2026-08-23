#!/usr/bin/env node
/**
 * test-orientation.mjs
 * Run orientation's existing tests
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const orientationDir = join(__dirname, '..', 'packages', 'orientation');

console.log('=== Test Orientation ===\n');
console.log(`Orientation directory: ${orientationDir}\n`);

// Check if orientation package exists
if (!existsSync(orientationDir)) {
  console.error('✗ Orientation directory not found');
  process.exit(1);
}

// Check if orientation package.json exists
const packageJsonPath = join(orientationDir, 'package.json');
if (!existsSync(packageJsonPath)) {
  console.error('✗ Orientation package.json not found');
  process.exit(1);
}

// Check if orient.test.mjs exists
const testFile = join(orientationDir, 'test', 'orient.test.mjs');
if (!existsSync(testFile)) {
  console.error('✗ Orientation test file not found');
  process.exit(1);
}

console.log('Running orientation tests...\n');

// Run orientation tests
try {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('node', ['--test', testFile], {
    cwd: orientationDir,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log('\n✓ Orientation tests passed');
    process.exit(0);
  } else {
    console.log('\n✗ Orientation tests failed');
    process.exit(1);
  }

} catch (error) {
  console.error('\n✗ Test execution failed:', error.message);
  process.exit(1);
}
