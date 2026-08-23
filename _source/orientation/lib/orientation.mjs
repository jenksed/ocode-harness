import { probeGit, probeGitRoot, probeManifests, probeLanguages, probePackageManager, probeCommands, probeAuthority, probeDirectories } from './probe.mjs';
import { renderJson } from './render.mjs';
import { renderMarkdown } from './render.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cwd } from 'node:process';

/**
 * Orient function - runs all probes and assembles the orientation object.
 * @param {string} projectRoot - The project root directory to orient.
 * @returns {Promise<Object>} Orientation object.
 */
export async function orient(projectRoot) {
  // Resolve the project root to an absolute path
  const absoluteProjectRoot = resolve(projectRoot);

  // Probe project root for manifests, package manager
  const [manifests, packageManager] = await Promise.all([
    probeManifests(absoluteProjectRoot),
    probePackageManager(absoluteProjectRoot)
  ]);

  // Derive languages from manifests
  const languages = probeLanguages(manifests);

  // Probe project root for commands, authority files, directories
  const [commands, authority, directories] = await Promise.all([
    probeCommands(absoluteProjectRoot, manifests, packageManager),
    probeAuthority(absoluteProjectRoot),
    probeDirectories(absoluteProjectRoot)
  ]);

  // Probe for git root
  const gitRoot = await probeGitRoot(absoluteProjectRoot);

  let gitInfo;
  if (gitRoot !== null) {
    // Probe git at the git root
    gitInfo = await probeGit(gitRoot);
    gitInfo = {
      is_repository: gitInfo.is_repository,
      root: gitRoot,
      branch: gitInfo.branch,
      head: gitInfo.head,
      dirty: gitInfo.dirty
    };
  } else {
    gitInfo = {
      is_repository: false,
      root: null,
      branch: null,
      head: null,
      dirty: null
    };
  }

  // Determine if project root is the git root
  gitInfo.project_is_git_root = (gitRoot !== null && absoluteProjectRoot === gitRoot);

  // Determine project name from directory name
  let projectName = absoluteProjectRoot.split(/[\\/]/).pop();

  // Assemble orientation object
  const orientation = {
    schema_version: 1,
    project: {
      name: projectName,
      root: absoluteProjectRoot
    },
    git: gitInfo,
    detected: {
      manifests,
      languages,
      package_manager: packageManager
    },
    commands,
    authority,
    directories
  };

  return orientation;
}

/**
 * Write orientation outputs to .opencode/orientation.json and .opencode/orientation.md
 * @param {string} dir - The directory to write to.
 * @param {Object} orientation - The orientation object.
 * @returns {Promise<void>}
 */
export async function writeOrientation(dir, orientation) {
  const outputDir = join(dir, '.opencode');
  await mkdir(outputDir, { recursive: true });

  const jsonOutput = renderJson(orientation);
  const mdOutput = renderMarkdown(orientation);

  await Promise.all([
    writeFile(join(outputDir, 'orientation.json'), jsonOutput, 'utf8'),
    writeFile(join(outputDir, 'orientation.md'), mdOutput, 'utf8')
  ]);
}