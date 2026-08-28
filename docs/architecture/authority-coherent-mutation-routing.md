# Authority-coherent mutation routing

Ocode treats an intended effect as the governed unit, not the name of the tool selected to produce it. `repository.edit` belongs to the admitted coder; staging, commit, and push belong to deterministic Git runtime. A role without that constitutional authority cannot obtain it through Bash approval, redirection, an interpreter, or a different file command.

The runtime projection derives this boundary from the manifest authority. Read-only roles receive an explicit Bash deny catch-all, with only declared observation patterns restored and repository-defined validation commands admitted for roles with `test.execute`. Structural staging/commit/push denials remain last-match rules for every role. Coder retains native `edit: allow`, `repository.edit`, `command.execute`, and `test.execute`, but not Git mutation authority.

`decideEffectAdmission()` returns `OCODE_ROLE_EFFECT_DENIED` with the effect, role, owner, and next action. Repository edit denial routes to `coder`; Git effects route to deterministic runtime. `decideCommandAdmission()` applies the same effect boundary when role authority is supplied. An orchestrator must identify the effect before tool selection, delegate edits, and never run a subagent's mutation request itself.

| Role class | Repository edit | Direct staging/commit/push | Observation | Admitted tests |
| --- | --- | --- | --- | --- |
| Orchestrator/planner/verifier/reviewer/committer | Deny; delegate or report blocked | Deny; deterministic runtime | Allow | Only where `test.execute` is declared |
| Coder | Native edit allowed | Deny; deterministic runtime | Allow | Allow through the fingerprinted registry |

This is not a second authority system: the manifest remains the authority owner, and OpenCode permissions are only the effective runtime projection. Human `ASK` cannot manufacture a missing `may_*` grant. The effect boundary is intentionally scoped to mutation routing and adjacent permission friction; it does not redesign release identity, model routing, Context Engine, or external machine state.
