import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVersion, validateProductVersion } from '../packages/harness-runtime/lib/deploy.mjs';
import { checkVersionMirrors, syncVersionMirrors } from '../scripts/version-authority.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-version-authority-'));
try {
  for (const file of ['VERSION', 'package.json', 'package-lock.json']) cpSync(file, join(root, file));
  mkdirSync(join(root, 'packages', 'harness-runtime'), { recursive: true });
  cpSync('packages/harness-runtime/package.json', join(root, 'packages/harness-runtime/package.json'));
  assert.equal(readVersion(join(root, 'VERSION')), '0.1.0');
  assert.equal(validateProductVersion('0.2.0-alpha.1'), '0.2.0-alpha.1');
  for (const invalid of ['v0.1.0', ' 0.1.0', '0.1.0 ', '0.1', '1.01.0']) assert.throws(() => validateProductVersion(invalid), /OCODE_PRODUCT_VERSION_INVALID/);
  writeFileSync(join(root, 'VERSION'), 'v0.1.0\n');
  assert.throws(() => readVersion(join(root, 'VERSION')), /OCODE_PRODUCT_VERSION_INVALID/);
  writeFileSync(join(root, 'VERSION'), '0.1.0\n');
  assert.doesNotThrow(() => checkVersionMirrors(root));
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  rootPackage.version = '9.9.9'; writeFileSync(join(root, 'package.json'), JSON.stringify(rootPackage));
  assert.throws(() => checkVersionMirrors(root), /OCODE_PRODUCT_VERSION_DRIFT.*package\.json:version/);
  assert.deepEqual(syncVersionMirrors(root).changed, ['package.json']);
  writeFileSync(join(root, 'packages/harness-runtime/package.json'), JSON.stringify({ name: '@ocode-harness/runtime', version: '9.9.9' }));
  assert.throws(() => checkVersionMirrors(root), /OCODE_PRODUCT_VERSION_DRIFT.*harness-runtime/);
  assert.deepEqual(syncVersionMirrors(root).changed, ['packages/harness-runtime/package.json']);
  assert.doesNotThrow(() => checkVersionMirrors(root));
  assert.deepEqual(syncVersionMirrors(root).changed, []);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  lock.packages[''].version = '9.9.9'; writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => checkVersionMirrors(root), /OCODE_PRODUCT_VERSION_DRIFT.*package-lock/);
  assert.deepEqual(syncVersionMirrors(root).changed, ['package-lock.json']);
  console.log('PRODUCT_VERSION_AUTHORITY_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
