# Todo Workspace & Activity Observability Reconciliation

## Recovery result

Prior Todo work was found in the separate `feature/todo-workspace` worktree at
`/Users/jenksed/Projects/ocode-harness-todo`. Its branch points to `e08c5a1`;
the Todo implementation itself is four untracked prototype files, not a
cherry-pickable commit. It was inspected read-only and its validation script
passed before this integration.

## Integration decisions

| Component | Decision | Reason |
| --- | --- | --- |
| Compact WORK awareness layout | ADAPT | Good operator density; now projects ActivityEvent v1. |
| Expanded readable work rendering and `renderToString` pattern | ADAPT | Retained as pure terminal-safe renderer functions. |
| Status glyph vocabulary | ADAPT | Runtime agent glyphs now belong to canonical role display metadata. |
| Fixture task data | DEFER | Useful visual examples, not production work truth. |
| `FixtureProvider` | DROP | Fixture-only source, cannot own operational state. |
| `RealProvider` | DEFER | Explicitly unimplemented. |
| Fixture-derived agent ownership/status | REPLACE | Runtime activity derives lifecycle and ownership where available. |
| Full-screen input-owning Todo preview | DROP | It would compete with native OpenCode input and approval UI. |

## Authority model

`ActivityEvent` is runtime activity truth: agent lifecycle, delegation,
verification, review invocation, and native approval/effect transport.

Persistent work items, when a real provider is introduced, remain planned/work
item truth. A work item may say `claimed` or `blocked`; it does not manufacture
an active agent or completed workflow.

The unified WORK view is a read-only projection of those sources. It exposes
each row's source in its view model and does not parse assistant prose.

## Current surface

`ocode activity` now renders a compact human WORK view by default, with
`--verbose`, `--trace`, `--raw`, `--workflow`, and safe polling `--follow`.
`ocode agents` distinguishes configured roles from active/recent runtime roles.

The ordinary `ocode` launcher records its primary orchestrator process start and
terminal state. OpenCode's interactive subagent, approval, and tool event stream
is not yet available through that TUI launch seam; SDK-governed execution retains
the richer live capture from Stage 1. No secondary approval UI is introduced.
