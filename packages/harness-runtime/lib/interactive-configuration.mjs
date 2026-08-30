import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPreExecutionAuthorityGuardOptions } from './pre-execution-authority-guard.mjs';
import { runtimeResourcePath } from './runtime-paths.mjs';

/**
 * OpenCode deep-merges agent frontmatter with OPENCODE_CONFIG_CONTENT while
 * retaining existing object-key order. Its last-match Bash matcher therefore
 * makes a stale installed agent an authority input. Interactive Ocode owns
 * its semantic agents, so run from an isolated configuration containing the
 * selected runtime agents and the user's non-agent global config.
 */
export function createRuntimeBoundOpenCodeEnvironment({ harnessRoot, environment = process.env } = {}) {
  const configHome = mkdtempSync(join(tmpdir(), 'ocode-runtime-config-'));
  const target = join(configHome, 'opencode');
  const originalHome = environment.XDG_CONFIG_HOME
    ? resolve(environment.XDG_CONFIG_HOME)
    : resolve(homedir(), '.config');
  const original = join(originalHome, 'opencode');
  try {
    mkdirSync(target, { recursive: true });
    // Preserve user/provider settings without importing a second set of Ocode
    // agent frontmatter. Agent identity and permission order are runtime-owned.
    for (const name of ['config.json', 'opencode.json', 'opencode.jsonc']) {
      const source = join(original, name);
      if (existsSync(source)) copyFileSync(source, join(target, name));
    }
    cpSync(resolve(harnessRoot, 'agents'), join(target, 'agents'), { recursive: true });
    return {
      config_home: configHome,
      environment: {
        ...environment,
        XDG_CONFIG_HOME: configHome,
        OPENCODE_CONFIG_DIR: target,
        // Project-local agent/config layers cannot become an unordered second
        // policy owner for Ocode's governed role names.
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      },
      cleanup: () => rmSync(configHome, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(configHome, { recursive: true, force: true });
    throw error;
  }
}

/** Runtime owns the entire Bash map; preserve unrelated permission categories. */
export function applyInteractiveRuntimePermissions(overlayConfig, runtimePermissions) {
  for (const [role, projected] of Object.entries(runtimePermissions.agents)) {
    overlayConfig.agent[role] = {
      ...overlayConfig.agent[role],
      permission: {
        ...(overlayConfig.agent[role]?.permission ?? {}),
        ...projected.permission,
        bash: projected.permission.bash,
      },
    };
  }
  return overlayConfig;
}

/** Install the runtime-owned, deny-only guard into Ocode's owned overlay. */
export function applyPreExecutionAuthorityGuard(overlayConfig, { contracts, validationRegistry = null } = {}) {
  if (!overlayConfig || typeof overlayConfig !== 'object' || Array.isArray(overlayConfig)) throw new Error('OpenCode runtime overlay must be an object');
  if (overlayConfig.plugin !== undefined && !Array.isArray(overlayConfig.plugin)) throw new Error('OpenCode runtime overlay plugin field must be an array');
  const guard = [
    runtimeResourcePath('plugins', 'pre-execution-authority-guard.mjs'),
    { ...createPreExecutionAuthorityGuardOptions({ contracts }), validationRegistry },
  ];
  overlayConfig.plugin = [guard, ...(overlayConfig.plugin ?? [])];
  return overlayConfig;
}
