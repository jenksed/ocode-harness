import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactManifest, inspectArtifactArchive, materializeVerifiedArtifact } from '../scripts/release-artifact.mjs';

function octal(value, width) { return `${value.toString(8).padStart(width - 1, '0')}\0`; }
function tarEntry({ name, type = '0', body = '', mode = 0o644, link = '' }) {
  const data = Buffer.from(body), header = Buffer.alloc(512); header.write(name); header.write(octal(mode, 8), 100); header.write(octal(0, 8), 108); header.write(octal(0, 8), 116); header.write(octal(data.length, 12), 124); header.write(octal(0, 12), 136); header.fill(0x20, 148, 156); header.write(type, 156); header.write(link, 157); header.write('ustar\0', 257); header.write('00', 263); header.write(octal(header.reduce((sum, value) => sum + value, 0), 8), 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
function writeArchive(path, entries) { writeFileSync(path, gzipSync(Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024)]))); }

const root = mkdtempSync(join(tmpdir(), 'ocode-artifact-test-'));
try {
  mkdirSync(join(root, 'payload', 'harness-runtime', 'bin'), { recursive: true });
  writeFileSync(join(root, 'payload', 'VERSION'), '0.1.0\n');
  writeFileSync(join(root, 'payload', 'RELEASE.json'), '{"schema_version":1}\n');
  writeFileSync(join(root, 'payload', 'harness-runtime', 'bin', 'harness.mjs'), '#!/usr/bin/env node\n', { mode: 0o755 });
  writeFileSync(join(root, 'payload', 'ARTIFACT.json'), '{}\n');
  const artifact = createArtifactManifest(join(root, 'payload'), { version: '0.1.0', source_commit: 'a'.repeat(40) }, 'b'.repeat(64), '1.18.21');
  assert.equal(artifact.schema_version, 1);
  assert.equal(artifact.payload.files.some((entry) => entry.path === 'ARTIFACT.json'), false);
  assert.equal(artifact.payload.files.find((entry) => entry.path.endsWith('harness.mjs')).executable, true);
  assert.match(artifact.payload.manifest_sha256, /^[0-9a-f]{64}$/);

  const valid = join(root, 'valid.tar.gz');
  writeArchive(valid, [{ name: 'ocode-release/', type: '5', mode: 0o755 }, { name: 'ocode-release/VERSION', body: '0.1.0\n' }]);
  assert.equal(inspectArtifactArchive(valid).length, 2);
  const candidate = join(root, 'candidate'); materializeVerifiedArtifact(valid, candidate);
  assert.equal(readFileSync(join(candidate, 'ocode-release', 'VERSION'), 'utf8'), '0.1.0\n');

  const sentinel = join(root, 'outside-sentinel'); writeFileSync(sentinel, 'unchanged');
  const attacks = [
    { label: 'traversal', entries: [{ name: 'ocode-release/../outside', body: 'bad' }] },
    { label: 'absolute', entries: [{ name: '/outside', body: 'bad' }] },
    { label: 'absolute-symlink', entries: [{ name: 'ocode-release/link', type: '2', link: '/outside' }] },
    { label: 'relative-symlink', entries: [{ name: 'ocode-release/link', type: '2', link: '../outside' }] },
    { label: 'symlink-followed-by-file', entries: [{ name: 'ocode-release/link', type: '2', link: '../outside' }, { name: 'ocode-release/link/escaped', body: 'bad' }] },
    { label: 'nested-symlink-chain', entries: [{ name: 'ocode-release/first', type: '2', link: 'second' }, { name: 'ocode-release/second', type: '2', link: '../outside' }, { name: 'ocode-release/first/escaped', body: 'bad' }] },
    { label: 'hard-link', entries: [{ name: 'ocode-release/link', type: '1', link: '../../outside' }] },
  ];
  for (const attack of attacks) {
    const archive = join(root, `${attack.label}.tar.gz`); writeArchive(archive, [{ name: 'ocode-release/', type: '5' }, ...attack.entries]);
    assert.throws(() => materializeVerifiedArtifact(archive, join(root, `${attack.label}-candidate`)), /Unsafe artifact path|Artifact root is invalid|Artifact link or special entry/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'unchanged', `${attack.label} modified outside sentinel`);
    assert.equal(existsSync(join(root, 'outside')), false, `${attack.label} created escaped path`);
  }
  console.log('RELEASE_ARTIFACT_MANIFEST_AND_SAFE_MATERIALIZATION_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
