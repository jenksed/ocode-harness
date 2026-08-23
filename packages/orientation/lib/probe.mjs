import { stat, readdir, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import util from 'node:util';
import { constants } from 'node:fs';

const execFilePromise = util.promisify(execFile);

/**
 * Probe for the git root directory containing the given directory.
 * @param {string} dir - The directory to start probing from.
 * @returns {Promise<string|null>} The git root directory, or null if not in a git repo.
 */
export async function probeGitRoot(dir) {
  try {
    const { stdout } = await execFilePromise('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    const gitRoot = stdout.trim();
    if (gitRoot) {
      return gitRoot;
    }
  } catch (_) {
    // Command failed or returned empty string
  }
  return null;
}

/**
 * Probe git repository information.
 * @param {string} dir - The directory to probe.
 * @returns {Promise<{is_repository: boolean, branch?: string, head?: string, dirty?: boolean}>}
 */
export async function probeGit(dir) {
  const gitDotFile = join(dir, '.git');
  let is_repository = false;
  let branch = null;
  let head = null;
  let dirty = null;
  let actualGitDir = null; // Will be set if we find a valid git directory (either .git dir or the path from .git file)

  try {
    const gitStat = await stat(gitDotFile);
    if (gitStat.isDirectory()) {
      // Standard case: .git is a directory
      is_repository = true;
      actualGitDir = gitDotFile; // Not strictly needed for commands, but we have it
    } else if (gitStat.isFile()) {
      // .git is a file (e.g., gitworktree, submodule)
      const content = await readFile(gitDotFile, 'utf8');
      // Parse line like: gitdir: /path/to/git/repo
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        let gitDirPath = match[1].trim();
        // If the path is relative, resolve it relative to the directory containing the .git file
        if (!isAbsolute(gitDirPath)) {
          gitDirPath = resolve(dir, gitDirPath);
        }
        // Now, check if this path exists and is a directory
        try {
          const gitDirStat = await stat(gitDirPath);
          if (gitDirStat.isDirectory()) {
            is_repository = true;
            actualGitDir = gitDirPath;
          }
        } catch (_) {
          // The git directory from the file does not exist or is not a directory
          is_repository = false;
        }
      }
    }
    // If .git exists but is neither file nor directory, or if it's a file but invalid, we fall through to not a repo
  } catch (_) {
    // .git does not exist
    is_repository = false;
  }

  if (is_repository) {
    // Prepare options for git commands: set GIT_DIR to actualGitDir, and keep cwd as dir for the working tree
    const gitEnv = { GIT_DIR: actualGitDir };
    const gitOptions = { cwd: dir, env: { ...process.env, ...gitEnv }, encoding: 'utf8' };

    // Get current branch
    try {
      const { stdout: branchOut } = await execFilePromise('git', ['rev-parse', '--abbrev-ref', 'HEAD'], gitOptions);
      branch = branchOut.trim();
    } catch (_) {
      // If we can't get branch, leave null
    }

    // Get HEAD commit hash
    try {
      const { stdout: headOut } = await execFilePromise('git', ['rev-parse', 'HEAD'], gitOptions);
      head = headOut.trim();
    } catch (_) {
      // If we can't get HEAD, leave null
    }

    // Check if working tree is dirty
    try {
      const { stdout: statusOut } = await execFilePromise('git', ['status', '--porcelain'], gitOptions);
      dirty = statusOut.trim().length > 0;
    } catch (_) {
      // If we can't get status, leave null
    }
  }

  return { is_repository, branch, head, dirty };
}

/**
 * Probe for project root by checking for manifest files.
 * Checks the given directory and walks up parent chain for markers:
 * package.json, go.mod, mix.exs, pyproject.toml, Cargo.toml
 * @param {string} dir - The directory to start probing from.
 * @returns {Promise<{projectRoot: string|null, foundViaManifest: boolean}>}
 */
export async function probeProjectRoot(dir) {
  const manifestNames = ['package.json', 'go.mod', 'mix.exs', 'pyproject.toml', 'Cargo.toml'];
  let currentDir = resolve(dir);

  while (true) {
    for (const name of manifestNames) {
      try {
        await access(join(currentDir, name), constants.F_OK);
        // Found a manifest - this is the project root
        return { projectRoot: currentDir, foundViaManifest: true };
      } catch (_) {
        // File does not exist, continue checking
      }
    }

    // Get parent directory
    const parentDir = resolve(currentDir, '..');
    
    // If we've reached the filesystem root, stop
    if (parentDir === currentDir) {
      break;
    }
    
    currentDir = parentDir;
  }

  // No manifest found in entire chain
  return { projectRoot: null, foundViaManifest: false };
}

/**
 * Probe for manifest files.
 * @param {string} dir - The directory to probe.
 * @returns {Promise<string[]>} Array of manifest names that exist.
 */
export async function probeManifests(dir) {
  const manifestNames = ['package.json', 'go.mod', 'mix.exs', 'pyproject.toml', 'Cargo.toml'];
  const manifests = [];

  for (const name of manifestNames) {
    try {
      await access(join(dir, name), constants.F_OK);
      manifests.push(name);
    } catch (_) {
      // File does not exist, skip
    }
  }

  return manifests;
}

/**
 * Probe languages from manifests.
 * @param {string[]} manifests - Array of manifest names.
 * @returns {string[]} Array of language names.
 */
export function probeLanguages(manifests) {
  const languageMap = {
    'package.json': 'Node.js',
    'go.mod': 'Go',
    'mix.exs': 'Elixir',
    'pyproject.toml': 'Python',
    'Cargo.toml': 'Rust'
  };

  const languages = [];
  for (const manifest of manifests) {
    const lang = languageMap[manifest];
    if (lang && !languages.includes(lang)) {
      languages.push(lang);
    }
  }

  return languages;
}

/**
 * Probe package manager from lock files.
 * @param {string} dir - The directory to probe.
 * @returns {Promise<string|null>} Package manager name or null.
 */
export async function probePackageManager(dir) {
  const lockFiles = [
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'uv.lock', manager: 'uv' },
    { file: 'poetry.lock', manager: 'poetry' }
  ];

  for (const { file, manager } of lockFiles) {
    try {
      await access(join(dir, file), constants.F_OK);
      return manager;
    } catch (_) {
      // File does not exist, continue
    }
  }

  return null;
}

