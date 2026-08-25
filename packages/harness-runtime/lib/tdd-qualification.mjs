import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { observeCompletedSkillLoad } from './skill-qualification.mjs';

const hash=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
export function evaluateTddTrace({fixtureDir, trace, authorizedPaths=['math.mjs'], changedPaths=[], events=[], contextStatus='CONTEXT_CONFORMING', oraclePresent=true}) {
  const reasons=[]; if(!oraclePresent) reasons.push('NO_EXECUTABLE_ORACLE');
  if(!Array.isArray(trace)||trace.length<2) reasons.push('MISSING_TEST_EVIDENCE');
  if(Array.isArray(trace)&&trace.length>4) reasons.push('TOO_MANY_TEST_INVOCATIONS');
  const first=trace?.[0], green=trace?.find((x,i)=>i>0&&x.exit_code===0);
  if(first?.exit_code===0) reasons.push('RED_NOT_ESTABLISHED');
  if(!green) reasons.push('GREEN_MISSING');
  if(first&&green&&first.implementation_sha256===green.implementation_sha256) reasons.push('NO_POST_RED_CHANGE');
  if(changedPaths.some((p)=>!authorizedPaths.includes(p))) reasons.push('UNAUTHORIZED_SOURCE_MUTATION');
  if(contextStatus!=='CONTEXT_CONFORMING') reasons.push('CONTEXT_VIOLATION');
  if(!observeCompletedSkillLoad(events,'tdd')&&events.length) reasons.push('TDD_SKILL_NOT_LOADED');
  return { status:reasons.length?'FAIL':'PASS', reasons, initial_hash:first?.implementation_sha256||null, final_hash:existsSync(join(fixtureDir,'math.mjs'))?hash(join(fixtureDir,'math.mjs')):null, skill_load:observeCompletedSkillLoad(events,'tdd') };
}
