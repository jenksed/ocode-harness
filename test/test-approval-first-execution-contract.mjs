#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const architecture = readFileSync(resolve(root, 'docs/architecture/approval-first-execution.md'), 'utf8');
const roadmap = readFileSync(resolve(root, 'ROADMAP.md'), 'utf8');

for (const heading of [
  '## Problem and scope', '## Non-goals', '## Terms and state namespaces',
  '## Authority and approval separation', '## Effect classification and role preservation',
  '## Runtime protocol', '## Persistent policy and break-glass boundaries',
  '## Pinned OpenCode 1.18.21 facts and compatibility', '## Migration phases',
  '## Security invariants', '## Acceptance matrix', '## M7 entry-gate implications',
]) assert.match(architecture, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

for (const property of [
  '`ASK` is not `UNKNOWN`', 'unknown action -> ASK; unknown governance state -> fail closed',
  'APPROVAL_RESOLVER_UNAVAILABLE', 'Session approval cannot become persistent policy implicitly.',
  'Approval is operation/session/pattern bounded and never mutates static authority.',
  'OPENCODE_PROJECTION_MISMATCH', 'approval_path=exceptional', 'approval_path=deterministic_closeout',
]) assert.match(architecture, new RegExp(property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

for (const id of 'ABCDEFGHIJ') assert.match(architecture, new RegExp(`\\| ${id} \\|`));
assert.match(roadmap, /Approval-first execution architecture contract/);
assert.match(roadmap, /does not alter M4's proven acceptance claims/i);
console.log('APPROVAL_FIRST_EXECUTION_CONTRACT_PROVEN');
