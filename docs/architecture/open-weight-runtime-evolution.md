# Open-weight runtime evolution

## Status and authority

This is an additive, schema-versioned runtime layer. It does not alter canonical role contracts, OpenCode provider mechanics, FreeLLMAPI routing, acceptance authority, or Git authority. OpenCode remains the one interactive approval owner. FreeLLMAPI continues to route any configured `auto:*` model identifier; Ocode never claims an opaque route identifies a physical model.

The runtime is intentionally split into semantic role contract, immutable TaskCapsule, execution binding, optional qualified behavioral adapter, runtime observations, deterministic validation, and independent review. A better model or an adapter cannot grant edit, stage, commit, push, acceptance, or human-decision authority.

## Low-interruption command policy

`command-admission.mjs` classifies a complete command string deterministically as `OBSERVE`, `VALIDATE`, `WORKSPACE_EFFECT`, `REPOSITORY_EFFECT`, `REMOTE_EFFECT`, `DESTRUCTIVE`, or `UNKNOWN`. Shell composition, expansion, redirection, and unrecognized commands are not parsed optimistically: they are `UNKNOWN` and therefore `ASK`. Remote and destructive patterns are `DENY`; repository effects remain `ASK` except for the deterministic closeout mechanism below.

Validation admission is repository-aware. `createValidationRegistry` snapshots only validation-shaped `package.json` scripts (`test`, `build`, `typecheck`, `lint`, and their named variants) and fingerprints both the definitions and admitted exact commands. Arbitrary scripts such as `deploy` are not admitted. An admitted command is projected only for a role with `test.execute`.

The pinned OpenCode 1.18.21 behavior is now qualified by `scripts/qualify-opencode-permissions.mjs`. Interactive and governed launches project the canonical role's Bash rules plus exact admitted validation. Because observation wildcards were observed to allow redirection, Ocode appends redirection, remote, and destructive denials last; last-match behavior was observed on the pinned runtime. An explicit catch-all remains because OpenCode's observed unmatched default is permissive. `--auto` and blanket Bash allow remain forbidden.

Admitted npm commands resolve through Ocode's transparent validation wrapper. Immediately before execution it compares the current raw `package.json` fingerprint to the admitted registry; a mismatch exits `125` with `OCODE_VALIDATION_REGISTRY_STALE`. Restarting Ocode is the only readmission path. OpenCode remains the only interactive approval owner for commands that remain `ASK`.

## Deterministic staging

`deterministic-staging.mjs` stages only exact accepted paths using `git add -- <paths>` (never `git add .`). The normal deterministic closeout now invokes it before the existing commit step and requires CLI-supplied TaskCapsule and reviewer worktree fingerprints. It requires accepted review, `CLOSEOUT_READY`, passing validation, an empty index, an exact current path set, and an unchanged diff. It rejects stale review, extra/missing files, post-review mutation, pre-staged files, and rename/copy porcelain records. Commit and optional push remain the pre-existing deterministic runtime operations; no model receives generic staging, commit, or push permission.

## TaskCapsule

`TaskCapsule` v1 generalizes the bounded-context approach of `ContextCapsule` into a machine-valid workflow contract. It contains objective, authoritative inputs, scope, non-goals, constraints, acceptance IDs with required evidence, stop conditions, bounded context references, assumptions, and workflow/run/session/role provenance. Its canonical fingerprint is stable for equal content.

Workers pass the same fingerprint through coder, verifier, reviewer, repair, and closeout. Evidence mappings must exactly cover acceptance IDs. A real requirement change is a new revision with the prior fingerprint recorded as `parent_fingerprint`; repair cannot silently weaken the original acceptance contract. `executeGovernedTask` requires a valid TaskCapsule and binds its provenance role to execution. TaskCapsule-bound governed calls now emit telemetry automatically, and deterministic closeout consumes the same fingerprint. Legacy direct role execution remains compatible and deliberately emits no TaskCapsule telemetry. The interactive orchestrator still creates and preserves the capsule in its agent contract; machine interception of an arbitrary first TUI message remains outside this release.

## Telemetry and failure taxonomy

`model_telemetry` is an optional additive field on the existing ledger record, preserving old JSONL rows. Every TaskCapsule-bound governed execution now emits it automatically. It retains requested/effective model status, role, capability, TaskCapsule, adapter identity, profile, outcome, acceptance/review result, validation, repair count, elapsed time, and a bounded failure classification. Token/cost remain null when the transport does not authoritatively supply them. Successful model execution defaults to acceptance `UNRESOLVED` and reviewer `NONE`; execution success never fabricates review acceptance.

The taxonomy is `IMPLEMENTATION_DEFECT`, `VALIDATION_FAILURE`, `REVIEW_DEFECT`, `STRUCTURED_OUTPUT_FAILURE`, `TOOL_USE_FAILURE`, `PERMISSION_BLOCK`, `CONTEXT_FAILURE`, `PREMATURE_COMPLETION`, `SCOPE_VIOLATION`, `INFRASTRUCTURE_FAILURE`, `PROVIDER_FAILURE`, and `UNKNOWN`. Provider and infrastructure failures are always `NON_MODEL`; review rejection is not automatically attributed to a model.

## Qualification, adapters, and resolution

Model qualification derives from retained telemetry, not subjective ratings. The identity includes model reference, capability, adapter, role contract, fixture/protocol fingerprints, runtime version, and qualification protocol version. Each telemetry record carries that exact identity fingerprint, so records from a changed protocol or role contract cannot be pooled. Two independently accepted trials are the minimum for `QUALIFIED`; a model-attributable failure yields `NOT_QUALIFIED`; insufficient evidence is `UNPROVEN`; changed material identity yields `STALE`. `UNKNOWN` effective identity is retained honestly for opaque router routes.

Behavioral adapters are separately versioned `CANDIDATE`, `QUALIFIED`, `REJECTED`, or `STALE` records. They contain only an evidence-backed execution mitigation. They have no authority fields, cannot alter semantic fingerprints, and require before/after qualification evidence before promotion. A qualified exact-model adapter overrides one qualified family adapter deterministically.

Capability resolution deterministically chooses only an existing configured OpenCode identifier: valid explicit override, matching profile binding, another available qualified candidate, then an explicit `UNPROVEN_FALLBACK` or `NO_CANDIDATE`. It selects no provider and attributes no hidden model behind `auto:*`.

## Loop discipline and operator workflow

`tool-loop-control.mjs` detects repeated identical tool/command observations without progress and returns a report/update-hypothesis action. It is telemetry-first, not a hidden session killer. A future enforcement policy needs accumulated evidence and a separate authority decision.

To trial this release safely: run `npm test`, `npm run test:runtime-evolution`, and `npm run qualify:opencode-permissions`; bootstrap through the staged installer; use `ocode` normally; and inspect `.opencode/run-ledger.jsonl`. The local permission qualifier requires no model credential. The TDD live qualifier reached the governed provider request on 2026-08-27 but received FreeLLMAPI `401 Invalid API key`, retained as provider/infrastructure failure rather than model evidence. Disable the optimization by rolling back to the prior installed Ocode; do not remove only the trailing denials while keeping wildcard allows.

Future agents add an adapter by recording recurring retained failures, creating a `CANDIDATE`, running the same qualification fixture with and without it, and promoting only the evidence-backed result. New models are qualified by collecting repeated TaskCapsule-bound telemetry under a named fixture/protocol; a route with hidden effective identity receives only router-level/unknown-identity qualification.
