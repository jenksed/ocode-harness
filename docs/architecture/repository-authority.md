# Repository integration authority

## Decision

**Canonical integration branch:** `main`.

All new cleanup or reconciliation work starts from the current `origin/main` tip and returns to `main` only through an explicit reconciliation/promotion decision. A branch name, recency, passing checks, or the existence of a review branch does not by itself establish acceptance.

This record was established on 2026-08-27 from the live Git remote and repository history. At inspection, `origin/main` was `28a9c0b8d31f77fe3211617781c5d9b9606cb5d6` (`Merge runtime integration qualification`), which is the accepted implementation baseline immediately preceding this authority-record commit. GitHub's default branch and remote `HEAD` both resolved to `main` at that SHA.

The historical pre-simplification checkpoint is the immutable annotated tag
`pre-simplification-2026-08-26`, which resolves to
`fda6bacd0171619e3b2430ca89eac253e27ef01f`. Its tag message identifies it as
the accepted baseline before the simplification pass. It answers what was
accepted before that pass; it must not be moved to identify later accepted
work.

## Evidence and relationship

`fda6bac` was merged to `main` by GitHub PR #1 (`architecture: adopt
approval-first execution and runtime observability`). At this decision,
`fda6bac` is a strict ancestor of `28a9c0b`; `git rev-list --left-right
--count 28a9c0b...fda6bac` reported `14 0`. Therefore the checkpoint remains
accepted historical provenance, while the live `main` tip is the accepted
integration baseline.

The current `main` tip is the only direct starting point for future cleanup.
Acceptance of a later branch or commit requires an explicit reconciliation or
promotion onto `main`; do not infer it from a branch's label, age, test result,
or review status.

## Branch status at this decision

The counts below are `main...branch` as `main-only, branch-only` at the
recorded baseline. Re-check refs before a later reconciliation.

| Branch | Tip | Classification | Relationship to recorded baseline | Disposition |
| --- | --- | --- | --- | --- |
| `main` | `28a9c0b` | `ACCEPTED_INTEGRATION` | baseline | Branch all new cleanup from its current tip. |
| `checkpoint/pre-simplification-fda6bac` | `fda6bac` | `ACCEPTED_CHECKPOINT` | `14, 0`; contained by `main` | Preserve; do not develop from or move it. |
| `architecture/approval-first-execution` | `fda6bac` | `HISTORICAL` | `14, 0`; contained by `main` | PR #1's merged source line; tag is the durable checkpoint provenance. |
| `review/harness-simplification-v1` | `480c94e` | `SUPERSEDED` | `8, 0`; contained by `main` | Its tip is already in `main`; no direct future consumption. |
| `review/open-weight-runtime-evolution` | `97dc04c` | `SUPERSEDED` | `7, 0`; contained by `main` | Its tip is already in `main`; no direct future consumption. |
| `review/runtime-integration-qualification` | `0410d87` | `SUPERSEDED` | `2, 0`; contained by `main` | Explicitly merged by `28a9c0b`; no direct future consumption. |
| `feature/lanes` | `94bd685` | `ACTIVE_FEATURE` | diverged at `bf6d01a`; `17, 2` | Contains two commits absent from `main`; requires explicit review/reconciliation. |
| `program/long-range-roadmap` | `edebd82` | `PLANNING_ONLY` | diverged at `e08c5a1`; `47, 17` | Contains planning work absent from `main`; it is not an implementation integration line. |
| `ecc-tools/ocode-harness-1787797201668` | `5c3d1ef` | `CANDIDATE_REVIEW` | diverged at `e08c5a1`; `47, 12` | Open PR #2; review and reconcile explicitly before any integration. |

Local-only branches and worktrees are not integration authority. They must be
compared with the then-current `main` before any work is consumed.

## Operating rule

For a fast-forward of `main`, verify immediately beforehand that the remote has
not moved, `main` is an ancestor of the proposed accepted commit, and no
repository governance process requires a pull request. Never rewrite history,
move the checkpoint tag, or merge a candidate merely to simplify the graph.
