#!/usr/bin/env node
import { orient, writeOrientation } from '../lib/orientation.mjs';
import { probeProjectRoot } from '../lib/probe.mjs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { access, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import util from 'node:util';

const execFilePromise = util.promisify(execFile);

// Get the directory argument, default to current working directory
const dirArg = process.argv[2];
const dir = resolve(dirArg || cwd());

// Check if directory exists (B3)
try {
  await access(dir, constants.F_OK);
} catch (err) {
  console.error(`Error: Directory '${dir}' does not exist`);
  process.exit(1);
}

// A Git worktree is a hard project boundary. Discover it before walking for
// manifests so a manifest in the worktree's parent cannot claim this project.
let gitRoot = null;
try {
  const { stdout: gitRootOut } = await execFilePromise('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  gitRoot = gitRootOut.trim() || null;
} catch (_) {
  // Not in a Git repository; manifest discovery may walk normally.
}

// Probe for project root via manifest files, bounded by the Git worktree when
// one exists.
const { projectRoot: manifestRoot, foundViaManifest } = await probeProjectRoot(dir, { stopAt: gitRoot });

let orientDir;
if (foundViaManifest) {
  // Project markers found - use that as project root (regardless of git)
  orientDir = manifestRoot;
} else {
  // No project markers inside the boundary: use the Git worktree root when
  // available, otherwise preserve the requested directory.
  orientDir = gitRoot || dir;
}

// Run orientation on the determined directory
try {
  const orientation = await orient(orientDir);
  // Write the output files (B1)
  await writeOrientation(orientDir, orientation);

  // Print success report
  const requestedPath = dirArg || cwd();
  const resolvedProjectRoot = orientation.project.root;
  const gitRoot = orientation.git.root;
  const jsonPath = resolve(resolvedProjectRoot, '.opencode', 'orientation.json');
  const mdPath = resolve(resolvedProjectRoot, '.opencode', 'orientation.md');

  console.log('Orientation complete:');
  console.log(`  Requested path:  ${requestedPath}`);
  console.log(`  Project root:    ${resolvedProjectRoot}`);
  if (gitRoot) {
    console.log(`  Git root:        ${gitRoot}`);
  }
  console.log(`  orientation.json: ${jsonPath}`);
  console.log(`  orientation.md:   ${mdPath}`);
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
