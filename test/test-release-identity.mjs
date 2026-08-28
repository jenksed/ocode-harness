import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertPromotableSourceIdentity,
  inspectSourceIdentity,
  isExactReleaseIdentity,
  readReleaseIdentity,
  sameReleaseIdentity,
  writeReleaseIdentity,
} from '../packages/harness-runtime/lib/deploy.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

const root = mkdtempSync(join(tmpdir(), 'ocode-release-identity-'));
const source = join(root, 'source');
const installed = join(root, 'installed');
mkdirSync(source, { recursive: true });
mkdirSync(installed, { recursive: true });

try {
  git(source, 'init', '-q');
  git(source, 'config', 'user.email', 'ocode-test@example.invalid');
  git(source, 'config', 'user.name', 'Ocode Test');
  writeFileSync(join(source, 'tracked.txt'), 'one\n');
  writeFileSync(join(source, 'VERSION'), '0.1.0\n');
  git(source, 'add', 'tracked.txt', 'VERSION');
  git(source, 'commit', '-q', '-m', 'initial');

  const first = inspectSourceIdentity(source);
  assert.equal(isExactReleaseIdentity(first), true);
  assert.equal(first.source_commit, git(source, 'rev-parse', 'HEAD'));
  assert.equal(first.source_dirty, false);
  assert.doesNotThrow(() => assertPromotableSourceIdentity(first));
  assert.throws(() => inspectSourceIdentity(source, '0.2.0'), /OCODE_PRODUCT_VERSION_MISMATCH/);

  writeReleaseIdentity(installed, first);
  assert.deepEqual(readReleaseIdentity(installed), first);
  assert.equal(sameReleaseIdentity(first, readReleaseIdentity(installed)), true);

  writeFileSync(join(source, 'tracked.txt'), 'two\n');
  const dirty = inspectSourceIdentity(source);
  assert.equal(dirty.source_commit, first.source_commit);
  assert.equal(dirty.source_dirty, true);
  assert.throws(() => assertPromotableSourceIdentity(dirty), /OCODE_RELEASE_SOURCE_DIRTY/);

  git(source, 'add', 'tracked.txt');
  git(source, 'commit', '-q', '-m', 'second');
  const second = inspectSourceIdentity(source);
  assert.equal(second.version, first.version);
  assert.notEqual(second.source_commit, first.source_commit);
  assert.equal(sameReleaseIdentity(first, second), false);
  const alternateRef = { ...second, source_ref: 'cleanup/example' };
  assert.equal(sameReleaseIdentity(second, alternateRef), true);

  const nonGit = join(root, 'not-git');
  mkdirSync(nonGit, { recursive: true });
  writeFileSync(join(nonGit, 'VERSION'), '0.1.0\n');
  const unavailable = inspectSourceIdentity(nonGit);
  assert.equal(unavailable.source_commit, null);
  assert.equal(isExactReleaseIdentity(unavailable), false);
  assert.doesNotThrow(() => assertPromotableSourceIdentity(unavailable));

  rmSync(source, { recursive: true, force: true });
  assert.deepEqual(readReleaseIdentity(installed), first);

  console.log('RELEASE_IDENTITY_PROVEN');
} finally {
  rmSync(root, { recursive: true, force: true });
}
