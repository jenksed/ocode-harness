import { tool } from '@opencode-ai/plugin';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, existsSync } from 'node:fs';

const harnessRoot = process.env.OCODE_HARNESS_ROOT;
if (!harnessRoot) throw new Error('OCODE_HARNESS_ROOT is required for the Ocode request_effect tool');
if (process.env.OCODE_REQUEST_EFFECT_DIAGNOSTIC_PATH) {
  appendFileSync(process.env.OCODE_REQUEST_EFFECT_DIAGNOSTIC_PATH, `${JSON.stringify({ event: 'TOOL_MODULE_LOADED', tool: 'request_effect' })}\n`);
}

// The repository uses packages/harness-runtime, while the installed harness
// deliberately flattens that package to harness-runtime. This tool is loaded
// from OpenCode's config directory after installation, so source-only lookup
// makes module evaluation fail and removes request_effect from the catalogue.
const helperPath = [
  resolve(harnessRoot, 'packages/harness-runtime/lib/approval-first-effect-tool.mjs'),
  resolve(harnessRoot, 'harness-runtime/lib/approval-first-effect-tool.mjs'),
].find(existsSync);
if (!helperPath) throw new Error('Ocode request_effect helper is not installed');
const helperUrl = pathToFileURL(helperPath).href;
const { createApprovalFirstEffectTool } = await import(helperUrl);

// OpenCode discovers this file from its Ocode-owned tools directory. The
// filename is the externally visible tool name: request_effect.
export default createApprovalFirstEffectTool(tool);
