import assert from 'node:assert/strict';
import { mediateOpenCodePermission, normalizeOpenCodePermissionRequest } from '../packages/harness-runtime/lib/opencode-permission-mediation.mjs';
const event = { type: 'permission.updated', properties: { id: 'p1', sessionID: 's1', messageID: 'm1', callID: 'c1', type: 'bash', pattern: 'pwd', title: 'pwd', metadata: { command: 'pwd' } } };
assert.equal(normalizeOpenCodePermissionRequest(event).runtime_request_id, 'p1');
const handled = new Set(), replies=[];
const reply = async ({ response }) => replies.push(response);
assert.equal((await mediateOpenCodePermission({ event, sessionID:'wrong', reply, resolver:async()=> 'ALLOW_ONCE', handled })).status, 'IGNORED');
assert.equal((await mediateOpenCodePermission({ event, sessionID:'s1', reply, resolver:async()=> 'ALLOW_ONCE', handled })).decision, 'ALLOW_ONCE');
assert.deepEqual(replies, ['once']);
assert.equal((await mediateOpenCodePermission({ event, sessionID:'s1', reply, resolver:async()=> 'ALLOW_ONCE', handled })).status, 'DUPLICATE');
await assert.rejects(() => mediateOpenCodePermission({ event:{...event,properties:{...event.properties,id:'p2'}},sessionID:'s1',reply, resolver:null }), /APPROVAL_REQUIRED/);
await assert.rejects(() => mediateOpenCodePermission({ event:{...event,properties:{...event.properties,id:'p3'}},sessionID:'s1',reply,resolver:async()=> 'ALWAYS' }), /APPROVAL_DECISION_INVALID/);
const rejected = await mediateOpenCodePermission({ event:{...event,properties:{...event.properties,id:'p4'}},sessionID:'s1',reply,resolver:async()=> 'REJECT' });
assert.equal(rejected.decision, 'REJECT'); assert.equal(replies.at(-1), 'reject');
await assert.rejects(
  () => mediateOpenCodePermission({
    event: { ...event, properties: { ...event.properties, id: 'p5' } },
    sessionID: 's1',
    resolver: async () => 'ALLOW_ONCE',
    reply: async () => { throw new Error('OPENCODE_PERMISSION_REPLY_FAILED:transport'); },
  }),
  /OPENCODE_PERMISSION_REPLY_FAILED:transport/,
);
console.log('OPENCODE_PERMISSION_MEDIATION_PROVEN');
