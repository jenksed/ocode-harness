#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd(), root = mkdtempSync(join(tmpdir(), 'ocode-self-hosting-'));
const home = join(root, 'home'), store = join(root, 'store'), bin = join(home, '.local', 'bin'), a = join(root, 'a-source'), b = join(root, 'b-source');
const run = (cwd, file, args, extra = {}) => execFileSync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, OCODE_INSTALL_STORE_ROOT: store, PATH: `${bin}:${process.env.PATH}`, ...extra } });
const cli = (cwd, ...args) => run(cwd, join(bin, 'ocode'), args);
const pointers = () => ({ current: JSON.parse(cli(root, 'release', 'current')).id, previous: existsSync(join(store, 'previous')) ? basename(readlinkSync(join(store, 'previous')).split('/')[1] || '') : null });
try {
  mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, 'opencode'), '#!/bin/sh\necho mock-1.0.0\n', { mode: 0o755 });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync('git', ['worktree', 'add', '--detach', a, sha], { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['worktree', 'add', '--detach', b, sha], { cwd: repo, stdio: 'pipe' });
  writeFileSync(join(b, 'test', 'fixtures', 'self-hosting-candidate-b.txt'), 'candidate B\n');
  execFileSync('git', ['add', 'test/fixtures/self-hosting-candidate-b.txt'], { cwd: b }); execFileSync('git', ['-c', 'user.name=Ocode E2E Fixture', '-c', 'user.email=ocode-e2e@example.invalid', 'commit', '-m', 'test fixture: candidate B'], { cwd: b });
  const aSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a, encoding: 'utf8' }).trim(), bSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: b, encoding: 'utf8' }).trim(); assert.notEqual(aSha, bSha);
  run(a, process.execPath, [join(a, 'installer', 'install.mjs')]); const aInfo = JSON.parse(cli(root, 'version', '--json')); const aId = aInfo.logical_release_id; assert.equal(aInfo.installed_sha, aSha);
  const before = pointers(); assert.equal(before.current, aId); assert.equal(before.previous, null);
  run(b, join(bin, 'ocode-dev'), ['agents']); assert.deepEqual(pointers(), before);
  const outside = spawnSync(join(bin, 'ocode-dev'), ['.'], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, OCODE_INSTALL_STORE_ROOT: store, PATH: `${bin}:${process.env.PATH}` } }); assert.notEqual(outside.status, 0); assert.match(outside.stderr, /must be run from inside/); assert.equal(JSON.parse(cli(root, 'version', '--json')).installed_sha, aSha);
  run(b, join(bin, 'ocode-dev'), ['release', 'build']); const releases = join(b, '.ocode-release'), artifactDir = join(releases, readdirSync(releases)[0]), artifact = join(artifactDir, readdirSync(artifactDir).find((x) => x.endsWith('.tar.gz'))); assert.ok(existsSync(artifact) && existsSync(`${artifact}.sha256`));
  run(root, process.execPath, [join(repo, 'scripts', 'verify-release-artifact.mjs'), artifact]); const installed = cli(root, 'release', 'install', artifact).trim().split(/\s+/).pop(); assert.equal(pointers().current, aId);
  const listed = cli(root, 'release', 'list'); assert.ok(listed.includes(aId) && listed.includes(installed)); assert.equal(JSON.parse(cli(root, 'release', 'current')).id, aId);
  cli(root, 'release', 'run', installed, 'agents'); assert.equal(pointers().current, aId);
  cli(root, 'release', 'promote', installed); const promoted = pointers(); assert.equal(promoted.current, installed); assert.equal(JSON.parse(cli(root, 'version', '--json')).installed_sha, bSha);
  cli(root, 'rollback'); const rolled = pointers(); assert.equal(rolled.current, aId); assert.equal(JSON.parse(cli(root, 'version', '--json')).installed_sha, aSha);
  cli(root, 'release', 'list'); cli(root, 'release', 'run', installed, 'agents');
  console.log(`SELF_HOSTING_E2E_PROVEN A=${aId} B=${installed}`);
} finally { for (const path of [a, b]) if (existsSync(path)) spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: repo }); rmSync(root, { recursive: true, force: true }); }
