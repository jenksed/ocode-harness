import assert from 'node:assert/strict';
import { proveSkills, ROOT } from './catalog-proof-helper.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fingerprints=proveSkills(['systematic-debugging','codebase-investigation']);
assert.notEqual(fingerprints['systematic-debugging'],fingerprints['codebase-investigation']);
const investigation=readFileSync(join(ROOT,'skills/codebase-investigation/SKILL.md'),'utf8');
assert.doesNotMatch(investigation,/what must be understood before planning/i);
console.log(JSON.stringify({status:'M6_3_DETERMINISTIC_PROVEN',fingerprints}));
