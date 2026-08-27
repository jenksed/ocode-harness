# Ocode Lanes — Architecture

## Product Purpose

Ocode Lanes is a deterministic Git execution-topology, workspace-isolation,
dependency-readiness, and integration-readiness substrate for governed Ocode
execution.

## Central Invariant

```
Models may propose work.
Lanes determines whether declared execution topology is valid.
Git determines what topology actually exists.
Evidence determines what was proven.
Humans retain acceptance and release authority.
```

## Authority Separation (Five Truth Domains)

| Domain | Authority | Examples |
|---|---|---|
| DESIRED TOPOLOGY | `LanePlan` | lane identity, intended branch, intended base, declared dependencies, workspace slug, mutation claims |
| OBSERVED GIT STATE | `Git` | actual branch, actual HEAD, worktree path, dirty state, detached state, upstream |
| RESOLVED TOPOLOGY | deterministic L0 resolution (future) | a logical `LANE_CHECKPOINT` reference becomes exact SHA `abc1234…` |
| RUNTIME ACTIVITY | existing Ocode runtime/activity machinery | coder active, verifier invoked, delegation occurred |
| WORK / EVIDENCE STATE | existing Ocode lifecycle/evidence/review/verification/closeout | validation passed, review accepted, closeout ready |

These five domains MUST NOT be collapsed into a single mutable status object.
L0 implements only the first domain and the schema skeleton for checkpoint
representation; it does NOT observe Git, execute work, or evaluate evidence.

## Lane Identity

`lane_id` is the primary identity of a lane. It MUST NOT be conflated with branch
name, worktree path, session, run, or agent.

Validation rule:

```
^[a-z0-9][a-z0-9_-]{0,127}$
```

The following may change independently without destroying historical lane
identity: branch, worktree path, session, run, agent.

## Core Distinctions

```
Lane        !=  Task
Lane        !=  Branch
Lane        !=  Worktree
Lane        !=  Session
Lane        !=  Run
Lane        !=  Agent
```

A Lane references a Task (via `TaskBinding`) but retains its own identity across
task reassignment. A Lane references a Workspace (via `WorkspaceIntent.slug`) but
does not store an absolute path.

## LaneBase

A `LanePlan` lane declares one `base` of type:

- `EXACT_COMMIT` — references an immutable Git commit SHA-1 (40 lowercase hex
  characters). The branch identity is the commit SHA itself.
- `LANE_CHECKPOINT` — references a logical checkpoint (`checkpoint_id` +
  `laneId`) and is NOT resolved to a SHA until that checkpoint exists.

## MutationClaims

Distinguishes the following mutation scopes (all boolean, at least `paths`
required as a repository-relative path):

1. `paths` — repository-relative file paths
2. `resources` — external/non-file resource handles
3. `contracts` — semantic contract changes
4. `generated_outputs` — build/generated artifacts
5. `repository_global_state` — repo-wide configuration or metadata
6. `external_state` — external systems outside the repository

L0 validates the declaration only; conflict calculation is deferred.

## Two-Graph Model

### A. Work Dependency Graph

Edge `A → B` means B requires an output/checkpoint from A before B becomes
eligible.

### B. Integration Order Graph

Edge `B → C` means B must integrate before C.

These graphs MAY overlap but MUST NOT be treated as equivalent. L0 validates
both independently: self-dependencies, unknown references, duplicate edges, and
cycles are rejected in each graph.

## LaneCheckpoint Contract (L0 skeleton)

A checkpoint captures one lane's exact state at a point in time. Checkpoint
classes:

| Class | Semantics |
|---|---|
| `WORK` | A lane reached a buildable/proposable working state. |
| `VERIFIED` | Deterministic validation passed on the checkpoint. |
| `REVIEWED` | An independent review accepted the checkpoint. |
| `ACCEPTED` | The checkpoint passed all gating (verification + review + closeout). |

A checkpoint is NOT equivalent to acceptance. The `ACCEPTED` class denotes a
checkpoint that passed all gates — acceptance remains a human authority.

Checkpoint identity fields: `checkpoint_id`, `lane_id`, exact commit SHA
(SHA-256 fingerprint, 64 hex chars), `checkpoint_class`, `evidence_refs`,
`task_fingerprint` (optional).

## LanePlan Fingerprint

The deterministic fingerprint participates in the following identity fields
(in canonical key-sorted order):

1. `schema_version`
2. `plan_id`
3. `lanes` (all lane IDs as keys + normalized values)
4. `dependency_graph` (edges sorted by `from->to` key)
5. `integration_graph` (edges sorted by `from->to` key)
6. `metadata` (only when non-empty)

The fingerprint MUST NOT depend on:

- absolute local worktree path
- current timestamp
- current username
- current machine
- insertion order of object keys

Fingerprint method: SHA-256 of `canonicalJSONStringify` (the repository's
existing canonicalization from `packages/harness-runtime/lib/agent-contract.mjs`),
which recursively sorts object keys by code-point order.

## Files

| File | Purpose |
|---|---|
| `packages/harness-runtime/lib/lanes/identity.mjs` | LaneId, workspaceSlug, Git SHA + SHA-256 patterns, base-type enum, checkoutReference |
| `packages/harness-runtime/lib/lanes/graph.mjs` | Directed-graph validation + deterministic cycle detection (dependency + integration) |
| `packages/harness-runtime/lib/lanes/contract.mjs` | All L0 domain validators: MutationClaims, TaskBinding, WorkspaceIntent, LaneCheckpoint, LaneDefinition, LaneIntegrationIntent, LanePlan, fingerprint |
| `packages/harness-runtime/lib/lanes/plan.mjs` | Public API: `createLanePlan(raw)`, `computeFingerprint(plan)` |
| `test/test-lanes.mjs` | L0 contract tests (cases A–S + extras) |

## Staged Implementation Sequence

- **L0** (this checkpoint): Contracts, schemas, validation, architecture doc,
  deterministic tests. No Git observation, no worktree creation, no execution.
- **L1** (future): Read-only Git topology observation (branch, HEAD, worktree
  path, dirty state) — see [Recommendation for L1](#recommendation-for-l1).
- **L2-L8** (future): Resolved topology, runtime activity binding, work/evidence
  state reconciliation, materialization, execution binding, parallelism.

## Non-Goals

L0 does NOT implement:

- git worktree/branch creation or deletion
- git switch / checkout / merge / rebase / cherry-pick
- task execution, scheduler, or concurrency
- automatic Git repair
- review, verification, or acceptance authority
- database, TUI, or web UI

If architecture pressure suggests implementing any of these, document the future
requirement and stop at the contract boundary.

## Recommendation for L1

The smallest correct next step is read-only Git topology observation:

1. A `git-observe.mjs` utility that uses `execFileSync('git', …)` to collect:
   actual branch, actual HEAD SHA, worktree path, dirty flag, detached state,
   upstream presence.
2. A `GitTopologySnapshot` schema (schema_version=1) that maps each lane to its
   observed facts.
3. Reconciliation functions that compare `LanePlan.base` (desired) against the
   `GitTopologySnapshot` (observed) using the existing `identity` state enum
   pattern from `packages/harness-runtime/lib/evidence.mjs`.
4. Tests against a fixture git repository (created in a temp directory) that
   verifies dirty/branch/detached detection without requiring a live remote.
