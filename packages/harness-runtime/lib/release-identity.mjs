import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const RELEASE_IDENTITY_SCHEMA_VERSION = 1;
export const RELEASE_IDENTITY_FILENAME = 'RELEASE.json';

function runGit(sourceRoot, args) {
  const result = spawnSync('git', ['-C', sourceRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export function validateReleaseIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('Release identity must be an object');
  }
  if (identity.schema_version !== RELEASE_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`Release identity schema_version must be ${RELEASE_IDENTITY_SCHEMA_VERSION}`);
  }
  if (typeof identity.version !== 'string' || !identity.version) {
    throw new Error('Release identity version must be a non-empty string');
  }
  if (identity.source_commit !== null
      && (typeof identity.source_commit !== 'string' || !/^[0-9a-f]{40}$/.test(identity.source_commit))) {
    throw new Error('Release identity source_commit must be a full lowercase Git SHA or null');
  }
  if (identity.source_ref !== null && (typeof identity.source_ref !== 'string' || !identity.source_ref)) {
    throw new Error('Release identity source_ref must be a non-empty string or null');
  }
  if (identity.source_dirty !== null && typeof identity.source_dirty !== 'boolean') {
    throw new Error('Release identity source_dirty must be boolean or null');
  }
  if (identity.source_commit === null && (identity.source_ref !== null || identity.source_dirty !== null)) {
    throw new Error('Release identity without a source_commit cannot claim a ref or dirty state');
  }
  return identity;
}

export function inspectSourceIdentity(sourceRoot, version) {
  if (typeof version !== 'string' || !version) {
    throw new Error('Cannot inspect release identity without a semantic version');
  }
  const sourceCommit = runGit(sourceRoot, ['rev-parse', '--verify', 'HEAD']);
  if (!sourceCommit || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    return validateReleaseIdentity({
      schema_version: RELEASE_IDENTITY_SCHEMA_VERSION,
      version,
      source_commit: null,
      source_ref: null,
      source_dirty: null,
    });
  }

  const rawRef = runGit(sourceRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const status = runGit(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status === null) {
    throw new Error('Could not determine Git dirty state for release source');
  }

  return validateReleaseIdentity({
    schema_version: RELEASE_IDENTITY_SCHEMA_VERSION,
    version,
    source_commit: sourceCommit,
    source_ref: rawRef || null,
    source_dirty: status.length > 0,
  });
}

export function assertPromotableSourceIdentity(identity) {
  validateReleaseIdentity(identity);
  if (identity.source_commit !== null && identity.source_dirty !== false) {
    throw new Error(
      'OCODE_RELEASE_SOURCE_DIRTY: refusing to promote a dirty Git checkout because commit SHA would not identify the installed bytes',
    );
  }
  return identity;
}

export function isExactReleaseIdentity(identity) {
  try {
    validateReleaseIdentity(identity);
  } catch {
    return false;
  }
  return identity.source_commit !== null && identity.source_dirty === false;
}

export function writeReleaseIdentity(targetDir, identity) {
  validateReleaseIdentity(identity);
  writeFileSync(
    join(targetDir, RELEASE_IDENTITY_FILENAME),
    `${JSON.stringify(identity, null, 2)}\n`,
    'utf8',
  );
  return identity;
}

export function readReleaseIdentity(targetDir) {
  const path = join(targetDir, RELEASE_IDENTITY_FILENAME);
  if (!existsSync(path)) return null;
  let identity;
  try {
    identity = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Malformed release identity at ${path}: ${error.message}`);
  }
  return validateReleaseIdentity(identity);
}

export function sameReleaseIdentity(left, right) {
  return isExactReleaseIdentity(left)
    && isExactReleaseIdentity(right)
    && left.version === right.version
    && left.source_commit === right.source_commit;
}
