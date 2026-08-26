# Approval-First remaining work

This is the ordered implementation contract after the operational checkpoint. `UNQUALIFIED` is not permission to approximate a missing property.

| ID | Status / purpose | Entry condition | Target and acceptance | Evidence / dependencies | Safe parallelism |
| --- | --- | --- | --- | --- | --- |
| AF-1 | ACTIVE — repeatable SDK lifecycle | Checkpoint targeted tests green | Make five fresh controlled `createOpencodeServer → client → event → session → abort → close` runs pass. | Sanitized qualifier artifacts; no broad HOME/config inheritance. Depends on current qualifier. | Isolated diagnosis only. |
| AF-2 | PLANNED — inference fixture | AF-1 proven | Add deterministic local provider or narrowly projected bounded provider seam; prove prompt, model request, output, idle, messages. | Real OpenCode events, no mocked permission runtime. Depends AF-1. | Fixture protocol research may run separately. |
| AF-3 | PLANNED — live permission characterization | AF-2 proven | Observe configured ASK, request identity, once, reject, continuation, matching and no-match/default behavior. | Sanitized live evidence against installed runtime. Depends AF-2. | Rule cases may be separate once fixture exists. |
| AF-4 | PLANNED — resolve compatibility | AF-1–AF-3 evidence complete | Regenerate canonical artifact and classify required/optional capabilities truthfully. | Fingerprints, contract/adapter invalidation. Depends AF-3. | None. |
| AF-5 | PLANNED — COMMAND envelope | AF-3 request metadata sufficient | Normalize raw command request without inventing fields; unnormalizable requests fail closed. | Deterministic envelope tests. Depends AF-3. | Schema/unit tests may parallelize. |
| AF-6 | PLANNED — conservative classifier | AF-5 | Classify simple/compound shell input; partial never auto-allows and opaque fails closed. | Tests for redirects, pipes, chaining, substitutions, wrappers. Depends AF-5. | Unit corpus may parallelize. |
| AF-7 | PLANNED — role effect ownership | AF-6 | Enforce correct owner separately from technical approvability. | Reviewer mutation and coder workspace-write negatives. Depends AF-6. | Role matrix drafting may parallelize. |
| AF-8 | PLANNED — bounded approval lease | AF-5, AF-7 | Bind once approval to request/session/run/role/contract/project/envelope and reject replay/mismatch. | Deterministic lease tests. Depends AF-7. | None. |
| AF-9 | PLANNED — approval evidence | AF-8 | Append truthful request/decision/reply/execution-result evidence; old records grant no authority. | Crash and replay evidence tests. Depends AF-8. | Ledger format review may parallelize. |
| AF-10 | PLANNED — remaining roles/surfaces | AF-5–AF-9 | Produce readiness matrix; migrate only ready ASK surfaces, retaining structural denials/reroutes. | Per-role policy and admission tests. Depends AF-9. | Per-role analysis only. |
| AF-11 | PLANNED — launcher bypass hardening | AF-4 | Reject/explicitly govern `--auto` and equivalents across launch paths. | Launcher/installer/doctor tests. Depends AF-4. | Audit can parallelize. |
| AF-12 | PLANNED — operator diagnostics | AF-4, AF-9 | Explain state, ownership, lease, evidence, stale qualification, and headless behavior. | CLI/doctor tests. Depends AF-9. | Documentation may parallelize. |
| AF-13 | PLANNED — independent end-to-end qualification | AF-1–AF-12 | Prove interactive and headless approval matrix without bypasses; review historical evidence. | Fresh isolated live evidence and full affected suite. Depends all prior work. | None. |

The checkpoint executor is transitional, not the final typed-effect architecture. Add a deployment-drift work item to AF-12: version equality must not mask differences among repository canonical agents, installed Ocode-owned agents, and effective projected policy. Native OpenCode subagent permission propagation is not an authority dependency and must not be used as AF-13 proof.

The checkpoint coder policy is intentionally limited: it is an interactive command ASK surface, not evidence that command effect classification or broad role migration is complete.
