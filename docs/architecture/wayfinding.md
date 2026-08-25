# Wayfinding core

Wayfinder is the governed read-only role that decides whether planning is responsible. It provides `repository.read` and `uncertainty.assess`; it does not provide `planning.decompose` and never produces a task graph.

`WayfindingRequest` v1 contains only objective, constraints, available evidence, and an exploration budget. `WayfindingResult` v1 is a compact downstream boundary: structured knowns/unknowns, evidence references, bounded evidence requests, route alternatives, a recommended route only when justified, exit conditions, and one planning-readiness state.

Readiness is `READY_TO_PLAN`, `PLAN_PREMATURE`, `BLOCKED`, or `ESCALATION_REQUIRED`. Blocking uncertainty cannot coexist with `READY_TO_PLAN`; exhausted resolvable exploration cannot remain `PLAN_PREMATURE`.

Evidence freshness is dependency-scoped. A README change does not invalidate admission evidence that depends only on `packages/harness-runtime/lib/admission.mjs`; a change to that dependency makes it `POSSIBLY_STALE`. Repository SHA is provenance, never a global invalidation switch.

The evidence ladder prefers already-current accepted evidence, local facts, cheap inspection, focused deterministic checks, broader investigation, external research, then escalation. M5 core identifies evidence; it does not execute it, route a provider, or observe effective runtime permission.

M5 final qualification reused a bounded free-profile Wayfinder execution: M4 admission allowed the read-only semantic role, `freellmapi/auto:wayfinder` matched the observed effective binding and subject, structured output validated after one bounded correction, and existing ledger provenance recorded a mutation-free run. `M5_DETERMINISTIC_PROVEN` remains the deterministic-only acceptance label; retained live evidence completes M5.
