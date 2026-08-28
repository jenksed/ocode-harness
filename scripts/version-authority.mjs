import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion } from '../packages/harness-runtime/lib/deploy.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mirrors = [
  { file: 'package.json', paths: [['version']] },
  { file: 'packages/harness-runtime/package.json', paths: [['version']] },
  { file: 'package-lock.json', paths: [['version'], ['packages', '', 'version']] },
];

function readJSON(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function getAt(object, path) { return path.reduce((value, key) => value?.[key], object); }
function setAt(object, path, value) { const parent = path.slice(0, -1).reduce((entry, key) => entry[key], object); parent[path.at(-1)] = value; }

export function checkVersionMirrors(root = repositoryRoot) {
  const version = readVersion(resolve(root, 'VERSION'));
  if (!version) throw new Error('OCODE_PRODUCT_VERSION_MISSING: VERSION is required');
  const drift = [];
  for (const mirror of mirrors) {
    const parsed = readJSON(resolve(root, mirror.file));
    for (const path of mirror.paths) if (getAt(parsed, path) !== version) drift.push(`${mirror.file}:${path.join('.')}`);
  }
  if (drift.length) throw new Error(`OCODE_PRODUCT_VERSION_DRIFT: ${drift.join(', ')} must equal VERSION=${version}`);
  return version;
}

export function syncVersionMirrors(root = repositoryRoot) {
  const version = readVersion(resolve(root, 'VERSION'));
  if (!version) throw new Error('OCODE_PRODUCT_VERSION_MISSING: VERSION is required');
  const changed = [];
  for (const mirror of mirrors) {
    const path = resolve(root, mirror.file);
    const parsed = readJSON(path);
    let dirty = false;
    for (const field of mirror.paths) {
      if (getAt(parsed, field) !== version) { setAt(parsed, field, version); dirty = true; }
    }
    if (dirty) { writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8'); changed.push(mirror.file); }
  }
  return { version, changed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'check') console.log(`PRODUCT_VERSION_OK ${checkVersionMirrors()}`);
  else if (command === 'sync') { const result = syncVersionMirrors(); console.log(`PRODUCT_VERSION_SYNCED ${result.version}${result.changed.length ? ` ${result.changed.join(',')}` : ''}`); }
  else throw new Error('Usage: node scripts/version-authority.mjs check|sync');
}
