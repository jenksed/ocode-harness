# Ocode Lanes — Architecture

## Status

This document defines the L0.1 Ocode Lanes architecture and desired-topology contract.

L0.1 implements contract definition, normalization, validation, graph validation, and deterministic topology fingerprinting.

L0.1 does not observe or mutate Git.

## Product Purpose

Ocode Lanes is the deterministic Git execution-topology, workspace-isolation, dependency-readiness, and integration-readiness substrate for governed Ocode execution.

Its central invariant is:

> Models may propose work. Lanes determines whether declared execution topology is valid. Git determines what topology actually exists. Evidence determines what was proven. Humans retain acceptance and release authority.

## Authority Domains

Ocode Lanes maintains strict separation between five truth domains.

### Desired Topology

Authority: `LanePlan`

Contains declaration-time intent including:

* lane identity;
* intended branch;
* intended base;
* workspace identity;
* mutation claims;
* task binding;
* dependency relationships;
* integration destination;
* integration ordering.

L0.1 implements this domain.

### Observed Git State

Authority: Git

Examples include:

* worktrees that actually exist;
* branches actually checked out;
* actual HEAD commit;
* dirty state;
* detached state;
* upstream configuration.

L0.1 does not implement Git observation.

### Resolved Topology

Authority: future deterministic Lanes reconciliation/resolution machinery.

Examples include:

* the concrete checkpoint satisfying a logical checkpoint requirement;
* the exact commit resolved for that checkpoint;
* the actual worktree associated with a lane;
* contradictions between declared and observed topology.

L0.1 does not implement resolved topology.

### Runtime Activity

Authority: existing Ocode runtime activity machinery.

Examples include:

* agent execution;
* delegation;
* verification invocation;
* native effect activity.

LanePlan does not own runtime activity state.

### Work and Evidence State

Authority: existing Ocode lifecycle, evidence, verification, review, closeout, and acceptance authorities.

LanePlan does not own task lifecycle state.

## Core Identity Rules

The following are distinct concepts:

```text
Lane != Task
Lane != Branch
Lane != Worktree
Lane != Session
Lane != Run
Lane != Agent

Branch != Base Commit
Desired Checkpoint Requirement != Resolved Checkpoint
Git Commit ID != Semantic SHA-256 Fingerprint
```

`lane_id` is the stable logical identity of a lane.

Branch, worktree location, session, run, and agent execution may vary without changing lane identity.

## LanePlan

A `LanePlan` is the authoritative desired-topology declaration.

Conceptually:

```json
{
  "schema_version": 1,
  "plan_id": "lanes-v1",
  "lanes": {},
  "dependency_graph": [],
  "integration_graph": []
}
```

A LanePlan must contain at least one lane.

All authoritative nested structures are closed contracts. Unknown fields are rejected.

## LaneDefinition

Each lane declares, at minimum:

```json
{
  "lane_id": "runtime-core",
  "branch": "feature/runtime-core",
  "base": {},
  "workspace": {},
  "mutation_claims": {},
  "task_binding": null
}
```

Presentation-only fields may exist where supported by the contract, but they do not determine execution-topology identity.

LaneDefinition contains no mutable task or runtime lifecycle state.

Operational conditions such as materialized, active, drifted, blocked, or integration-ready will be derived by later layers from authoritative facts.

## Branch Intent

Every lane owns one explicit intended local branch name.

Branch identity is independent of base commit identity.

This is valid:

```text
feature/a -> base abc123
feature/b -> base abc123
```

Multiple lanes may share an exact base commit.

Multiple lanes may not claim the same intended branch within one LanePlan.

## Lane Base

A lane base represents intended Git ancestry.

### Exact Commit

An exact-commit base identifies one immutable Git commit using the repository's current Git object-ID representation.

Conceptually:

```json
{
  "kind": "EXACT_COMMIT",
  "commit": "0123456789abcdef0123456789abcdef01234567"
}
```

The exact field/type spelling must match the implementation.

An exact commit is not a branch identity.

### Lane Checkpoint Requirement

A logical checkpoint base declares a prerequisite that may not yet exist.

Conceptually:

```json
{
  "kind": "LANE_CHECKPOINT",
  "lane_id": "runtime-core",
  "minimum_class": "VERIFIED"
}
```

The exact field/type spelling must match the implementation.

The desired plan specifies the requirement.

It does not specify:

* the future checkpoint ID;
* its resolved commit;
* resolution time;
* evidence lookup results.

Those belong to resolved topology.

## Checkpoint Classes

The contract supports checkpoint maturity classes:

```text
WORK
VERIFIED
REVIEWED
ACCEPTED
```

These classes describe prerequisites satisfied by other authorities.

Lanes does not manufacture verification, review, or human acceptance.

In particular, `ACCEPTED` means that an authoritative human-acceptance fact is available to satisfy the checkpoint requirement. It does not mean Lanes granted acceptance.

## LaneCheckpoint

A runtime checkpoint is separate from a LanePlan checkpoint requirement.

Conceptually:

