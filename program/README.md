# Ocode Program Authority

This directory is the active program-control entry point for Ocode. It exists to make repository state, long-range intent, authority, evidence, release identity, and next-work eligibility recoverable without chat history.

## Authority order

1. Human owner intent is authoritative for protected product/program properties and delegation.
2. Repository architecture and governance contracts constrain implementation and authority mechanisms.
3. `program/intent.md` records the protected program intent accepted for this program model.
4. `program/roadmap.json` is the canonical machine-readable active roadmap and planning state.
5. `program/evidence-ledger.json` is the canonical current-state evidence ledger.
6. `program/releases/state.json` is the canonical declaration of repository-known stable/candidate/dev release state.
7. `program/owner-decisions.json` records explicit owner decisions, defaults, and unresolved owner questions.
8. `program/completion-definition.md` defines bounded mature completion.
9. `program/work-packages/` contains materialized executable work. A work package is not implementation authorization unless its roadmap lifecycle is `authorized`.

`ROADMAP.md` is preserved as historical provenance. It is superseded for active planning authority. Existing architecture, milestone entry contracts, tests, and retained qualification records remain evidence or architectural constraints according to their own scope; this program layer does not silently rewrite them.

Human-readable summaries must not duplicate mutable roadmap state. If prose conflicts with `program/roadmap.json`, the JSON roadmap controls planning state. If roadmap mechanisms conflict with a repository architecture contract, stop and resolve the conflict rather than treating planning as authority.

## Epistemic states

Never collapse these:

`implemented -> tested -> integration-proven -> dogfood-proven -> release-qualified -> owner-promoted`

The arrow means increasing evidence burden, not automatic transition. Passing tests does not prove integration, dogfood, qualification, or promotion. Historical prose saying PROVEN is provenance until the referenced evidence is independently inspected.

## Planning hierarchy

`PROGRAM INTENT -> COMPLETION DEFINITION -> CAPABILITY ERAS -> RELEASE TRAINS -> MAJOR MILESTONES -> WORK PACKAGES -> IMPLEMENTATION TASKS -> ACCEPTANCE EVIDENCE`

Planning resolution decreases with distance. ACTIVE work is implementation-ready; NEXT work is ready for later decomposition; LATER work preserves durable properties while deferring mechanism; STRATEGIC work records conditional direction and the evidence needed to promote it. Do not manufacture task detail to make distant work look precise.

## Planning lifecycle

Program planning lifecycle is separate from runtime/run lifecycle:

`future -> decomposition_ready -> authorized -> executing -> evidence_pending -> accepted -> superseded`

Key rules:

- Horizon and lifecycle are independent. ACTIVE does not mean authorized.
- Only explicit owner/delegated authority moves work into `authorized`.
- An implementation agent may move its bounded work toward evidence collection but may not self-accept.
- Mechanisms may be superseded by program planning authority when protected properties remain unchanged and the reason is recorded.
- Changing protected owner intent requires owner authority.

The existing runtime lifecycle in `packages/harness-runtime/lib/lifecycle.mjs` remains a run/closeout state machine and is not replaced by this planning lifecycle.

## Release lifecycle

Release state is separate from milestone acceptance:

`dev -> candidate -> stable`

- **stable**: immutable, exact, qualified, inspectable, independent of checkouts/worktrees, and the default runtime for real projects.
- **candidate**: immutable and exact, explicitly invoked, dogfoodable, and never promoted automatically.
- **dev**: mutable and explicit; branches/worktrees belong here and never become the runtime default implicitly.
- **promotion**: explicit release authority selects an already-qualified candidate. Promotion does not rebuild from mutable source.
- **rollback**: stable selector moves to a retained, previously qualified release. Git history is not reversed and failed-release evidence is preserved.

At the inspected baseline, the repository cannot prove an exact managed stable release. See `program/releases/state.json`. Do not repair this by declaring `main`, the current checkout, or an existing `VERSION` string to be stable.

## Supersession and replanning

Preserve old plans. When evidence invalidates a mechanism, replace the mechanism while retaining the property it protected and record the reason. If the protected property itself changes, obtain owner authority.

At milestone close:

1. inspect evidence independently;
2. update current state;
3. record newly proven properties;
4. record remaining unproven properties;
5. record invalidated assumptions;
6. evaluate release readiness separately;
7. inspect dependencies;
8. refresh research only where triggers require it;
9. promote eligible nodes into nearer horizons;
10. decompose only eligible work;
11. preserve superseded planning;
12. expose the next authorized work set.

The roadmap evolves by evidence, not by calendar.

## Near-term authority

`MS-R1` is the first ACTIVE milestone: immutable release selection and runtime isolation. It is `decomposition_ready`, not `authorized`. The implementation-ready work package is `program/work-packages/R1-release-runtime-isolation.md`.

No later milestone may consume candidate/stable semantics until MS-R1 is accepted. M6 live qualification is NEXT because its evidence should bind an exact candidate runtime rather than mutable development state.

## Structural validation

Run:

```bash
npm run program:validate
```

The validator checks canonical program structure only: duplicate/orphan IDs, cycles, lifecycle/horizon requirements, acceptance evidence declarations, owner-decision blocks, release checkpoint usability, exact stable identity, supersession declarations, and competing active-roadmap declarations. It is intentionally not a strategic judge.

Full repository validation remains separate:

```bash
npm test
```
