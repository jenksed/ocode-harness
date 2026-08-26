import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DENIED = new Set(['git push', 'git reset --hard', 'git clean']);
const READ_ONLY_GIT = new Set(['git status', 'git diff', 'git log', 'git show']);

export function classifyCheckpointEffect(command) {
  if (typeof command !== 'string' || !command.trim() || /[|;&$`()<>]/.test(command)) return { state: 'UNCLASSIFIABLE' };
  const normalized = command.trim();
  if ([...DENIED].some((value) => normalized === value || normalized.startsWith(`${value} `))) return { state: 'DENY', kind: 'vcs_destructive_or_remote' };
  if (READ_ONLY_GIT.has(normalized) || [...READ_ONLY_GIT].some((value) => normalized.startsWith(`${value} `))) return { state: 'ALLOW', kind: 'vcs_read' };
  if (/^git add\s+[^-][^\n]*$/.test(normalized)) return { state: 'ASK', kind: 'vcs_index', verify: 'git diff --cached --quiet' };
  if (/^git cherry-pick(?:\s+--continue|\s+[0-9a-f]{7,64})$/.test(normalized)) return { state: 'ASK', kind: 'vcs_history' };
  if (/^git commit(?:\s|$)/.test(normalized)) return { state: 'DENY', kind: 'deterministic_closeout_required' };
  return { state: 'ASK', kind: 'command' };
}

function evidence(path, record) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`, { mode: 0o600 });
}

/**
 * Checkpoint-only Ocode authority path. It deliberately bypasses native
 * OpenCode subagent permission inheritance: semantic requester and executor
 * remain separate facts, and only a bounded argv command is executed.
 */
export async function executeApprovalFirstEffect({ command, projectDir, requester = 'orchestrator', sessionId = null, requestId = randomUUID(), reason = null, resolver, evidencePath = '.opencode/approval-ledger.jsonl', spawn = spawnSync }) {
  const classification = classifyCheckpointEffect(command);
  const execution_owner = classification.kind?.startsWith('vcs_') || classification.kind === 'command' ? 'ocode_governed_executor' : null;
  const base = { request_id: requestId, session_id: sessionId, requested_operation: command, reason, requesting_subject: requester, execution_owner, classification };
  evidence(evidencePath, { event: 'REQUEST_OBSERVED', ...base });
  if (classification.state === 'UNCLASSIFIABLE' || classification.state === 'DENY') {
    evidence(evidencePath, { event: 'DECISION', decision: 'DENY', ...base });
    return { status: 'DENIED', ...base };
  }
  if (classification.state === 'ASK') {
    if (typeof resolver !== 'function') return { status: 'APPROVAL_REQUIRED', ...base };
    const decision = await resolver({ ...base, scope: 'ONCE' });
    evidence(evidencePath, { event: 'DECISION', decision, ...base });
    if (decision !== 'ALLOW_ONCE') return { status: 'REJECTED', ...base };
  }
  const [file, ...args] = command.trim().split(/\s+/);
  const result = spawn(file, args, { cwd: projectDir, encoding: 'utf8', timeout: 30_000 });
  const execution = { exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
  evidence(evidencePath, { event: 'EXECUTION_OBSERVED', ...base, execution });
  return { status: result.error || result.status !== 0 ? 'EXECUTION_FAILED' : 'EXECUTED', ...base, execution };
}