/**
 * Probe commands from package.json (for Node.js) or standard Go commands.
 * @param {string} dir - The directory to probe.
 * @param {string[]} manifests - Array of manifest names.
 * @param {string|null} packageManager - The detected package manager.
 * @returns {Promise<{test: string[], build: string[], lint: string[], typecheck: string[], verify: string[]}>}
 */
export async function probeCommands(dir, manifests, packageManager) {
  const commands = { test: [], build: [], lint: [], typecheck: [], verify: [] };

  // If we have a package.json and the project is Node.js, read scripts
  if (manifests.includes('package.json')) {
    try {
      const packageJson = await readFile(join(dir, 'package.json'), 'utf8');
      const { scripts = {} } = JSON.parse(packageJson);

      // Map script names to command categories
      const scriptMap = {
        test: ['test', 'tests'],
        build: ['build'],
        lint: ['lint'],
        typecheck: ['typecheck', 'types'],
        verify: ['verify']
      };

      for (const [category, keys] of Object.entries(scriptMap)) {
        for (const key of keys) {
          if (scripts[key]) {
            commands[category].push(scripts[key]);
          }
        }
      }
    } catch (_) {
      // If we can't read package.json, leave commands empty
    }
  }

  // For Go projects, add standard Go commands if go.mod is present
  if (manifests.includes('go.mod')) {
    // Go test
    commands.test.push('go test ./...');
    // Go build
    commands.build.push('go build ./...');
    // Go vet
    commands.lint.push('go vet ./...');
    // Note: Go doesn't have a standard typecheck command separate from vet/build, but we can add 'go vet' to typecheck? 
    // However, the schema separates lint and typecheck. We'll put vet in lint and leave typecheck empty for Go.
    // Alternatively, we could check for 'go vet' in lint and leave typecheck empty.
    // We'll follow the example in the task description: for Go: go test ./..., go build ./..., go vet ./..., etc.
    // The task says: for Go: go test ./..., go build ./..., go vet ./..., etc.
    // So we'll assign:
    //   test: go test ./...
    //   build: go build ./...
    //   lint: go vet ./...
    //   typecheck: (leave empty, or maybe we can use 'go tool compile'? but not standard)
    //   verify: (maybe empty)
    // We'll keep as above.
  }

  return commands;
}

