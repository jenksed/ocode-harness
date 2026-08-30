import { describe, test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import util from 'node:util';
const execFilePromise = util.promisify(execFile);
import { orient } from '../lib/orientation.mjs';
import { readFile } from 'node:fs/promises';
import { resolveRuntimeState } from '../../harness-runtime/lib/runtime-state.mjs';

const originalStateHome = process.env.XDG_STATE_HOME;
const stateHome = resolve(tmpdir(), `orient-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.XDG_STATE_HOME = stateHome;

// Helper to create a temporary directory
async function createTempDir() {
  const tempDir = resolve(tmpdir(), `orient-test-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`);
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

// Helper to run git commands in a directory
async function git(args, cwd) {
  try {
    const { stdout, stderr } = await execFilePromise('git', args, { cwd, encoding: 'utf8' });
    if (stderr) {
      console.error(`git stderr: ${stderr}`); // eslint-disable-line no-console
    }
    return { stdout, stderr };
  } catch (err) {
    console.error(`git failed: ${err}`); // eslint-disable-line no-console
    throw err;
  }
}

// Helper to set git config for the test repo (if needed)
async function setupGitConfig(cwd) {
  await git(['config', 'user.name', 'Test User'], cwd);
  await git(['config', 'user.email', 'test@example.com'], cwd);
}

describe('Project Orientation v1', () => {
  let testDir;

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  after(async () => {
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalStateHome;
    await rm(stateHome, { recursive: true, force: true });
  });

  test('should detect Node.js project with package.json', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"name":"test-project","version":"1.0.0"}', 'utf8');

    const orientation = await orient(testDir);

    assert.strictEqual(orientation.project.name, testDir.split(/[\\/]/).pop());
    assert.strictEqual(orientation.project.root, testDir);
    assert.deepStrictEqual(orientation.detected.manifests, ['package.json']);
    assert.deepStrictEqual(orientation.detected.languages, ['Node.js']);
    assert.strictEqual(orientation.detected.package_manager, null);
  });

  test('should discover package.json scripts', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"scripts":{"test":"jest","build":"webpack","lint":"eslint ."}}', 'utf8');

    const orientation = await orient(testDir);

    assert.deepStrictEqual(orientation.commands.test, ['jest']);
    assert.deepStrictEqual(orientation.commands.build, ['webpack']);
    assert.deepStrictEqual(orientation.commands.lint, ['eslint .']);
    assert.deepStrictEqual(orientation.commands.typecheck, []);
    assert.deepStrictEqual(orientation.commands.verify, []);
  });

  test('should discover authority files', async () => {
    testDir = await createTempDir();
    await mkdir(join(testDir, 'docs'), { recursive: true });
    await writeFile(join(testDir, 'README.md'), '# Test', 'utf8');
    await writeFile(join(testDir, 'docs/architecture.md'), '# Architecture', 'utf8');

    const orientation = await orient(testDir);

    // Normalize to lowercase for case-insensitive comparison
    const normalize = (f) => f.toLowerCase();
    const actualSet = new Set(orientation.authority.map(normalize));
    const expectedSet = new Set(['readme.md', 'docs/architecture.md'].map(normalize));
    assert.deepStrictEqual([...actualSet].sort(), [...expectedSet].sort());
  });

  test('should discover important directories', async () => {
    testDir = await createTempDir();
    await mkdir(join(testDir, 'src'));
    await mkdir(join(testDir, 'test'));
    await mkdir(join(testDir, 'docs'));

    const orientation = await orient(testDir);

    assert.deepStrictEqual(orientation.directories.sort(), ['docs', 'src', 'test'].sort());
  });

  test('should detect Git repository and branch/HEAD/dirty state', async () => {
    testDir = await createTempDir();
    await git(['init'], testDir);
    await setupGitConfig(testDir);
    await writeFile(join(testDir, 'package.json'), '{}', 'utf8');
    await git(['add', 'package.json'], testDir);
    await git(['commit', '-m', 'initial'], testDir);

    // Make a change to make dirty
    await writeFile(join(testDir, 'README.md'), 'hello', 'utf8');

    const orientation = await orient(testDir);

    assert.strictEqual(orientation.git.is_repository, true);
    assert.ok(['master', 'main'].includes(orientation.git.branch));
    assert.ok(orientation.git.head.length > 0);
    assert.strictEqual(orientation.git.dirty, true);
  });

  test('should operate on non-Git directory', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"scripts":{"test":"node test.js"}}', 'utf8');
    // Do not initialize git

    const orientation = await orient(testDir);

    assert.strictEqual(orientation.git.is_repository, false);
    assert.strictEqual(orientation.git.branch, null);
    assert.strictEqual(orientation.git.head, null);
    assert.strictEqual(orientation.git.dirty, null);
  });

  test('should detect Go project', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'go.mod'), 'module example.com/test\ngo 1.20', 'utf8');

    const orientation = await orient(testDir);

    assert.deepStrictEqual(orientation.detected.manifests, ['go.mod']);
    assert.deepStrictEqual(orientation.detected.languages, ['Go']);
    assert.strictEqual(orientation.detected.package_manager, null);
    // Check for Go commands
    assert.deepStrictEqual(orientation.commands.test, ['go test ./...']);
    assert.deepStrictEqual(orientation.commands.build, ['go build ./...']);
    assert.deepStrictEqual(orientation.commands.lint, ['go vet ./...']);
  });

  test('should generate consistent JSON and Markdown', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"name":"test","scripts":{"test":"jest"}}', 'utf8');
    await writeFile(join(testDir, 'README.md'), '# Test', 'utf8');

    const orientation = await orient(testDir);
    const json = await import('../lib/render.mjs').then(({ renderJson }) => renderJson(orientation));
    const markdown = await import('../lib/render.mjs').then(({ renderMarkdown }) => renderMarkdown(orientation));

    // Parse JSON to ensure it's valid
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, orientation);

    // Check that markdown contains some expected strings
    assert.ok(markdown.includes('# Project Orientation'));
    assert.ok(markdown.includes('test'));
    assert.ok(markdown.includes('README.md'));
  });

  test('should not mutate unrelated repository files', async () => {
    testDir = await createTempDir();
    const unrelatedFile = join(testDir, 'unrelated.txt');
    await writeFile(unrelatedFile, 'should not change', 'utf8');

    await orient(testDir);

    const content = await readFile(unrelatedFile, 'utf8');
    assert.strictEqual(content, 'should not change');
  });

  test('should detect git root when project is subdirectory of git repo', async () => {
    const gitRoot = await createTempDir();
    await git(['init'], gitRoot);
    await setupGitConfig(gitRoot);
    // create subproject directory
    const subDir = join(gitRoot, 'subproj');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, 'package.json'), '{"name":"subproj","version":"1.0.0"}', 'utf8');
    // add a commit at root to ensure repo is initialized
    await writeFile(join(gitRoot, '.gitignore'), 'node_modules/\n', 'utf8');
    await git(['add', '.gitignore'], gitRoot);
    await git(['commit', '-m', 'initial'], gitRoot);
    // orient from subdirectory
    const orientation = await orient(subDir);
    // project info
    assert.strictEqual(orientation.project.root, subDir);
    assert.strictEqual(orientation.project.name, 'subproj');
    // manifests
    assert.deepStrictEqual(orientation.detected.manifests, ['package.json']);
    assert.deepStrictEqual(orientation.detected.languages, ['Node.js']);
    // git info
    assert.strictEqual(orientation.git.is_repository, true);
    assert.strictEqual(await realpath(orientation.git.root), await realpath(gitRoot));
    assert.strictEqual(orientation.git.project_is_git_root, false);
    assert.ok(['master', 'main'].includes(orientation.git.branch));
    assert.ok(orientation.git.head.length > 0);
    // dirty may be true due to untracked package.json; just assert it's boolean
    assert.strictEqual(typeof orientation.git.dirty, 'boolean');
  });

  test('should detect git root when project root has manifest but is inside git repo (go.mod)', async () => {
    const gitRoot = await createTempDir();
    await git(['init'], gitRoot);
    await setupGitConfig(gitRoot);
    const subDir = join(gitRoot, 'subproj');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, 'go.mod'), 'module example.com/subproj\ngo 1.20', 'utf8');
    // add a commit at root
    await writeFile(join(gitRoot, '.gitignore'), 'node_modules/\n', 'utf8');
    await git(['add', '.gitignore'], gitRoot);
    await git(['commit', '-m', 'initial'], gitRoot);
    const orientation = await orient(subDir);
    assert.strictEqual(orientation.project.root, subDir);
    assert.strictEqual(orientation.project.name, 'subproj');
    assert.deepStrictEqual(orientation.detected.manifests, ['go.mod']);
    assert.deepStrictEqual(orientation.detected.languages, ['Go']);
    assert.strictEqual(orientation.git.is_repository, true);
    assert.strictEqual(await realpath(orientation.git.root), await realpath(gitRoot));
    assert.strictEqual(orientation.git.project_is_git_root, false);
    assert.ok(['master', 'main'].includes(orientation.git.branch));
    assert.ok(orientation.git.head.length > 0);
    assert.strictEqual(typeof orientation.git.dirty, 'boolean');
  });

  test('should include src directory in important directories when present', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"name":"test"}', 'utf8');
    await mkdir(join(testDir, 'src'), { recursive: true });
    const orientation = await orient(testDir);
    assert.deepStrictEqual(orientation.directories.sort(), ['src'].sort());
  });

  test('should write orientation output under external runtime state', async () => {
    testDir = await createTempDir();
    await writeFile(join(testDir, 'package.json'), '{"name":"write-test","scripts":{"test":"node test.js"}}', 'utf8');
    const orientation = await orient(testDir);
    const { writeOrientation } = await import('../lib/orientation.mjs');
    await writeOrientation(testDir, orientation);
    const state = resolveRuntimeState(testDir);
    const jsonPath = state.orientation_json;
    const mdPath = state.orientation_markdown;
    // ensure files exist by attempting to read
    let jsonErr = null;
    try {
      await readFile(jsonPath, 'utf8');
    } catch (err) {
      jsonErr = err;
    }
    assert.strictEqual(jsonErr, null, `File ${jsonPath} does not exist`);
    let mdErr = null;
    try {
      await readFile(mdPath, 'utf8');
    } catch (err) {
      mdErr = err;
    }
    assert.strictEqual(mdErr, null, `File ${mdPath} does not exist`);
    // verify json content matches orientation
    const jsonContent = await readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(jsonContent);
    assert.deepStrictEqual(parsed, orientation);
    // verify markdown contains expected strings
    const mdContent = await readFile(mdPath, 'utf8');
    assert.ok(mdContent.includes('# Project Orientation'));
    assert.ok(mdContent.includes('node test.js'));
    await assert.rejects(readFile(join(testDir, '.opencode', 'orientation.json'), 'utf8'), /ENOENT/);
  });

  test('does not select a manifest above a Git worktree boundary', async () => {
    const outerDir = await createTempDir();
    testDir = outerDir;
    await writeFile(join(outerDir, 'package.json'), '{"name":"outer-project"}', 'utf8');

    const sourceDir = join(outerDir, 'source');
    await mkdir(sourceDir, { recursive: true });
    await git(['init'], sourceDir);
    await setupGitConfig(sourceDir);
    await writeFile(join(sourceDir, 'README.md'), '# Source repository', 'utf8');
    await git(['add', 'README.md'], sourceDir);
    await git(['commit', '-m', 'initial'], sourceDir);

    const worktreeDir = join(outerDir, 'worktrees', 'child');
    await git(['worktree', 'add', '-b', 'child', worktreeDir], sourceDir);
    const { stdout: actualGitRoot } = await git(['rev-parse', '--show-toplevel'], worktreeDir);
    const canonicalWorktreeDir = await realpath(worktreeDir);
    assert.strictEqual(actualGitRoot.trim(), canonicalWorktreeDir);

    const { stdout } = await execFilePromise(process.execPath, ['../bin/orient.mjs', worktreeDir], {
      cwd: resolve(import.meta.dirname),
      encoding: 'utf8'
    });

    assert.match(stdout, new RegExp(`Project root:\\s+${canonicalWorktreeDir.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
    await readFile(resolveRuntimeState(worktreeDir).orientation_json, 'utf8');
    await assert.rejects(readFile(join(worktreeDir, '.opencode', 'orientation.json'), 'utf8'));
  });
});
