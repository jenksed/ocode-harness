# Mature Completion Definition

Ocode is mature when an operator can repeatedly use an exact stable release to understand a real repository, capture bounded intent, decompose work only when evidence makes planning responsible, execute authorized work, verify and independently review outcomes, make human acceptance/release decisions, recover from interruption, and evolve releases without losing evidence or the last known-good runtime.

Completion is property-based. Distant mechanisms may change.

## Required mature properties

### Understanding and intent

- Repository/project understanding is generated from inspectable sources with freshness/provenance.
- Unknowns and stale evidence are explicit; planning stops when uncertainty makes decomposition irresponsible.
- User/owner intent is distinguishable from agent inference and from historical planning.
- Protected program intent cannot be silently changed by an agent.

### Planning and decomposition

- Non-trivial work can be recursively decomposed into bounded contracts with explicit dependencies, scope, non-goals, authority requests, validation, and evidence requirements.
- Decomposition is deterministic enough to inspect and compare; uncertainty routes to Wayfinder/research/owner decision rather than invented detail.
- Planning does not authorize implementation.

### Capability and intelligence

- Engineering methods/capabilities have explicit applicability, requirements, provenance, identity, and qualification.
- Model/provider selection is policy separate from semantic agent authority.
- Compatibility and qualification are re-evaluated when dependency boundaries change.
- Capability never implies constitutional authority.

### Execution and mutation

- Execution consumes exact authorized work and an admitted subject.
- Mutation authority is explicit and least-privilege; configured permission and observed effective subject are evidence, not authority grants.
- Retries are bounded and idempotent where replay can mutate state.
- Mutable development state cannot redefine operator runtime.

### Verification, review, and human authority

- Verification executes declared checks and records exact evidence.
- Independent review is separate from implementation and verification.
- Passing tests is evidence for declared properties, not universal proof.
- Acceptance and release promotion remain explicit human/delegated authority decisions.

### Evidence and provenance

- Accepted work cites evidence sufficient to reconstruct what was executed, by which semantic subject, against what code/release, with what result.
- Failed, superseded, and corrective evidence remains provenance.
- Evidence freshness is scoped to dependencies rather than a global repository timestamp.

### Durability and recovery

- Run/task state has explicit ownership and survives process/session loss.
- Restart reconstructs from persisted state/evidence, not model memory.
- Stale/conflicting state is detected and surfaced.
- Failure leaves a recoverable or terminal state without fabricated completion.

### Operator experience and observability

- The operator can answer what is running, why it was selected, what authority it has, what changed, what passed/failed, what remains unproven, and what decision is required.
- Normal daily use does not require reconstructing hidden conversations or manually correlating unrelated files.
- Observability explains state and evidence but does not become an authority source.

### Release and portability

- Stable, candidate, and dev are explicit, exact identities.
- Stable is immutable, qualified, inspectable, independent of active checkout/worktrees, and the default runtime.
- Candidate is immutable, explicitly selected, and dogfoodable before promotion.
- Promotion selects an already-qualified candidate without rebuilding it.
- Installation is reproducible from an immutable artifact plus machine-private configuration/authentication.
- Upgrade and migration declare compatibility before mutation.
- Rollback selects a retained prior stable and preserves failed-release evidence.
- Real provider/runtime compatibility has explicit qualification evidence.

### Real operation

- The system is dogfooded on unrelated/authentic projects before meaningful promotion.
- Single-task governed operation is proven before parallelism.
- Parallel execution occurs only when declared dependencies and mutation surfaces make it safe.
- Sustained daily work demonstrates recovery, upgrade, candidate evaluation, and evidence retention under normal failures.

### Security boundaries

- Secrets remain outside repository artifacts and release manifests.
- External managed policy is authoritative and is never bypassed.
- No extension, skill, evaluator, planner, or model can bypass admission, acceptance, or release authority.

## Conditional strategic properties

These are not required for mature single-project completion until evidence promotes them:

- multi-project / multi-repository coordination;
- multi-user/team organizational policy;
- third-party extension architecture.

Each remains STRATEGIC with an explicit evidence/decomposition trigger in `program/roadmap.json`.

## Non-goals

- unattended strategic self-authority;
- model output treated as proof;
- automatic release promotion from passing tests;
- general-purpose package-manager infrastructure without demonstrated need;
- worktrees used as runtime/release authority;
- SHA/fingerprint allowlists used as general authorization;
- provider-specific semantic role definitions;
- silent fallback that changes requested intelligence or authority;
- automatic changes to owner intent;
- speculative enterprise/team/plugin architecture before a real use case;
- freezing distant implementation mechanisms merely to make the roadmap look complete.
