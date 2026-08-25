import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateTaskId, generateRunId } from './identity.mjs';
import { LIFECYCLE_STATES } from './lifecycle.mjs';

const LEDGER_SCHEMA_VERSION = 1;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const WORKFLOW_TYPES = ['QUICK', 'STANDARD', 'DEEP'];
const STATUSES = ['COMPLETE', 'BLOCKED', 'FAILED'];
const VERDICTS = ['ACCEPT', 'REJECT', 'NONE'];

function validateRecord(record) {
  if (record.schema_version !== LEDGER_SCHEMA_VERSION) {
    throw new Error(`Schema version mismatch: expected ${LEDGER_SCHEMA_VERSION}, got ${record.schema_version}`);
  }
  if (!UUID_REGEX.test(record.task_id)) throw new Error('Invalid task_id format');
  if (!UUID_REGEX.test(record.run_id)) throw new Error('Invalid run_id format');
  if (!ISO8601_REGEX.test(record.timestamp)) throw new Error('Invalid timestamp format');
  if (!LIFECYCLE_STATES.includes(record.lifecycle_state)) {
    throw new Error(`Invalid lifecycle_state: ${record.lifecycle_state}`);
  }
  if (!WORKFLOW_TYPES.includes(record.workflow)) {
    throw new Error(`Invalid workflow: ${record.workflow}`);
  }
  if (!STATUSES.includes(record.status)) {
    throw new Error(`Invalid status: ${record.status}`);
  }
  if (!VERDICTS.includes(record.reviewer_verdict)) {
    throw new Error(`Invalid reviewer_verdict: ${record.reviewer_verdict}`);
  }
  if (typeof record.repair_cycles !== 'number' || record.repair_cycles < 0) {
    throw new Error('repair_cycles must be a non-negative integer');
  }
  if (typeof record.planner_used !== 'boolean') throw new Error('planner_used must be boolean');
  if (typeof record.research_used !== 'boolean') throw new Error('research_used must be boolean');
  if (!Array.isArray(record.agents_used)) throw new Error('agents_used must be array');
  if (!Array.isArray(record.agents_skipped)) throw new Error('agents_skipped must be array');
  if (!Array.isArray(record.files_changed)) throw new Error('files_changed must be array');
  if (!Array.isArray(record.validation_commands)) throw new Error('validation_commands must be array');
  if (!Array.isArray(record.validation_results)) throw new Error('validation_results must be array');
  if (record.closeout) {
    if (typeof record.closeout.attempted !== 'boolean') throw new Error('closeout.attempted must be boolean');
    if (typeof record.closeout.committed !== 'boolean') throw new Error('closeout.committed must be boolean');
    if (typeof record.closeout.pushed !== 'boolean') throw new Error('closeout.pushed must be boolean');
  }
  if (record.execution_provenance !== null && record.execution_provenance !== undefined) {
    const provenance = record.execution_provenance;
    if (provenance.schema_version !== 1) throw new Error('execution_provenance.schema_version must be 1');
    if (!provenance.subject || typeof provenance.subject.role !== 'string') {
      throw new Error('execution_provenance.subject.role must be a string');
    }
    if (typeof provenance.subject.contract_fingerprint !== 'string') {
      throw new Error('execution_provenance.subject.contract_fingerprint must be a string');
    }
    if (!provenance.execution_policy || typeof provenance.execution_policy.profile !== 'string') {
      throw new Error('execution_provenance.execution_policy.profile must be a string');
    }
    if (!Number.isInteger(provenance.execution_policy.policy_version)) {
      throw new Error('execution_provenance.execution_policy.policy_version must be an integer');
    }
    for (const field of ['profile_fingerprint', 'requested_model', 'binding_source', 'fallback']) {
      if (typeof provenance.execution_policy[field] !== 'string') {
        throw new Error(`execution_provenance.execution_policy.${field} must be a string`);
      }
    }
    if (!['MATCH', 'MISMATCH', 'UNKNOWN'].includes(provenance.binding_reconciliation)) {
      throw new Error('execution_provenance.binding_reconciliation is invalid');
    }
    if (typeof provenance.success !== 'boolean') throw new Error('execution_provenance.success must be boolean');
    if (provenance.effective_model !== null && typeof provenance.effective_model !== 'string') {
      throw new Error('execution_provenance.effective_model must be a string or null');
    }
  }
}

export function createLedgerRecord(params) {
  const now = new Date().toISOString();
  const record = {
    schema_version: LEDGER_SCHEMA_VERSION,
    task_id: params.task_id || generateTaskId(),
    run_id: params.run_id || generateRunId(),
    timestamp: params.timestamp || now,
    lifecycle_state: params.lifecycle_state || 'ACTIVE',
    project_name: params.project_name || 'unknown',
    project_root: params.project_root || '',
    workflow: params.workflow || 'QUICK',
    status: params.status || 'COMPLETE',
    agents_used: params.agents_used || [],
    agents_skipped: params.agents_skipped || [],
    files_changed: params.files_changed || [],
    validation_commands: params.validation_commands || [],
    validation_results: params.validation_results || [],
    reviewer_verdict: params.reviewer_verdict || 'NONE',
    repair_cycles: params.repair_cycles || 0,
    planner_used: params.planner_used || false,
    research_used: params.research_used || false,
    closeout: params.closeout || {
      attempted: false,
      committed: false,
      commit_sha: null,
      pushed: false,
      branch: null,
      remote: null
    },
    // Optional fields
    agent_models: params.agent_models || {},
    provider: params.provider || null,
    elapsed_ms: params.elapsed_ms || null,
    infrastructure_failures: params.infrastructure_failures || [],
    retry_counts: params.retry_counts || {},
    execution_provenance: params.execution_provenance || null,
  };
  
  validateRecord(record);
  return record;
}

export function appendRecord(ledgerPath, record) {
  const absolutePath = resolve(ledgerPath);
  const dir = dirname(absolutePath);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  validateRecord(record);
  const data = JSON.stringify(record) + '\n';
  writeFileSync(absolutePath, data, { flag: 'a', encoding: 'utf8' });
}

export function readRecords(ledgerPath) {
  const absolutePath = resolve(ledgerPath);
  
  if (!existsSync(absolutePath)) {
    return [];
  }
  
  const content = readFileSync(absolutePath, 'utf8');
  if (!content.trim()) return [];
  
  return content.split('\n')
    .filter(line => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Malformed ledger record at line ${index + 1}: ${err.message}`);
      }
    });
}

export function getLatestRecord(ledgerPath) {
  const records = readRecords(ledgerPath);
  return records.length > 0 ? records[records.length - 1] : null;
}

export function getRecentRecords(ledgerPath, count = 10) {
  const records = readRecords(ledgerPath);
  return records.slice(-count);
}

export function getRecordByRunId(ledgerPath, runId) {
  return readRecords(ledgerPath).find((record) => record.run_id === runId) || null;
}

export { LEDGER_SCHEMA_VERSION};
