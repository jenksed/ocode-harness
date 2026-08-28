import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildReleaseArtifact } from '../scripts/release-artifact.mjs';
import { activateRelease, installVerifiedArtifact } from '../packages/harness-runtime/lib/release-store.mjs';
import { installLaunchers } from '../packages/harness-runtime/lib/deploy.mjs';

const root = mkdtempSync(join(tmpdir(), 'ocode-self-hosting-')), store = join(root, 'store'), bin = join(root, 'bin'), output = join(root, 'output');
try {
  const built = buildReleaseArtifact({ sourceRoot: process.cwd(), outputDir: output });
  const archive = join(output, readdirSync(output).find((name) => name.endsWith('.tar.gz')));
  const a = installVerifiedArtifact({ archive, installStore: store }); activateRelease(a.id, store);
  process.env.OCODE_INSTALL_STORE_ROOT = store; process.env.OCODE_BIN_DIR = bin; installLaunchers(store);
  const env = { ...process.env, OCODE_INSTALL_STORE_ROOT: store, OCODE_BIN_DIR: bin, PATH: `${bin}:${process.env.PATH}` };
  const run = (...args) => execFileSync(join(bin, 'ocode'), args, { cwd: root, env, encoding: 'utf8' });
  assert.match(run('release', 'list'), new RegExp(`CURRENT\\s+${a.id}`));
  assert.equal(JSON.parse(run('release', 'current')).id, a.id);
  assert.equal(JSON.parse(run('version', '--json')).logical_release_id, a.id);
  let outside = null; try { execFileSync(join(bin, 'ocode-dev'), ['.'], { cwd: root, env, encoding: 'utf8' }); } catch (error) { outside = error; }
  assert.ok(outside); assert.match(String(outside.stderr), /must be run from inside/);
  console.log(`STABLE_SELF_HOSTING_CLI_PROVEN ${a.id}`);
} finally { rmSync(root, { recursive: true, force: true }); }
