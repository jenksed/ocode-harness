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

## Interactive OpenCode transport

For ordinary `ocode .`, `lib/interactive-activity.mjs` owns a local pinned
OpenCode 1.18.21 server and launches the normal OpenCode terminal client with
`opencode attach <server-url> --dir <project>`. Before the client is attached,
the bridge subscribes to the server's directory-scoped event transport.

The bridge consumes only native server records: `session.created`/
`session.updated` (including `parentID`), `message.part.updated` subtask and
tool parts, session idle/error status, and native permission asked/replied
records. The interactive runtime spelling is `permission.asked`; the generated
SDK's compatible schema spells that payload `permission.updated`, and both are
handled as the same native event family.

An Ocode role is accepted only when the structured subtask `agent` identity is
one of the configured canonical role IDs. Unknown agent IDs remain unknown and
are not relabelled from prompts, titles, output, or assistant text. A child
session is linked only by its runtime `parentID` and the immediately-correlated
subtask record; ambiguous unpaired parallel records are left unlabelled rather
than guessed. This preserves correctness over a prettier but fabricated graph.

The launcher does not write live announcements into OpenCode's active terminal
after attachment. OpenCode retains sole ownership of stdin, cursor layout, and
native approval dialogs. The same live ledger is safely available from another
terminal through `ocode activity --follow`; `ocode activity` and `ocode agents`
render that event-backed projection after or alongside the session.

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

## Remaining boundary

This work does not add a second terminal UI, an approval prompt, or a
runtime-owned structured reviewer verdict. OpenCode's native interface remains
the conversation and approval owner. A later enhancement may use a supported
in-TUI plugin/status seam, if one is qualified, but must consume this same event
ledger and must not scrape assistant prose.
