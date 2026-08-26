#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE_SECTIONS = ['identity','purpose','authority','dependencies','evidence','planning','release','execution'];
const REQUIRED_IDENTITY = ['id','title','type','horizon','lifecycle_state','capability_era','release_train'];
const HORIZONS = new Set(['ACTIVE','NEXT','LATER','STRATEGIC']);
const LIFECYCLES = new Set(['future','decomposition_ready','authorized','executing','evidence_pending','accepted','superseded']);
const PARALLELISM = new Set(['parallel-safe','parallel-safe-after-contract-freeze','integration-gated','serialized','owner-decision-blocked']);
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function markdownFiles(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(root, path).replaceAll('\\', '/');
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push({ path, rel });
    }
  }
  walk(root);
  return out;
}

export function validateProgram(root = resolve(__dirname, '..')) {
  const errors = [];
  const warnings = [];
  const roadmapPath = join(root, 'program', 'roadmap.json');
  const evidencePath = join(root, 'program', 'evidence-ledger.json');
  const releasePath = join(root, 'program', 'releases', 'state.json');
  const decisionsPath = join(root, 'program', 'owner-decisions.json');
  const schemaPath = join(root, 'program', 'schemas', 'roadmap-node.schema.json');
  const releaseSchemaPath = join(root, 'program', 'schemas', 'release-manifest.schema.json');
  const rootRoadmapPath = join(root, 'ROADMAP.md');

  let roadmap, evidence, releaseState, decisions, nodeSchema, releaseSchema;
  try { roadmap = loadJson(roadmapPath); } catch (error) { errors.push(`cannot load program/roadmap.json: ${error.message}`); }
  try { evidence = loadJson(evidencePath); } catch (error) { errors.push(`cannot load program/evidence-ledger.json: ${error.message}`); }
  try { releaseState = loadJson(releasePath); } catch (error) { errors.push(`cannot load program/releases/state.json: ${error.message}`); }
  try { decisions = loadJson(decisionsPath); } catch (error) { errors.push(`cannot load program/owner-decisions.json: ${error.message}`); }
  try { nodeSchema = loadJson(schemaPath); } catch (error) { errors.push(`cannot load roadmap-node schema: ${error.message}`); }
  try { releaseSchema = loadJson(releaseSchemaPath); } catch (error) { errors.push(`cannot load release-manifest schema: ${error.message}`); }

  if (errors.length) return { errors, warnings, counts: {} };

  if (roadmap?.authority?.canonical_machine_readable_roadmap !== 'program/roadmap.json') {
    errors.push('program/roadmap.json does not declare itself canonical');
  }
  if (roadmap?.authority?.entry_point !== 'program/README.md') {
    errors.push('program authority entry point must be program/README.md');
  }
  if (!roadmap?.authority?.supersedes_for_active_planning?.includes('ROADMAP.md')) {
    errors.push('active roadmap must explicitly supersede root ROADMAP.md for planning authority');
  }
  if (!Array.isArray(roadmap.nodes)) errors.push('roadmap.nodes must be an array');

  const eraIds = new Set((roadmap.capability_eras || []).map(x => x.id));
  const trainIds = new Set((roadmap.release_trains || []).map(x => x.id));
  const trainToEra = new Map((roadmap.release_trains || []).map(x => [x.id, x.era]));
  const decisionMap = new Map((decisions.decisions || []).map(x => [x.id, x]));
  const evidenceIds = new Set((evidence.entries || []).map(x => x.id));

  const ids = new Set();
  const nodes = roadmap.nodes || [];
  for (const node of nodes) {
    for (const section of REQUIRED_NODE_SECTIONS) {
      if (!node?.[section] || typeof node[section] !== 'object') errors.push(`${node?.identity?.id || '<unknown>'}: missing section ${section}`);
    }
    const id = node?.identity?.id;
    if (!hasText(id)) {
      errors.push('roadmap node missing identity.id');
      continue;
    }
    if (ids.has(id)) errors.push(`duplicate roadmap node id: ${id}`);
    ids.add(id);

    for (const field of REQUIRED_IDENTITY) {
      if (!hasText(node.identity?.[field])) errors.push(`${id}: missing identity.${field}`);
    }
    if (!HORIZONS.has(node.identity.horizon)) errors.push(`${id}: invalid horizon ${node.identity.horizon}`);
    if (!LIFECYCLES.has(node.identity.lifecycle_state)) errors.push(`${id}: invalid lifecycle ${node.identity.lifecycle_state}`);
    if (!eraIds.has(node.identity.capability_era)) errors.push(`${id}: unknown capability era ${node.identity.capability_era}`);
    if (!trainIds.has(node.identity.release_train)) errors.push(`${id}: unknown release train ${node.identity.release_train}`);
    if (trainToEra.get(node.identity.release_train) !== node.identity.capability_era) {
      errors.push(`${id}: release train ${node.identity.release_train} belongs to ${trainToEra.get(node.identity.release_train)}, not ${node.identity.capability_era}`);
    }

    if (!hasText(node.purpose?.intent)) errors.push(`${id}: purpose.intent is required`);
    if (!hasItems(node.purpose?.required_properties)) errors.push(`${id}: at least one required property is required`);
    if (!Array.isArray(node.purpose?.non_goals)) errors.push(`${id}: purpose.non_goals must be an array`);

    for (const field of ['planning_authority','decomposition_authority','implementation_authority','acceptance_authority','release_authority']) {
      if (!hasText(node.authority?.[field])) errors.push(`${id}: authority.${field} is required`);
    }
    if (!hasItems(node.authority?.forbidden_authority)) errors.push(`${id}: forbidden authority must be explicit`);
    if ((node.authority?.planning_authority || '').includes('ROADMAP.md')) errors.push(`${id}: references superseded ROADMAP.md as planning authority`);

    for (const field of ['hard_prerequisites','soft_dependencies','consumed_contracts','unresolved_shared_decisions','integration_dependencies']) {
      if (!Array.isArray(node.dependencies?.[field])) errors.push(`${id}: dependencies.${field} must be an array`);
    }
    for (const ref of node.evidence?.evidence_references || []) {
      if (!evidenceIds.has(ref)) errors.push(`${id}: unknown evidence reference ${ref}`);
    }
    if (!Array.isArray(node.evidence?.known_evidence) || !Array.isArray(node.evidence?.unproven_properties) || !Array.isArray(node.evidence?.required_acceptance_evidence)) {
      errors.push(`${id}: evidence arrays are malformed`);
    }

    for (const decisionId of node.dependencies?.unresolved_shared_decisions || []) {
      if (!decisionMap.has(decisionId)) errors.push(`${id}: unknown owner/shared decision ${decisionId}`);
      const decision = decisionMap.get(decisionId);
      if (node.identity.horizon === 'ACTIVE' && decision && !String(decision.status).startsWith('RESOLVED')) {
        errors.push(`${id}: ACTIVE work is blocked by unresolved decision ${decisionId}`);
      }
    }

    if (!PARALLELISM.has(node.execution?.parallelism_classification)) {
      errors.push(`${id}: invalid parallelism classification ${node.execution?.parallelism_classification}`);
    }

    if (node.identity.horizon === 'ACTIVE') {
      if (!hasItems(node.execution?.work_packages)) errors.push(`${id}: ACTIVE node requires materialized work package`);
      if (!hasItems(node.execution?.validation_commands)) errors.push(`${id}: ACTIVE node requires validation commands`);
      if (!hasItems(node.execution?.completion_output_contract)) errors.push(`${id}: ACTIVE node requires completion output contract`);
      if (!hasItems(node.evidence?.required_acceptance_evidence)) errors.push(`${id}: ACTIVE node requires acceptance evidence`);
      if (!hasItems(node.planning?.stop_conditions)) errors.push(`${id}: ACTIVE node requires stop conditions`);
    }

    if (node.identity.horizon === 'NEXT') {
      if (!hasText(node.planning?.decomposition_trigger)) errors.push(`${id}: NEXT node requires decomposition trigger`);
      if (!hasItems(node.evidence?.required_acceptance_evidence)) errors.push(`${id}: NEXT node requires required acceptance evidence`);
    }

    if (node.identity.horizon === 'LATER' || node.identity.horizon === 'STRATEGIC') {
      if (!hasText(node.planning?.decomposition_trigger)) errors.push(`${id}: distant node requires decomposition trigger`);
      if (!hasText(node.planning?.research_refresh_trigger)) errors.push(`${id}: distant node requires research refresh trigger`);
      if (!hasText(node.planning?.replanning_trigger)) errors.push(`${id}: distant node requires replanning trigger`);
      if (!hasItems(node.evidence?.required_acceptance_evidence)) errors.push(`${id}: distant node requires evidence that authorizes promotion/decomposition`);
    }

    if (node.release?.release_checkpoint === true) {
      if (!hasText(node.release?.usable_capability_created)) errors.push(`${id}: release checkpoint requires usable capability`);
      if (!hasItems(node.release?.candidate_requirements)) errors.push(`${id}: release checkpoint requires candidate requirements`);
      if (!hasItems(node.release?.promotion_requirements)) errors.push(`${id}: release checkpoint requires promotion requirements`);
      if (!hasItems(node.release?.rollback_implications)) errors.push(`${id}: release checkpoint requires rollback implications`);
    }

    if (node.identity.lifecycle_state === 'accepted') {
      if (!hasItems(node.evidence?.required_acceptance_evidence)) errors.push(`${id}: accepted node lacks declared acceptance evidence`);
    }
  }

  for (const node of nodes) {
    const id = node.identity?.id;
    for (const dep of node.dependencies?.hard_prerequisites || []) {
      if (!ids.has(dep)) errors.push(`${id}: orphan hard prerequisite ${dep}`);
      if (dep === id) errors.push(`${id}: self dependency`);
    }
    if (node.identity?.lifecycle_state === 'accepted') {
      for (const dep of node.dependencies?.hard_prerequisites || []) {
        const prereq = nodes.find(n => n.identity?.id === dep);
        if (prereq && prereq.identity.lifecycle_state !== 'accepted') {
          errors.push(`${id}: accepted while hard prerequisite ${dep} is ${prereq.identity.lifecycle_state}`);
        }
      }
    }
  }

  const graph = new Map(nodes.map(n => [n.identity.id, n.dependencies.hard_prerequisites || []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id, stack) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      errors.push(`dependency cycle: ${[...stack.slice(start), id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dep of graph.get(id) || []) if (graph.has(dep)) visit(dep, stack);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);

  const stable = releaseState.stable;
  if (stable !== null) {
    if (!hasText(stable.release_id)) errors.push('stable release lacks exact release_id');
    if (!/^[0-9a-f]{40}$/.test(stable.source_commit || '')) errors.push('stable release lacks exact source_commit');
    if (!stable.artifact_digest || stable.artifact_digest.algorithm !== 'sha256' || !/^[0-9a-f]{64}$/.test(stable.artifact_digest.value || '')) {
      errors.push('stable release lacks exact sha256 artifact identity');
    }
    if (!hasItems(stable.qualification_evidence)) errors.push('stable release lacks qualification evidence');
    if (!hasItems(stable.promotion_evidence)) errors.push('stable release lacks promotion evidence');
  } else if (releaseState?.legacy_installation?.stable_status !== 'UNPROVEN') {
    errors.push('stable=null requires legacy installation stable_status=UNPROVEN');
  }

  if (!nodeSchema?.required?.every(k => REQUIRED_NODE_SECTIONS.includes(k))) {
    errors.push('roadmap-node schema does not require every canonical node section');
  }
  const releaseRequired = new Set(releaseSchema?.required || []);
  for (const field of ['release_id','version','roadmap_milestone','source_commit','artifact_digest','materialization','qualification_evidence','runtime_dependencies','compatibility_constraints','known_limitations','release_state','promotion_authority','promotion_evidence','prior_stable','rollback']) {
    if (!releaseRequired.has(field)) errors.push(`release manifest schema missing required field ${field}`);
  }

  let rootRoadmap = '';
  try { rootRoadmap = readFileSync(rootRoadmapPath, 'utf8'); }
  catch (error) { errors.push(`cannot read root ROADMAP.md: ${error.message}`); }
  if (!/SUPERSEDED/i.test(rootRoadmap) || !rootRoadmap.includes('program/README.md') || !rootRoadmap.includes('program/roadmap.json')) {
    errors.push('root ROADMAP.md must explicitly declare supersession and point to program authority');
  }

  try {
    const contenders = [];
    for (const { path, rel } of markdownFiles(root)) {
      if (rel.startsWith('program/history/')) continue;
      if (rel === 'ROADMAP.md' || rel === 'program/README.md') continue;
      const text = readFileSync(path, 'utf8');
      if (/canonical\s+(?:high-level\s+)?roadmap/i.test(text) || /active program authority\s*:/i.test(text)) contenders.push(rel);
    }
    if (contenders.length) errors.push(`competing active roadmap declarations: ${contenders.join(', ')}`);
  } catch (error) {
    warnings.push(`could not scan Markdown authority declarations: ${error.message}`);
  }

  const counts = {
    nodes: nodes.length,
    active: nodes.filter(n => n.identity.horizon === 'ACTIVE').length,
    next: nodes.filter(n => n.identity.horizon === 'NEXT').length,
    later: nodes.filter(n => n.identity.horizon === 'LATER').length,
    strategic: nodes.filter(n => n.identity.horizon === 'STRATEGIC').length,
    release_checkpoints: nodes.filter(n => n.release.release_checkpoint).length,
    evidence_entries: (evidence.entries || []).length,
    owner_decisions: (decisions.decisions || []).length
  };
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], counts };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = validateProgram();
  if (result.errors.length) {
    console.error(JSON.stringify({ status: 'PROGRAM_INVALID', ...result }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'PROGRAM_STRUCTURE_VALID', ...result }, null, 2));
}
