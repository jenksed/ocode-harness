# Agentic Agile Operating Doctrine

<!-- VERSION: 1 -->

## Core Principles

- **Evidence Over Trust** — Completion claims require independent validation from verifier and reviewer. No "passed tests" is proof of property.
- **Determinism First** — Every operation has defined inputs, outputs, and failure modes. No hidden state or nondeterministic choices.
- **Explicit Contracts** — File paths, schemas, transitions, and role ownership are declared and validated.
- **Isolation By Default** — Worktrees, temp directories, and explicit file boundaries prevent cross-task contamination.
- **Human Authority Boundary** — Orchestrator is the only human-facing agent; subagents never ask the human for decisions.
- **Cheap Abundance** — Use small models for committer and verifier; expensive models only for planning and coding.
- **Recoverability** — BLOCKED/FAILED transitions back to ACTIVE are always possible.
- **Auditability** — Every decision traceable to ledger record; every change has independent review.

## Minimum Sufficient Planning Guidance

- **QUICK** — Bounded, low-risk changes: coder → reviewer (skip planner, verifier if obvious)
- **STANDARD** — Normal feature work: planner if sequencing unclear → coder → verifier → reviewer
- **DEEP** — Architecture/uncertainty: researcher for external docs → planner if contracts unclear → coder → verifier → reviewer → judge for unresolved disagreements

## Roadmap Maturity Semantics

- **IDEA** — Initial concept, not yet actionable
- **DISCOVERY** — Exploring requirements, constraints, and technical feasibility
- **PLANNING READY** — Requirements and acceptance criteria documented, ready for planner
- **PLANNED** — Planner has produced a detailed plan and dependencies
- **ACTIVE** — Work in progress, tasks being executed
- **PROVEN** — Evidence shows all acceptance criteria met, ready for closeout
- **DEFERRED** — Postponed to future iteration, with documented reason

## Evidence-Producing Increment Loop

1. **Plan** — Define objective, scope, acceptance criteria, workflow type
2. **Execute** — Delegate tasks with explicit `subagent_type` and `subagent` role
3. **Validate** — Verifier runs validation commands; records exit status and output
4. **Review** — Reviewer inspects diff, source, tests; classifies findings as blockers/concerns
5. **Closeout** — Committer prepares semantic commit; evidence gates evaluated; ledger updated

Repeat until PROVEN or DEFERRED.

## Explicit Deferral Language

When deferring work:

- **Reason** — Document why not now (technical dependency, missing information, scope reduction)
- **Trigger** — Define condition under which work becomes PLANNING READY
- **Owner** — Assign responsibility for re-evaluation
- **Timeline** — Optional target iteration/version

Example deferral: "Deferred pending external API documentation (TRIGGER: docs published). Owner: planner. Target: v0.2."

## Deterministic Authority Outranks Doctrine

When authority (human decision, external constraint, security requirement) conflicts with doctrine:
- Authority takes precedence
- Doctrine is updated to reflect new reality
- The conflict is documented in the task's `UNPROVEN/RISKS` section

---

*Canonical Operating Doctrine v1 — Deterministic Evidence Foundation*
