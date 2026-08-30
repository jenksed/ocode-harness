/**
 * Locate Ocode-owned resources relative to the executing runtime package.
 *
 * The source checkout and the installed release intentionally have different
 * outer layouts. The runtime package itself has the same layout in both:
 * <release>/harness-runtime/{bin,lib,plugins}. Keeping this boundary here
 * prevents normal startup from reconstructing a source-tree path.
 */
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function runtimePackageRoot() {
  return runtimeRoot;
}

export function runtimeResourcePath(...segments) {
  const target = resolve(runtimeRoot, ...segments);
  const path = relative(runtimeRoot, target);
  if (!path || path.startsWith('..') || path.includes('..')) {
    throw new Error('Runtime resource path escapes the installed runtime package');
  }
  return target;
}
