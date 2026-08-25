import assert from 'node:assert/strict';
import { checkpointQualificationExecution, resumeQualificationReport } from '../packages/harness-runtime/lib/skill-qualification.mjs';

const runtime={skill_load:'tdd-method-load',red:'tdd-red',change:'tdd-change',green:'tdd-green',trace:['RED','GREEN']};
const checkpoint=checkpointQualificationExecution({attempt_id:'attempt-3',skill:{skill_id:'tdd',skill_version:'1.0.0',skill_fingerprint:'a'.repeat(64)},runtime,original_model_output:'malformed'});
assert.equal(Object.isFrozen(checkpoint),true);
assert.equal(Object.isFrozen(checkpoint.runtime),true);

let corrections=0;
const repaired=await resumeQualificationReport({checkpoint,parseReported:(value)=>{if(value!=='valid')throw new Error('bad report');return {value};},correct:({checkpoint: supplied})=>{corrections++;assert.equal(supplied.runtime.skill_load,'tdd-method-load');assert.throws(()=>{ supplied.runtime.red='forged'; },TypeError);return 'valid';}});
assert.deepEqual(repaired,{success:true,value:{value:'valid'},repair_count:1});
assert.equal(corrections,1);
assert.equal(checkpoint.runtime.red,'tdd-red');

const failed=await resumeQualificationReport({checkpoint,parseReported:()=>{throw new Error('bad report');},correct:()=> 'still malformed'});
assert.equal(failed.failure_classification,'STRUCTURED_OUTPUT_INVALID');
assert.equal(failed.repair_count,1);

const next=checkpointQualificationExecution({attempt_id:'attempt-4',skill:checkpoint.skill,runtime,original_model_output:'valid'});
const direct=await resumeQualificationReport({checkpoint:next,parseReported:(value)=>value});
assert.equal(direct.repair_count,0);
assert.equal(next.attempt_id,'attempt-4');
assert.equal(checkpoint.attempt_id,'attempt-3');
assert.equal(next.runtime.skill_load,'tdd-method-load');
assert.equal(next.runtime.red,'tdd-red');
assert.equal(next.runtime.green,'tdd-green');
console.log('QUALIFICATION_RECOVERY_PROVEN');
