# Daily Driver Integrity DD2 — Governed OpenCode Composition Acceptance

Status: `DD2_ACCEPTED`

Accepted implementation: `183daeb1d940c5e425e720dfbd2fe0ec9cf78cf7`.

DD2 base: `7f48fd4290eced1dbe188aa3f2de920289c956a1`. The initial
composition implementation `2f19713ed5c5c5dac9f8f3df7c909f3455818988`, its
installed-skill evidence closure
`bd8ffac5a08fbc799571bf5027bedcf96889f141`, and the accepted repair are
successive ancestors of this checkpoint.

## Accepted contract

Each OpenCode launch receives an ephemeral, runtime-owned
`OPENCODE_CONFIG_DIR`. It contains the canonical Ocode agents and the existing
deterministic projection of the centrally admitted six-skill catalog:
`adversarial-review`, `architecture-change-design`, `blast-radius-analysis`,
`codebase-investigation`, `systematic-debugging`, and `tdd`. The source of that
set is `harness-runtime/lib/admitted-skills.mjs`; it is not a skill-directory
scan and DD2 adds no semantic skill qualification.

The project configuration remains enabled. The directly qualified project
categories are `opencode.json` / `opencode.jsonc` (including MCP), unrelated
`.opencode/agent(s)`, unrelated `.opencode/skill(s)`, and local
project-relative `skills.paths`. They are read in place, preserving their
project-relative path meaning. User/global configuration files retain the
existing copy-into-runtime-root behavior; user agents and skills are not added
to the DD2 support claim.

Ocode exclusively owns governed agent identities and canonical semantics,
profile model bindings, role-mode adaptation, permission projection including
ordered Bash rules, pre-execution authority guard, validation registry, and
the admitted canonical skills. Project definitions of a governed agent fail
before OpenCode/model execution with `OCODE_PROJECT_AGENT_COLLISION`; a project
skill matching an admitted canonical identifier similarly fails with
`OCODE_PROJECT_SKILL_COLLISION`. No collision winner depends on unspecified
OpenCode precedence. Project-owned non-reserved agents and skills acquire no
Ocode authority.

Generated agents, guard configuration, and canonical skill material live only
under the temporary runtime configuration directory and are removed with it.
DD2 does not write generated composition or skill projections into the target
repository.

## Governed guard closure

Interactive execution applies the Ocode guard once after its native permission
projection. Governed normal, SDK, and streaming execution all call the one
`finalizeGovernedOpenCodeOverlay` finalizer. It performs governed role/model
overlay adaptation, applies the runtime permission projection, and invokes the
same `applyPreExecutionAuthorityGuard` helper with the canonical contracts and
the runtime validation registry. The guard plugin path is resolved through the
artifact/runtime resource resolver.

The focused guard and SDK tests prove exactly one guard entry with the complete
role authority map and validation registry. The real qualified OpenCode
composition probe supplies that finalized overlay to OpenCode 1.18.21 and
confirms a single resolved guard entry. This closes the previously rejected
case in which governed normal, SDK, and streaming paths had only permissions
and no guard.

## Acceptance evidence

The independent re-acceptance review against the accepted implementation ran:

```text
npm run test:governed-authority-guard       GOVERNED_PRE_EXECUTION_AUTHORITY_GUARD_PROVEN
npm run test:opencode-sdk-execution         OPENCODE_SDK_EXECUTION_PROVEN
npm run test:opencode-composition           DD2_OPENCODE_COMPOSITION_PROVEN
npm run test:installed-opencode-skill-discovery  INSTALLED_OPENCODE_SKILL_DISCOVERY_PROVEN
npm run test:runtime-state                  DD1_RUNTIME_STATE_PROVEN
npm run test:runtime-closure                INSTALLED_RUNTIME_CLOSURE_PROVEN
npm run test:runtime-identity               PASS
npm run test:command-authority              PASS
npm run test:installed-command-authority    INSTALLED_COMMAND_AUTHORITY_PROVEN
npm run test:opencode-live-permissions      LIVE_PERMISSION_EVIDENCE_CONTRACT_PROVEN
npm test                                    PASS
```

The installed real-discovery run built the accepted commit, installed the
artifact into isolated roots, deleted its detached source checkout, and used
`/Users/jenksed/.opencode/bin/opencode` at `1.18.21`. It projected and actually
discovered canonical `tdd` at the runtime-owned path, matched the installed
canonical fingerprint, and confirmed that the fixture gained no
`.opencode/skills/tdd`. Its retained artifact identity was archive SHA-256
`f57db1434ff9c9a2b52fbfb081983b00ccb45813f6763e10feb6db7da8868e67` and
payload-manifest SHA-256
`8ffee4886cb7e481eb78fb6419f27ca36578732905924ed5b3d206bf57754c49`.

Live permission qualification retained safe observation `ALLOW`, bounded coder
workspace mutation `ASK`, coder Git stage/commit/push `DENY`, restricted
shell/interpreter `DENY`, read-only-role mutation `DENY`, and targeted
`git diff -- <path>` qualification. `git config --get user.name` remains its
pre-existing known qualification limitation.

## Limits and next frontier

DD2 is a trusted-repository contract only. It does not claim untrusted project
confinement, plugin or MCP confinement, remote skill URLs, arbitrary JSONC
recovery, multi-version OpenCode support, update/rollback changes, automated
Git closeout, runtime-state concurrency, artifact signing, archive-byte
reproducibility, Linux/Windows qualification, or DD3 CLI/chat work.

**KNOWN PACKAGING OBSERVATION:** fresh archive SHA-256 values can vary while
the payload manifest remains stable. Repository authority does not presently
require byte-reproducible archives, so this is deferred packaging/release work,
not a DD2 acceptance condition.

Next frontier: **DD3 — Truthful Operator Surface & Chat UX**: CLI argument
truthfulness, installed `ocode doctor`, explicit capability/unsupported-surface
gating, and chat visual grammar for progress, tool activity, warnings/errors,
and final output. DD3 is not implemented by this checkpoint.
