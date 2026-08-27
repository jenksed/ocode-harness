# Open-weight runtime evolution

## Status and authority

This is an additive, schema-versioned runtime layer. It does not alter canonical role contracts, OpenCode provider mechanics, FreeLLMAPI routing, acceptance authority, or Git authority. OpenCode remains the one interactive approval owner. FreeLLMAPI continues to route any configured `auto:*` model identifier; Ocode never claims an opaque route identifies a physical model.

The runtime is intentionally split into semantic role contract, immutable TaskCapsule, execution binding, optional qualified behavioral adapter, runtime observations, deterministic validation, and independent review. A better model or an adapter cannot grant edit, stage, commit, push, acceptance, or human-decision authority.

## Low-interruption command policy

`command-admission.mjs` classifies a complete command string deterministically as `OBSERVE`, `VALIDATE`, `WORKSPACE_EFFECT`, `REPOSITORY_EFFECT`, `REMOTE_EFFECT`, `DESTRUCTIVE`, or `UNKNOWN`. Shell composition, expansion, redirection, and unrecognized commands are not parsed optimistically: they are `UNKNOWN` and therefore `ASK`. Remote and destructive patterns are `DENY`; repository effects remain `ASK` except for the deterministic closeout mechanism below.

Validation admission is repository-aware. `createValidationRegistry` snapshots `package.json` scripts and fingerprints both the definition and admitted exact command. An admitted command is allowed only for a role with `test.execute`; changing the script definition makes the registry `STALE` and returns the action to `ASK`.

The pinned OpenCode 1.18.21 characterization explicitly says its permission precedence and command structure are unproven. Therefore this layer is **not currently projected into native OpenCode `ALLOW` permissions**. Native approval remains unchanged until a repeatable runtime characterization proves safe whole-command matching. This avoids converting an unsafe prefix wildcard into an authority bypass. The mechanism is safe to inspect and test, but disabled as an interactive optimization.

## Deterministic staging

`deterministic-staging.mjs` can stage only exact accepted paths using `git add -- <paths>` (never `git add .`). It requires a TaskCapsule fingerprint, accepted review, `CLOSEOUT_READY`, passing validation, an empty index, an exact current path set, and an unchanged worktree-diff fingerprint. It rejects stale review state, extra or missing files, post-review mutation, pre-staged files, and rename/copy porcelain records. It stages; it does not commit or push. Existing commit/push authority is unchanged.

## TaskCapsule

`TaskCapsule` v1 generalizes the bounded-context approach of `ContextCapsule` into a machine-valid workflow contract. It contains objective, authoritative inputs, scope, non-goals, constraints, acceptance IDs with required evidence, stop conditions, bounded context references, assumptions, and workflow/run/session/role provenance. Its canonical fingerprint is stable for equal content.

Workers pass the same fingerprint through coder, verifier, reviewer, repair, and closeout. Evidence mappings must exactly cover acceptance IDs. A real requirement change is a new revision with the prior fingerprint recorded as `parent_fingerprint`; repair cannot silently weaken the original acceptance contract. `executeGovernedTask` requires a valid TaskCapsule and binds its provenance role to execution. Existing direct execution remains compatible while callers migrate.

## Telemetry and failure taxonomy

`model_telemetry` is an optional additive field on the existing ledger record, preserving old JSONL rows. It retains requested/effective model status, role, capability, TaskCapsule, adapter identity, profile, outcome, acceptance/review result, validation, repair count, elapsed/token/cost data when known, and a bounded failure classification.

The taxonomy is `IMPLEMENTATION_DEFECT`, `VALIDATION_FAILURE`, `REVIEW_DEFECT`, `STRUCTURED_OUTPUT_FAILURE`, `TOOL_USE_FAILURE`, `PERMISSION_BLOCK`, `CONTEXT_FAILURE`, `PREMATURE_COMPLETION`, `SCOPE_VIOLATION`, `INFRASTRUCTURE_FAILURE`, `PROVIDER_FAILURE`, and `UNKNOWN`. Provider and infrastructure failures are always `NON_MODEL`; review rejection is not automatically attributed to a model.

## Qualification, adapters, and resolution

Model qualification derives from retained telemetry, not subjective ratings. The identity includes model reference, capability, adapter, role contract, fixture/protocol fingerprints, runtime version, and qualification protocol version. Each telemetry record carries that exact identity fingerprint, so records from a changed protocol or role contract cannot be pooled. Two independently accepted trials are the minimum for `QUALIFIED`; a model-attributable failure yields `NOT_QUALIFIED`; insufficient evidence is `UNPROVEN`; changed material identity yields `STALE`. `UNKNOWN` effective identity is retained honestly for opaque router routes.

Behavioral adapters are separately versioned `CANDIDATE`, `QUALIFIED`, `REJECTED`, or `STALE` records. They contain only an evidence-backed execution mitigation. They have no authority fields, cannot alter semantic fingerprints, and require before/after qualification evidence before promotion. A qualified exact-model adapter overrides one qualified family adapter deterministically.

Capability resolution deterministically chooses only an existing configured OpenCode identifier: valid explicit override, matching profile binding, another available qualified candidate, then an explicit `UNPROVEN_FALLBACK` or `NO_CANDIDATE`. It selects no provider and attributes no hidden model behind `auto:*`.

## Loop discipline and operator workflow

`tool-loop-control.mjs` detects repeated identical tool/command observations without progress and returns a report/update-hypothesis action. It is telemetry-first, not a hidden session killer. A future enforcement policy needs accumulated evidence and a separate authority decision.

To trial this release safely: run deterministic tests, bootstrap into the normal staged installer, use `ocode` normally, and inspect `.opencode/run-ledger.jsonl` for optional `model_telemetry`. Do not enable a native permission override merely because a command classifier returns `ALLOW`; first re-run and update the OpenCode characterization. To disable this experimental layer, omit TaskCapsules, validation registries, model telemetry, qualification records, adapters, and capability candidates; existing profiles and OpenCode behavior continue unchanged. Roll back through `ocode rollback`.

Future agents add an adapter by recording recurring retained failures, creating a `CANDIDATE`, running the same qualification fixture with and without it, and promoting only the evidence-backed result. New models are qualified by collecting repeated TaskCapsule-bound telemetry under a named fixture/protocol; a route with hidden effective identity receives only router-level/unknown-identity qualification.
