#!/usr/bin/env node
/**
 * test-doctor.mjs
 * Test doctor command against an isolated installed runtime.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const testHome = join(tmpdir(), `ocode-harness-doctor-test-${Date.now()}`);
const testBinDir = join(testHome, '.local', 'bin');
const testProject = join(testHome, 'project');

console.log('=== Test Doctor ===\n');
console.log(`Test HOME: ${testHome}\n`);

mkdirSync(testBinDir, { recursive: true });
mkdirSync(join(testProject, '.git', 'info'), { recursive: true });

const mockOpencodePath = join(testBinDir, 'opencode');
writeFileSync(mockOpencodePath, '#!/bin/sh\necho "mock-1.0.0"\n', 'utf8');

const mockGitPath = join(testBinDir, 'git');
writeFileSync(mockGitPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "mock-git-2.40.0"
elif [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  echo "${testProject}"
else
  echo ""
fi
`, 'utf8');

spawnSync('chmod', ['+x', mockOpencodePath]);
spawnSync('chmod', ['+x', mockGitPath]);

let failed = false;

try {
  const env = {
    ...process.env,
    HOME: testHome,
    PATH: `${testBinDir}:${process.env.PATH}`,
    FREELLMAPI_API_KEY: 'test-doctor-key',
    OCODE_DOCTOR_SKIP_NETWORK: '1',
  };

  const installResult = spawnSync(process.execPath, [join(repoRoot, 'installer', 'install.mjs')], {
    cwd: testProject,
    env,
    encoding: 'utf8',
  });

  if (installResult.status !== 0) {
    console.error('✗ Installer failed before doctor test');
    console.error(installResult.stdout);
    console.error(installResult.stderr);
    failed = true;
  }

  const machineConfigPath = join(testHome, '.config', 'ocode', 'config.json');
  writeFileSync(machineConfigPath, JSON.stringify({
    profile: 'hybrid',
    freellmapi: {
      base_url: 'http://127.0.0.1:3001/v1'
    },
    closeout: {
      push: false
    }
  }, null, 2), 'utf8');

  const doctorResult = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'doctor.mjs')], {
    cwd: testProject,
    env,
    encoding: 'utf8',
  });

  if (doctorResult.status === 0) {
    console.log('✓ Doctor exited successfully');
  } else {
    console.error('✗ Doctor failed');
    console.error(doctorResult.stdout);
    console.error(doctorResult.stderr);
    failed = true;
  }

  const output = `${doctorResult.stdout}\n${doctorResult.stderr}`;
  if (output.includes('FREELLMAPI_API_KEY: SET')) {
    console.log('✓ Doctor reports FreeLLMAPI key state without value');
  } else {
    console.error('✗ Doctor did not report FreeLLMAPI key state');
    failed = true;
  }

  if (!output.includes('test-doctor-key')) {
    console.log('✓ Doctor did not print API key material');
  } else {
    console.error('✗ Doctor printed API key material');
    failed = true;
  }

  if (output.includes('network check skipped by OCODE_DOCTOR_SKIP_NETWORK')) {
    console.log('✓ Doctor reached FreeLLMAPI health check path');
  } else {
    console.error('✗ Doctor did not reach FreeLLMAPI health check path');
    failed = true;
  }

  if (output.includes('Checking M4A governance contracts') &&
      output.includes('manifest-governed roles have structurally valid capability declarations')) {
    console.log('✓ Doctor reports structural M4A governance contract health');
  } else {
    console.error('✗ Doctor did not report structural M4A governance contract health');
    failed = true;
  }

  if (existsSync(join(testHome, '.config', 'opencode', 'opencode.json'))) {
    console.log('✓ Doctor fixture has installed OpenCode config');
  } else {
    console.error('✗ Doctor fixture missing installed OpenCode config');
    failed = true;
  }

  const installedPlanner = join(testHome, '.config', 'opencode', 'agents', 'planner.md');
  const plannerWithModel = readFileSync(installedPlanner, 'utf8')
    .replace('mode: subagent\n', 'mode: subagent\nmodel: freellmapi/auto:planning\n');
  writeFileSync(installedPlanner, plannerWithModel, 'utf8');
  const providerCoupledDoctor = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'doctor.mjs')], {
    cwd: testProject,
    env,
    encoding: 'utf8',
  });
  if (providerCoupledDoctor.status !== 0 &&
      `${providerCoupledDoctor.stdout}\n${providerCoupledDoctor.stderr}`.includes('contains model policy')) {
    console.log('✓ Doctor fails when a canonical agent declares model policy');
  } else {
    console.error('✗ Doctor did not reject canonical agent model policy');
    failed = true;
  }
} catch (err) {
  console.error('✗ Test execution failed:', err.message);
  console.error(err.stack);
  failed = true;
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

if (failed) {
  console.log('\n✗ Some tests failed');
  process.exit(1);
}

console.log('\n✓ All tests passed');
