import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function approvalFirstToolPath(opencodeConfigPath) {
  return join(dirname(opencodeConfigPath), 'tools', 'request_effect.js');
}

/** Project the Ocode-owned semantic bridge into OpenCode's documented custom-tool directory. */
export function installApprovalFirstTool(sourceRoot, opencodeConfigPath) {
  const source = join(sourceRoot, 'opencode-tools', 'request_effect.js');
  if (!existsSync(source)) throw new Error(`Approval-First request_effect tool missing: ${source}`);
  const target = approvalFirstToolPath(opencodeConfigPath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  // 1.18.21 scans .js/.ts. Remove only the legacy Ocode-owned .mjs file so a
  // bootstrap cannot leave an apparently-valid but undiscoverable tool behind.
  rmSync(join(dirname(target), 'request_effect.mjs'), { force: true });
  return target;
}
