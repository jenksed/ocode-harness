# Ocode Roadmap

This file is the canonical high-level roadmap for the Ocode program.

North-star acceptance property:

> A clean machine can reconstruct Ocode from repository source plus machine-private configuration/authentication, prove install/update/rollback/runtime integrity, and then execute governed agentic development through deterministic evidence, authority boundaries, and recoverable state transitions.

## Status Legend

- PROVEN: implemented and validated by repository/runtime evidence.
- ACTIVE: current work in progress.
- PLANNED: not implemented; details require the full roadmap prompt or later design.
- BLOCKED: cannot progress without external authority/input.

## Milestones

### M0 Canonical Repository Baseline — PROVEN

Purpose: make the repository internally trustworthy before broader roadmap work.

Evidence required:
- clean source has no unresolved merge-conflict markers
- tests covering installer, doctor, agents, composition, committer, secrets, ledger, lifecycle, evidence, closeout, verification, version, update, and rollback pass
- agent semantic contracts live in `agents/*.md`
- structured role metadata lives in `agents/manifest.json`
- runtime composition derives from canonical agent files and doctrine
- Committer is read-only semantic closeout preparation
- deterministic runtime owns gate evaluation, path reconciliation, exact staging, commit execution, and optional push

### M1 Portable Runtime and M1 Pro Qualification — PROVEN

Purpose: prove this M1 Pro can reconstruct and validate Ocode from source without copied prior-machine state.

Evidence required:
- `npm run bootstrap` installs reproducibly
- machine config is initialized at `~/.config/ocode/config.json` when missing
- unrelated OpenCode config is preserved by ownership-aware merge
- FreeLLMAPI endpoint is machine-configurable and diagnosable
- push default is off
- installed runtime can report version, update from source, and rollback from backup
- OpenCode presence/version and remaining human authentication actions are explicit

### M2 Observed OpenCode Integration Contract — PROVEN

Purpose: depend on the smallest observed OpenCode contract that can execute governed semantic agents and expose bounded evidence.

Depends on: M0, M1.

Execution seam: PROVEN — `opencode run --agent <role> --format json` plus sanitized session export.

Binding strategy: DESIGN C — RUNTIME CONFIG OVERLAY — PROVEN on OpenCode 1.18.21 with `OPENCODE_CONFIG_CONTENT` and `agent.<role>.model`.

Provider proof: the same model-neutral diagnostic agent executed through a discovered FreeLLMAPI routed model and a discovered OpenAI model. A conflicting Markdown `model:` field was also overridden by the inline binding.

Optional diagnostic probe: DEFERRED — no missing production property justifies a custom tool.

Observation plugin: DEFERRED — the public CLI/event/export surfaces provide the M2 evidence contract.

Acceptance: `npm run acceptance:m2`.

M3 entry gate: SATISFIED — M2 supplied the profile schema, deterministic overlay builder, binding validation, fingerprints, tests, and migration evidence that M3 has now productionized.

### M3 Production Execution Profiles and Execution Provenance — PROVEN

Purpose: make deterministic free/hybrid role binding, fail-closed resolution, requested/effective execution evidence, and operator inspection part of normal Ocode operation.

Depends on: M2.

Evidence required:
- canonical semantic agents contain no provider/model policy
- `agents/manifest.json` is the structured governed-role inventory
- `free` and `hybrid` bind every governed role explicitly
- normal `ocode` uses Design C with machine default or non-persistent `--profile` override
- invalid or unavailable bindings fail before inference where deterministically checkable
- bounded governed runs reconcile requested policy with sanitized OpenCode export and reuse the project ledger
- operator profile, role explanation, profile diff, and run explanation commands are operational
- semantic fingerprints remain stable across free → hybrid → free switching
- `npm run acceptance:m3` proves real provider execution and negative behavior

M4 readiness: YES — deterministic normalized role, authority, permission, semantic fingerprint, execution-resolution, and contradiction-fixture inputs exist. No M4 capability ontology or enforcement policy is included.

### M4 Capability / Permission / Authority Contracts — PLANNED

Purpose: formalize agent capabilities, permissions, and authority boundaries as enforceable contracts.

Depends on: M2, M3.

### M5 Wayfinder — PLANNED

Purpose: implement the Wayfinder workflow only after baseline, integration, and authority contracts are proven.

Depends on: M4.

### M6 Ocode-Native Pstack-Derived Skills — PLANNED

Purpose: add Ocode-owned skills derived from Pstack concepts without copying non-canonical local skill state.

Depends on: M4, M5.

### M7 Planner Compiler — PLANNED

Purpose: compile high-level work into deterministic task plans and contracts.

Depends on: M4, M6.

### M8 Deterministic Task Runner — PLANNED

Purpose: execute compiled plans through lifecycle, ledger, evidence, validation, review, and closeout gates.

Depends on: M7.

### M9 Worktree Isolation and Safe Parallelism — PLANNED

Purpose: isolate work by task and support safe parallelism only after deterministic single-run execution is proven.

Depends on: M8.

### M10 Evaluation / Learning / Self-Hosting — PLANNED

Purpose: evaluate, learn from, and eventually self-host Ocode improvements without violating authority boundaries or evidence requirements.

Depends on: M9.

## Dependency Order

M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10

M4–M10 remain planned. Placeholder directories or partial primitives do not imply implementation.

## Current Bootstrap Boundary

The current bootstrap may repair only the repository foundation needed for a reproducible baseline. It must not begin Wayfinder, Pstack skill implementation, Planner Compiler, worktree isolation, or broader roadmap features.
