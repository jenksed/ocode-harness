import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const implementation_sha256=createHash('sha256').update(readFileSync('math.mjs')).digest('hex');
const result=spawnSync(process.execPath,['math.test.mjs'],{encoding:'utf8'});
mkdirSync('.qualification',{recursive:true});
const prior=readFileSync('.qualification/tdd-trace.jsonl',{encoding:'utf8',flag:'a+'}).trim().split('\n').filter(Boolean).length;
appendFileSync('.qualification/tdd-trace.jsonl',`${JSON.stringify({sequence:prior+1,implementation_sha256,exit_code:result.status??1,stdout:result.stdout,stderr:result.stderr})}\n`);
process.stdout.write(result.stdout||''); process.stderr.write(result.stderr||''); process.exit(result.status??1);
