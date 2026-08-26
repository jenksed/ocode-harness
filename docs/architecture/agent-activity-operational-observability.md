# Agent Activity & Operational Observability

## Law

**AGENTIC BEHAVIOR SHOULD BE OBSERVABLE, NOT INFERRED.**

**THE RUNTIME ANNOUNCES WHAT HAPPENED. AGENTS DESCRIBE WHAT THEY BELIEVE HAPPENED.**

Runtime activity events are operational authority. Assistant prose, including
claims that a child was delegated, a command was approved, or review passed, is
not lifecycle evidence.

## ActivityEvent v1

`packages/harness-runtime/lib/activity.mjs` owns the closed ActivityEvent v1
schema and stable display metadata for Ocode semantic roles. Every record has:

- `schema_version`, `event_id`, `event_type`, `timestamp`;
- `workflow_id` and optional `session_id`;
- semantic role and optional `agent_instance_id`;
- optional parent role/session and `delegation_id`;
- optional task/work-item/effect request identities;
- runtime status, bounded runtime summary, and bounded metadata.

Event types cover workflow, agent lifecycle, delegation, native effects and
approval, verification, review, and judgment. The schema validates unknown
fields and event types fail closed. Display metadata is presentation-only and
does not grant authority.

## Correlation and graph reconstruction

An execution receives or creates a workflow ID and an agent-instance ID. A
child execution supplied with a parent role/session obtains a delegation ID and
emits `DELEGATION_CREATED`, `DELEGATION_STARTED`, child `AGENT_STARTED`, and
`DELEGATION_RETURNED` at the governed execution seam. The query API rebuilds
nodes from agent instances and edges from delegation IDs, so concurrent children
remain siblings rather than being inferred from ordering or prose.

Direct governed executions own a workflow and announce its start and terminal
state. A higher-level workflow host supplies one workflow ID to all child
executions; it can therefore render the whole graph without reading model text.

## Runtime seams

- `executeGovernedRole` (synchronous, streaming, and SDK transports) records
  governed agent start/complete/failure and delegated lifecycle events.
- The SDK subscription forwards native `permission.updated`,
  `permission.replied`, and tool-part state events while the session is live.
  The projector records effect request/classification/approval/terminal effect
  events. It never stores tool output or derives effects from assistant text.
- `runVerification` records verifier lifecycle and pass/fail from the actual
  deterministic command result, not a verifier report.
- Reviewer invocation is observable when a reviewer session starts. A review
  acceptance/rejection event is intentionally absent until a runtime-owned
  reviewer-verdict seam exists; model-authored verdict text must not create one.

Native OpenCode remains the only approval owner and interaction surface. Activity
events observe its permission transport; they do not introduce an approval
ledger, reply API, or secondary prompt. Effect metadata retains requesting role,
execution owner, operation class, permission ID, and tool call ID without
capturing command output.

## Storage and retention

Activity is operational state, stored outside evidence/provenance authorities at
`.opencode/activity/events/`. Each event is written as an immutable JSON file
through a temporary file plus rename. This avoids rewriting prior records and
leaves an interrupted write isolated. Queries skip malformed records and report
their count. Default retention is the newest 1,000 events; callers may lower or
raise that bounded setting deliberately. Runtime activity is ignored by Git.

This store is not the acceptance-evidence system, execution ledger, or a source
of model truth. It describes runtime activity only.

## Query and inspection

`queryActivity(storePath, options)` supplies recent events, active agents,
recently completed agents, a delegation graph, effect/approval events, and
verification/review state. The minimal inspection command is:

```sh
ocode activity --raw
ocode activity --workflow <workflow-id>
```

## Deliberate stage boundary

This stage supplies event authority, durable bounded storage, and a debug JSON
surface. It does not supply a polished TUI, live panels, verbosity preferences,
or a runtime-owned structured reviewer verdict. The next operator UX stage must
consume these queries and must not scrape assistant prose.