```json
{
  "schema_version": 1,
  "checkpoint_id": "runtime-core-001",
  "lane_id": "runtime-core",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "checkpoint_class": "VERIFIED",
  "evidence_refs": [],
  "task_fingerprint": null
}
```

Git commit identity and semantic fingerprints are different types:

* Git commit: current repository Git object ID;
* task/topology fingerprint: SHA-256 semantic identity.

## Workspace Intent

LanePlan stores a portable logical workspace identifier such as:

```json
{
  "slug": "runtime-core"
}
```

It does not store a machine-specific absolute worktree path.

Workspace paths are resolved from local runtime policy in later milestones.

Two lanes in the same LanePlan may not claim the same workspace slug.

## Mutation Claims

Mutation claims describe the complete declared mutation surface of a lane.

Conceptually:

```json
{
  "paths": [
    "packages/harness-runtime/lib/lanes/**"
  ],
  "resources": [],
  "contracts": [
    "LanePlan.v1"
  ],
  "generated_outputs": [],
  "repository_global_state": [],
  "external_state": []
}
```

The six claim domains are:

1. `paths`
2. `resources`
3. `contracts`
4. `generated_outputs`
5. `repository_global_state`
6. `external_state`

These are identities, not boolean category flags.

L0.1 validates and normalizes declarations.

It does not yet calculate conflict or parallel-execution safety.

## Task Binding

A lane may reference task identity without absorbing task semantics.

Conceptually:

```json
{
  "task_id": "runtime-core",
  "task_fingerprint": "..."
}
```

Task binding does not contain lane identity because the containing LaneDefinition already establishes that identity.

Agent/runtime versions are execution provenance and do not belong in desired topology.

## Relationship Model

Lanes deliberately distinguishes three relationships.

### Base Ancestry

Example:

```text
Lane B bases itself on an eligible checkpoint from Lane A.
```

Base ancestry determines where B's Git history begins.

### Work Dependency

Represented by `dependency_graph`.

```text
A -> B
```

means B requires work/output from A before B becomes eligible.

### Integration Ordering

Represented by `integration_graph`.

```text
A -> B
```

means A must integrate before B.

Base ancestry, work dependency, and integration ordering may overlap, but they are not automatically equivalent.

## Integration Destination

A lane's integration destination, when present, references logical lane identity rather than misusing a Git commit as a destination.

Integration ordering itself has exactly one authority: `integration_graph`.

There is no second independently writable per-lane integration-order representation.

## Graph Contracts

Both dependency and integration graphs contain closed edges:

```json
{
  "from": "lane-a",
  "to": "lane-b"
}
```

Validation rejects:

* unknown lane references;
* self edges;
* duplicate edges;
* cycles;
* unknown edge fields.

Normalized graph edge order is deterministic.

The dependency and integration graphs remain independent.

## Topology Fingerprint

LanePlan's SHA-256 fingerprint represents authority-bearing desired topology.

It includes topology-changing facts such as:

* schema version;
* plan identity;
* lane identity;
* branch;
* base requirement;
* workspace identity;
* mutation claims;
* task binding where present;
* integration destination where present;
* dependency graph;
* integration graph.

It excludes presentation/runtime information such as:

* lane descriptions;
* workspace descriptions;
* timestamps;
* username;
* machine identity;
* absolute worktree path;
* observed Git state;
* runtime activity;
* lifecycle state.

Equivalent normalized topology produces the same fingerprint regardless of input object-key or graph-edge ordering.

## L0.1 Non-Goals

L0.1 does not implement:

* Git repository observation;
* worktree discovery;
* reconciliation;
* checkpoint resolution;
* branch creation;
* worktree creation;
* checkout or switch;
* automatic Git repair;
* execution binding;
* scheduling;
* parallel execution;
* merge;
* rebase;
* cherry-pick;
* push;
* acceptance;
* release promotion.

## Milestone Progression

### L0 / L0.1 — Contract Foundation

Define and validate desired topology.

### L1 — Read-Only Git Observation

Observe repository and worktree reality without comparing it to LanePlan.

Required capabilities include:

* enumerate all worktrees;
* record worktree path;
* record branch or detached state;
* record HEAD commit;
* record dirty/clean condition;
* observe upstream information where available;
* normalize this into a deterministic read-only Git topology snapshot.

L1 performs no Git mutations and does not yet decide whether observed state matches LanePlan.

### L2 — Reconciliation

Compare desired LanePlan topology against observed Git topology.

Classify conditions such as:

```text
MATCH
ABSENT
MATERIALIZABLE
DRIFTED
AMBIGUOUS
STALE
UNRESOLVED
```

L2 remains read-only.

### L3 — Materialization

Safely create declared branches/worktrees from exact resolved bases.

Materialization must be idempotent and crash-recoverable.

### Later Milestones

Later milestones add:

* lane-bound execution;
* checkpoint production/resolution;
* integration readiness;
* recovery;
* safe concurrency;
* planner/compiler integration.

Each remains subject to Ocode's existing authority boundaries.
