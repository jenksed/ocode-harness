import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInteractiveVerificationRuntime } from '../packages/harness-runtime/lib/interactive-activity.mjs';
import { ingestEffectEvidence } from '../packages/harness-runtime/lib/authority-evidence.mjs';

const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
const root=mkdtempSync(join(tmpdir(),'ocode-dd4-production-effect-'));
try {
  git(root,['init']);git(root,['config','user.email','effect@example.test']);git(root,['config','user.name','effect']);writeFileSync(join(root,'README.md'),'x\n');git(root,['add','README.md']);git(root,['commit','-m','x']);const revision=git(root,['rev-parse','HEAD']);writeFileSync(join(root,'dirty.txt'),'dirty\n');const before={status:git(root,['status','--porcelain=v1']),head:revision,branch:git(root,['branch','--show-current'])};
  // Only the production owner is constructed here; it owns authority, bridge,
  // request creation, correlation, grant continuation, execution and cleanup.
  const runtime=createInteractiveVerificationRuntime({projectDir:root,workScope:'verifier-work'});
  const {request,admission}=runtime.requestVerificationEnvironment({revision,session_id:'verifier-session'});assert.equal(admission.status,'APPROVAL_REQUIRED');assert.equal(runtime.continueVerificationEnvironment({request}).environment,null);
  runtime.handleNativeEvent({type:'permission.asked',properties:{id:'native-permission',sessionID:'verifier-session',type:'verification-worktree'}});
  runtime.handleNativeEvent({type:'permission.replied',properties:{permissionID:'native-permission',sessionID:'verifier-session',response:'once'}});
  const executed=runtime.continueVerificationEnvironment({request});assert.equal(executed.admission.status,'ADMITTED');assert.equal(executed.receipt.success,true);assert.equal(ingestEffectEvidence({request,receipt:executed.receipt,report:{request_id:request.request_id,claim:'verification environment'}}).state,'SATISFIED');assert.equal(runtime.continueVerificationEnvironment({request}).reused,true);
  const cleaned=runtime.cleanupVerificationEnvironment({request});assert.deepEqual(cleaned.primary_before,cleaned.primary_after);assert.deepEqual(cleaned.primary_after,before);
  console.log('DD4_PASS_2_PRODUCTION_EFFECT_PROVEN');
} finally {rmSync(root,{recursive:true,force:true});}
