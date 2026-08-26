import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalFirstToolPath, installApprovalFirstTool } from '../packages/harness-runtime/lib/approval-first-tool-deploy.mjs';

const root = process.cwd();
const home = mkdtempSync(join(tmpdir(), 'approval-first-tool-deploy-'));
const config = join(home, '.config', 'opencode', 'opencode.json');
const target = installApprovalFirstTool(root, config);

assert.equal(target, approvalFirstToolPath(config));
assert.ok(existsSync(target));
const source = readFileSync(target, 'utf8');
assert.match(source, /@opencode-ai\/plugin/);
assert.match(source, /OCODE_HARNESS_ROOT/);
assert.match(source, /createApprovalFirstEffectTool/);
assert.match(source, /harness-runtime\/lib\/approval-first-effect-tool/);
assert.match(source, /helper is not installed/);

const launcher = readFileSync('packages/harness-runtime/bin/ocode.mjs', 'utf8');
assert.match(launcher, /OCODE_HARNESS_ROOT: context\.harnessRoot/);
assert.doesNotMatch(launcher, /opencode-plugins\/approval-first-effect/);

console.log('APPROVAL_FIRST_TOOL_DEPLOYMENT_PROVEN');
