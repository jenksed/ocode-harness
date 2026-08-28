import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { activateRelease, installVerifiedArtifact } from '../packages/harness-runtime/lib/release-store.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-self-hosting-')), store = join(root, 'store'), bin = join(root, 'bin'), output = join(root, 'output');
try {
  const built = buildReleaseArtifact({ sourceRoot: process.cwd(), outputDir: output });
  const archive = join(output, readdirSync(output).find((name) => name.endsWith('.tar.gz')));
  const a = installVerifiedArtifact({ archive, installStore: store }); activateRelease(a.id, store);
  const env = { ...process.env, OCODE_INSTALL_STORE_ROOT: store, OCODE_BIN_DIR: bin, PATH: `${bin}:${process.env.PATH}` };
  const run = (...args) => execFileSync('node', [join(store, 'current', 'harness-runtime', 'bin', 'harness.mjs'), ...args], { cwd: root, env, encoding: 'utf8' });
  const listed = run('release', 'list'); assert.ok(listed.includes('CURRENT') && listed.includes(a.id));
  assert.equal(JSON.parse(run('release', 'current')).id, a.id);
  assert.equal(JSON.parse(run('version', '--json')).logical_release_id, a.id);
  console.log(`STABLE_SELF_HOSTING_CLI_PROVEN ${a.id}`);
} finally { rmSync(root, { recursive: true, force: true }); }
