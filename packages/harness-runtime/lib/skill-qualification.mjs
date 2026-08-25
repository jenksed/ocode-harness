import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateQualificationRecord } from './skill-contract.mjs';

export function observeCompletedSkillLoad(events, expectedSkill) {
  if (!Array.isArray(events) || typeof expectedSkill !== 'string') return null;
  return events.find((event) => event?.type === 'tool_use' && event?.part?.type === 'tool'
    && event?.part?.tool === 'skill' && event?.part?.state?.status === 'completed'
    && event?.part?.state?.input?.name === expectedSkill) || null;
}

export function fixtureFingerprint({ root, paths, domain }) {
  if(typeof root!=='string'||!root||!Array.isArray(paths)||!paths.length||typeof domain!=='string'||!domain) throw new Error('fixtureFingerprint requires root, paths, and domain');
  const hash=createHash('sha256').update(`OCODE-QUALIFICATION-FIXTURE-V1\0${domain}\0`);
  for(const path of [...paths].sort()) hash.update(path).update('\0').update(readFileSync(join(root,path))).update('\0');
  return hash.digest('hex');
}

export function contextTelemetry(capsule, telemetry={}) {
  return { supplied_path_refs:capsule.path_refs.length, supplied_evidence_refs:capsule.evidence_refs.length,
    supplied_chars:Buffer.byteLength(JSON.stringify(capsule),'utf8'), files_inspected:telemetry.files_inspected||0,
    tool_calls:telemetry.tool_calls||0, external_requests:telemetry.external_requests||0, repair_attempts:telemetry.repair_attempts||0 };
}

export function assembleQualificationRecord(record, source) { return validateQualificationRecord(record,{currentSource:source}); }
