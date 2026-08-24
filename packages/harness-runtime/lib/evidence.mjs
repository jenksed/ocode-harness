import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function collectEvidence(dir) {
  const absoluteDir = resolve(dir);
  
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: absoluteDir, encoding: 'utf8' }).trim();
    } catch (err) {
      return null;
    }
  };

  // Check if in git repo
  const isRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isRepo) {
    return {
      git_status: '',
      git_diff: '',
      git_branch: null,
      git_remote: null,
      git_head_sha: null,
      git_root: null,
      project_root: absoluteDir,
      dirty: false,
      merge_conflict: false,
      timestamp: new Date().toISOString()
    };
  }

  const status = git(['status', '--porcelain']) || '';
  const diff = git(['diff']) || '';
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  let remote = git(['config', '--get', 'branch.' + branch + '.remote']);
  // Fallback: get first remote if branch doesn't have upstream
  if (!remote) {
    const remotes = git(['remote']);
    if (remotes) {
      remote = remotes.split('\n')[0];
    }
  }
  const headSha = git(['rev-parse', 'HEAD']);
  const gitRoot = git(['rev-parse', '--show-toplevel']);
  
  // Check for merge conflicts
  const mergeConflict = status.includes('UU') || status.includes('AA') || status.includes('DD');

  return {
    git_status: status,
    git_diff: diff,
    git_branch: branch || null,
    git_remote: remote || null,
    git_head_sha: headSha || null,
    git_root: gitRoot || null,
    project_root: absoluteDir,
    dirty: status.length > 0,
    merge_conflict: mergeConflict,
    timestamp: new Date().toISOString()
  };
}

export function getChangedPaths(dir) {
  const absoluteDir = resolve(dir);
  try {
    const output = execFileSync('git', ['status', '--porcelain'], { 
      cwd: absoluteDir, 
      encoding: 'utf8' 
    });
    
    if (!output) return [];
    
    return output.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        // Format: "XY path" where XY are two status chars
        const status = line.slice(0, 2);
        const path = line.slice(3);
        return { path, status };
      });
  } catch (err) {
    return [];
  }
}

export function reconcilePaths(expected, observed) {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed.map(o => o.path));
  
  const unexpected = observed.filter(o => !expectedSet.has(o.path));
  const missing = expected.filter(e => !observedSet.has(e));
  
  return {
    match: unexpected.length === 0 && missing.length === 0,
    unexpected,
    missing
  };
}