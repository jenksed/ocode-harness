# Repository truth v2.0

`RepositorySnapshot` is the deterministic, model-free inventory of repository reality captured before an Ocode task begins reasoning. It reads Git metadata, a bounded set of repository-declared authority and package files, and tracked-path metadata. It never crawls file bodies or asks a model to establish truth.

## Authority and provenance

Git refs and worktree state are `VERIFIED_FACT`s whose provenance names the Git ref/command. Repository metadata and package topology are verified facts whose provenance is the repository-relative file path. `AGENTS.md` files, root repository guidance, architecture records, release identity, and package manifests are discovered with their path, authority type, and scope. `nearestScopeAuthority()` resolves the closest applicable `AGENTS.md` for a repository-relative target; root-scoped authority and nearer product-local authority remain distinct.

Architecture and repository-authority records are represented as `ACCEPTED_DECISION`s, and checked-in qualification records are `EVIDENCE`. A `WORKING_OBSERVATION` is caller-supplied and retains that class through JSON serialization; validation rejects placing one in verified facts.

Each context fact contains a fact kind, truth class, key/value, provenance, and captured Git state (`head`, `branch`, `dirty`). Missing support is represented as an unknown, never upgraded into a verified claim.

## Capsules

TaskCapsule v1 remains valid. TaskCapsule v2 adds optional `repository_context`, which contains a validated snapshot plus separate `verified_facts`, `decisions`, `evidence`, `observations`, and `unknowns`. ContextCapsule v2 can carry the same optional repository context while retaining its bounded path/evidence budgets. Both preserve their earlier v1 shapes for existing consumers.

## Inspection

Run `ocode context snapshot --json` from a Git repository. It requires no provider, model, or OpenCode runtime access. The JSON has stable ordering and repository-relative identity. The snapshot fingerprint deliberately excludes timing; `createRepositorySnapshot()` separately returns measurement data for Git-command count, file reads, serialized size, and elapsed time.

## Explicitly deferred

This phase does not perform task relevance ranking, embeddings, role projections, delta refresh, cross-project memory, semantic search, or LLM reasoning. It only supplies provenance-backed context primitives for those later phases.
