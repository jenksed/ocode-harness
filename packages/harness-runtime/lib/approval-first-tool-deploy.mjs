import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function approvalFirstToolPath(opencodeConfigPath) {
  return join(dirname(opencodeConfigPath), 'tools', 'request_effect.mjs');
}

/** Project the Ocode-owned semantic bridge into OpenCode's documented custom-tool directory. */
export function installApprovalFirstTool(sourceRoot, opencodeConfigPath) {
  const source = join(sourceRoot, 'opencode-tools', 'request_effect.mjs');
  if (!existsSync(source)) throw new Error(`Approval-First request_effect tool missing: ${source}`);
  const target = approvalFirstToolPath(opencodeConfigPath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  return target;
}
