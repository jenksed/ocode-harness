import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactManifest } from '../scripts/release-artifact.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-artifact-manifest-'));
try {
  mkdirSync(join(root, 'harness-runtime', 'bin'), { recursive: true });
  writeFileSync(join(root, 'VERSION'), '0.1.0\n');
  writeFileSync(join(root, 'RELEASE.json'), '{"schema_version":1}\n');
  writeFileSync(join(root, 'harness-runtime', 'bin', 'harness.mjs'), '#!/usr/bin/env node\n', { mode: 0o755 });
  writeFileSync(join(root, 'ARTIFACT.json'), '{}\n');
  const artifact = createArtifactManifest(root, { version: '0.1.0', source_commit: 'a'.repeat(40) }, 'b'.repeat(64), '1.18.21');
  assert.equal(artifact.schema_version, 1);
  assert.equal(artifact.payload.files.some((entry) => entry.path === 'ARTIFACT.json'), false);
  assert.equal(artifact.payload.files.find((entry) => entry.path.endsWith('harness.mjs')).executable, true);
  assert.match(artifact.payload.manifest_sha256, /^[0-9a-f]{64}$/);
  console.log('RELEASE_ARTIFACT_MANIFEST_PROVEN');
} finally { rmSync(root, { recursive: true, force: true }); }
