import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSkillSource, skillProtocolAdmissionRequest, deriveSkillLifecycle } from '../packages/harness-runtime/lib/skill-contract.mjs';
import { evaluateDeterministicSkillFixture } from '../packages/harness-runtime/lib/deterministic-skill-qualification.mjs';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { evaluateAdmission } from '../packages/harness-runtime/lib/admission.mjs';
import { projectSkills, checkProjectionDrift, renderSkillProjection } from '../packages/harness-runtime/lib/skill-projection.mjs';

export const ROOT = resolve('.');
export const CATALOG = Object.freeze({
  tdd:{role:'coder',capabilities:['implementation.change','repository.edit','repository.read','test.execute'],authority:{edit:true,stage:false,commit:false,push:false}},
  'systematic-debugging':{role:'verifier',capabilities:['repository.read','test.execute']},
  'codebase-investigation':{role:'planner',capabilities:['repository.read']},
  'blast-radius-analysis':{role:'planner',capabilities:['repository.read']},
  'architecture-change-design':{role:'planner',capabilities:['planning.decompose','repository.read']},
  'adversarial-review':{role:'reviewer',capabilities:['repository.read','review.evaluate','test.execute']},
});

export function proveSkills(ids) {
  const {contracts}=loadAgentContracts({baseDir:ROOT});
  const runtime=mkdtempSync(join(tmpdir(),'ocode-catalog-projection-'));
  projectSkills({skillsDir:join(ROOT,'skills'),runtimeSkillsDir:runtime,skillIds:ids});
  assert.equal(checkProjectionDrift({skillsDir:join(ROOT,'skills'),runtimeSkillsDir:runtime,skillIds:ids}).ok,true);
  const fingerprints={};
  for(const id of ids){
    const spec=CATALOG[id], source=loadSkillSource({skillsDir:join(ROOT,'skills'),skillId:id});
    fingerprints[id]=source.skill_fingerprint;
    assert.deepEqual(source.protocol.requirements.capabilities,spec.capabilities);
    assert.deepEqual(source.protocol.requirements.requested_authority,spec.authority??{edit:false,stage:false,commit:false,push:false});
    assert.equal(source.protocol.qualification_requirements.live_qualification,'REQUIRED');
    assert.equal(deriveSkillLifecycle({source,records:[]}),'VALID');
    assert.ok(source.protocol.applicability.length>=2 && source.protocol.non_applicability.length>=3);
    assert.match(renderSkillProjection(source),new RegExp(`^---\\nname: "${id}"`));
    assert.equal(evaluateAdmission({contract:contracts.get(spec.role),request:skillProtocolAdmissionRequest(source.protocol,spec.role)}).decision,'ALLOW');
    const forbidden={...source.protocol,requirements:{...source.protocol.requirements,capabilities:[...source.protocol.requirements.capabilities,'command.execute']}};
    const denial=evaluateAdmission({contract:contracts.get(spec.role),request:skillProtocolAdmissionRequest(forbidden,spec.role)});
    assert.equal(denial.decision,'DENY'); assert.ok(denial.reason_codes.includes('PERMISSION_NOT_PROJECTED'));
    if(id!=='tdd'){
      const fixture=JSON.parse(readFileSync(join(ROOT,'test/fixtures/m6-catalog',`${id}.json`),'utf8'));
      assert.equal(evaluateDeterministicSkillFixture({source,fixture}).status,'PASS');
    }
  }
  return fingerprints;
}

export function productionSkillIds(){return readdirSync(join(ROOT,'skills'),{withFileTypes:true}).filter((x)=>x.isDirectory()).filter((x)=>{try{return readdirSync(join(ROOT,'skills',x.name)).includes('protocol.json');}catch{return false;}}).map((x)=>x.name).sort();}
