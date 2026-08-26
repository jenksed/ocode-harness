import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalFirstEffectTool } from '../packages/harness-runtime/lib/approval-first-effect-tool.mjs';
const project = mkdtempSync(join(tmpdir(), 'approval-plugin-'));
const schema = {
  string() {
    return { min: () => ({ optional: () => ({}) }), optional: () => ({}) };
  },
};
const tool = Object.assign((definition) => definition, { schema });
const exposed = createApprovalFirstEffectTool(tool, { directory: project, agent: { name: 'coder' }, sessionID: 's1' });
assert.ok(exposed);
assert.ok(exposed.args.operation);
assert.ok(exposed.args.reason);
const result = JSON.parse((await exposed.execute({ operation: 'git push' }, {})).output);
assert.equal(result.status, 'DENIED');
const rejected = JSON.parse((await exposed.execute({ operation: 'uname -a' }, {})).output);
assert.equal(rejected.status, 'REJECTED');
const orchestrator = readFileSync(new URL('../agents/orchestrator.md', import.meta.url), 'utf8');
const coder = readFileSync(new URL('../agents/coder.md', import.meta.url), 'utf8');
assert.match(orchestrator, /call `request_effect`/);
assert.match(coder, /call `request_effect`/);
assert.match(orchestrator, /"\*": deny/);
assert.match(coder, /"git add": deny/);
console.log('APPROVAL_FIRST_PLUGIN_BRIDGE_PROVEN');
