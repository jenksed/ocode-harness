import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { activateRelease, installVerifiedArtifact, releaseEntrypoint, resolveReleasePointer, rollbackRelease, verifyInstalledRelease } from '../packages/harness-runtime/lib/release-store.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-phase3-test-')), store = join(root, 'store'), output = join(root, 'artifacts');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  const built = buildReleaseArtifact({ sourceRoot: process.cwd(), outputDir: output }), archiveA = built.archive, archiveB = join(root, 'same-payload-different-transport.tar.gz');
  writeFileSync(archiveB, readFileSync(archiveA)); appendFileSync(archiveB, Buffer.from('1f8b080000000000000003000000000000000000', 'hex')); writeFileSync(`${archiveB}.sha256`, `${hash(archiveB)}  same-payload-different-transport.tar.gz\n`);
  assert.notEqual(hash(archiveA), hash(archiveB));
  const a = installVerifiedArtifact({ archive: archiveA, installStore: store }), duplicate = installVerifiedArtifact({ archive: archiveB, installStore: store });
  assert.equal(a.id, duplicate.id); assert.equal(duplicate.reused, true); assert.equal(readdirSync(join(store, 'releases')).filter((x) => !x.startsWith('.')).length, 1);
  activateRelease(a.id, store); assert.equal(resolveReleasePointer(join(store, 'current'), store).id, a.id); assert.equal(existsSync(join(store, 'previous')), false);
  const stable = execFileSync('node', [releaseEntrypoint(a.id, store, 'harness'), 'version', '--json'], { cwd: root, env: { ...process.env, OCODE_INSTALL_STORE_ROOT: store }, encoding: 'utf8' }); assert.equal(JSON.parse(stable).logical_release_id, a.id);
  const victim = join(a.path, 'VERSION'), original = readFileSync(victim); writeFileSync(victim, '9.9.9\n'); assert.throws(() => verifyInstalledRelease(a.id, store)); assert.throws(() => activateRelease(a.id, store)); writeFileSync(victim, original);
  symlinkSync('../outside/payload', join(store, 'previous')); assert.throws(() => rollbackRelease(store)); assert.equal(resolveReleasePointer(join(store, 'current'), store).id, a.id);
  console.log('PHASE3_IMMUTABLE_STORE_ARTIFACT_ONLY_AND_FAILURE_BOUNDARIES_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
