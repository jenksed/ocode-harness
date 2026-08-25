import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadSkillSource, skillProtocolAdmissionRequest, deriveSkillLifecycle } from '../packages/harness-runtime/lib/skill-contract.mjs';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { evaluateAdmission } from '../packages/harness-runtime/lib/admission.mjs';
const root=resolve('.'), {contracts}=loadAgentContracts({baseDir:root});
for(const [id,role,capabilities] of [['systematic-debugging','verifier',['repository.read','test.execute']],['codebase-investigation','planner',['repository.read']]]){const source=loadSkillSource({skillsDir:resolve(root,'skills'),skillId:id});assert.deepEqual(source.protocol.requirements.capabilities,capabilities);assert.deepEqual(source.protocol.requirements.requested_authority,{edit:false,stage:false,commit:false,push:false});assert.equal(source.protocol.qualification_requirements.live_qualification,'REQUIRED');assert.equal(deriveSkillLifecycle({source,records:[]}),'VALID');assert.equal(evaluateAdmission({contract:contracts.get(role),request:skillProtocolAdmissionRequest(source.protocol,role)}).decision,'ALLOW');assert.equal(evaluateAdmission({contract:contracts.get('coder'),request:skillProtocolAdmissionRequest({...source.protocol,requirements:{...source.protocol.requirements,capabilities:[...capabilities,'command.execute']}},'coder')}).decision,'DENY');}
console.log('M6_3_DETERMINISTIC_PROVEN');
