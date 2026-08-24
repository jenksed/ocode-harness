# Resource Policy

<!-- VERSION: 1 -->

## Resource Tiers

- **Tier 0 — Deterministic** — Critical infrastructure, ledger, lifecycle, identity. Must be always available. Failure is infrastructure failure.
- **Tier 1 — Cheap Semantic** — Commiter, commit messages, semantic closeout. Abundant, cheap models. Can be temporarily unavailable.
- **Tier 2 — Normal Engineering** — Coder, planner, researcher. Moderate cost. Can be rate-limited.
- **Tier 3 — Strong/Scarce** — Judge, complex reasoning. Expensive, scarce. Use sparingly.

## Failure Taxonomy

- **CAPABILITY_FAILURE** — Agent lacks permission or tool to perform task (e.g., coder asked to research external docs)
- **INFRASTRUCTURE_FAILURE** — External dependency unavailable (network, API, disk, git remote)
- **CONTEXT_FAILURE** — Required repository state not met (missing file, wrong branch, merge conflict)
- **IMPLEMENTATION_FAILURE** — Agent attempted but produced invalid output (syntax error, failed tests)

## Resource Invariants (9 Key Rules)

1. **No Secrets in Repository** — All secrets use `{env:VAR}` pattern; validated by `test/test-secrets.mjs`
2. **Deterministic Output** — Same inputs → same outputs; no nondeterministic randomness in critical paths
3. **Explicit Boundaries** — Each agent works in isolated worktree; no shared mutable state
4. **Evidence Required** — No completion without reviewer ACCEPT and (QUICK or verifier PASS)
5. **Permission Enforcement** — Agent permissions exactly as defined; no elevation of privilege
6. **Version Compatibility** — New runtime versions must be backward compatible with existing agents
7. **Resource Isolation** — Each task gets fresh temp directory; no cross-task contamination
8. **Audit Trail** — Every decision in ledger; cannot be deleted or modified
9. **Recoverability** — BLOCKED/FAILED → ACTIVE transition always possible

## Token/Context Discipline

**Prefer:**
- Environment variables for secrets (`{env:FREELLMAPI_API_KEY}`)
- Explicit `subagent_type` in every Task tool call
- Bounded scope for each delegated task
- Reviewer for any source/test change (even QUICK)

**Avoid:**
- Hardcoding API keys or URLs in code
- Generic subagents ("general", "explore", "scout")
- Implicit agent selection (always specify `subagent_type`)
- Coder running tests (that's verifier's job)

## Provider Failure Handling Rules

1. **Retry Once** — Infrastructure/model failures are retried once before reporting
2. **Document** — Infrastructure failures recorded in ledger `infrastructure_failures` array
3. **Escalate** — After retry, report as BLOCKED with INFRASTRUCTURE_FAILURE
4. **Never Silent** — Never hide failures; always report them in `UNPROVEN/RISKS`
5. **Recover** — From BLOCKED, can retry after fixing infrastructure (transition ACTIVE → ACTIVE)

---

*Canonical Resource Policy v1 — Responsible Consumption*