/**
 * Probe for authority files.
 * @param {string} dir - The directory to probe.
 * @returns {Promise<string[]>} Array of authority file paths that exist, relative to dir.
 */
export async function probeAuthority(dir) {
  const authorityFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'CONTRIBUTING.md',
    'docs/architecture.md',
    'docs/ARCHITECTURE.md'
  ];

  const authority = [];

  for (const file of authorityFiles) {
    // Split the file path into directory and base name
    const parts = file.split('/');
    let authorityDir = '.';
    let authorityFile = file;
    if (parts.length > 1) {
      authorityDir = parts.slice(0, -1).join('/');
      authorityFile = parts[parts.length - 1];
    }
    const fullDir = join(dir, authorityDir);

    // Check if the directory exists
    try {
      await access(fullDir, constants.F_OK);
    } catch (_) {
      // Directory does not exist, skip this authority file
      continue;
    }

    // Read the directory entries
    let entries;
    try {
      entries = await readdir(fullDir);
    } catch (_) {
      // Cannot read directory, skip
      continue;
    }

    // Look for a case-insensitive match
    const lowerAuthorityFile = authorityFile.toLowerCase();
    for (const entry of entries) {
      if (entry.toLowerCase() === lowerAuthorityFile) {
        // Found a case-insensitive match
        authority.push(file);
        break;
      }
    }
  }

  return authority;
}

/**
 * Probe for important directories.
 * @param {string} dir - The directory to probe.
 * @returns {Promise<string[]>} Array of directory names that exist.
 */
export async function probeDirectories(dir) {
  const directoryNames = ['src', 'lib', 'app', 'cmd', 'internal', 'test', 'tests', 'scripts', 'docs', 'packages', 'apps'];
  const directories = [];

  for (const name of directoryNames) {
    try {
      const stats = await stat(join(dir, name));
      if (stats.isDirectory()) {
        directories.push(name);
      }
    } catch (_) {
      // Not a directory or does not exist, skip
    }
  }

  return directories;
}

// Helper function to check if a path is absolute
function isAbsolute(path) {
  // On Unix-like systems, absolute paths start with '/'
  // On Windows, absolute paths start with a drive letter and a colon and a backslash, or a UNC path.
  // Since we are running on a Unix-like system (darwin) in this environment, we can keep it simple.
  // However, to be cross-platform, we can use the node:path.isAbsolute, but we didn't import it.
  // We'll do a simple check for now, assuming the environment is Unix-like.
  // Alternatively, we can avoid using this helper by checking the first character.
  // Note: the gitdir path might be relative like "../git" or absolute like "/path/to/git".
  // We'll check if the path starts with '/' (Unix absolute) or if it contains a colon and a backslash (Windows) - but we are on Darwin.
  // Let's just check for starting with '/' for simplicity, as the target system is Unix-like.
  // If we want to be more robust, we could import { isAbsolute } from 'node:path', but we are trying to minimize imports.
  // We'll add the import if needed, but let's see: we already have 'resolve' and 'join'. We can use:
  //   if (path.startsWith('/')) { ... } else { ... }
  // However, note that on Windows, an absolute path might start with a drive letter (e.g., "C:\\").
  // Since we are on Darwin, we'll assume Unix-style paths.
  // Alternatively, we can avoid the issue by resolving the path relative to dir and then checking if the resolved path is within a reasonable scope? 
  // But the spec doesn't require handling Windows, so we'll keep it simple.
  return path.startsWith('/');
}