# Approval-First Operational Checkpoint

## Checkpoint identity

- Branch: `architecture/approval-first-execution`
- Checkpoint commit: the commit containing this document; record it with `git rev-parse HEAD` before installation.
- Ocode source version: `v0.2.0-alpha.1`
- Observed OpenCode executable: `1.18.21`, fingerprint `8c783005340f8dfc5e7d168478dd0dd2bd1faead531cb34270de2a9689d9f135`
- SDK: `@opencode-ai/sdk 1.18.21`, package fingerprint `ecf994f1eda35208c41795f5112d51e03afa40952e348ff15360abd27875c84a`

The exact checkout commit is the authority; version and fingerprints are provenance, not a compatibility allowlist.

## Why this exists

Approval-First is useful before its complete live qualification: the coder can present unfamiliar shell work to the human through OpenCode's native permission UI instead of treating a missing executable allowlist as an instruction for the human to run commands manually. The strict isolated SDK lifecycle remains non-repeatable, so this is an **operational checkpoint**, not a final qualification claim.

Live operator evidence corrected that first strategy: an effective `@coder` policy containing `bash "*": ask` still did not display a native prompt when invoked below the restricted Orchestrator session. `OPEN_CODE_SUBAGENT_PERMISSION_PROPAGATION_UNQUALIFIED` is therefore a dependency limitation. Ocode, not OpenCode child-session inheritance, owns effect admission, approval, execution, and evidence.

## What works

### Proven deterministically

- Permission projection schema v2 distinguishes `ALLOW`, `ASK`, `DENY`, `UNKNOWN`, and `NOT_PROJECTED`.
- `bash: { "*": "ask" }` projects generic `command.execute` as `ASK`; it is not `UNKNOWN`.
- ASK does not add static role authority; configured mutation `ALLOW` beyond static authority remains contradictory.
- The SDK mediation module normalizes a permission request, ignores a wrong session, deduplicates a request, maps `ALLOW_ONCE` to OpenCode `once`, maps `REJECT` to `reject`, fails invalid decisions and reply errors closed, and reports `APPROVAL_REQUIRED` without a resolver.

### Operationally available

- Interactive `ocode` continues to use OpenCode's own approval UI.
- The canonical coder policy uses `bash: { "*": "ask" }`, while retaining explicit structural denials for staging, commits, pushes, reset/clean, and recursive deletion.
- This intentionally asks for every non-denied coder command in this checkpoint. It does not assume unqualified runtime rule precedence to create a speculative safe-command allowlist.
- The checkpoint executor accepts a bounded command request, asks through an Ocode resolver, executes argv without a shell, and appends request/decision/execution evidence. `git add <paths>` and bounded cherry-pick forms are ASK; push, reset-hard, clean, and direct commit are denied/routed.

### Implemented but not live-qualified

- Governed SDK execution contains a bounded permission-resolver hook supporting `ALLOW_ONCE` and `REJECT`.
- The canonical qualification runner uses the production SDK-managed server seam rather than synchronous CLI `serve`.

## Not proven or unavailable

- Repeatable isolated SDK lifecycle; prompt completion; live ASK request/reply; rejection behavior; same-session continuation; and OpenCode rule/default semantics.
- Typed effect envelopes, effect classification, role-effect ownership routing, approval leases/evidence, broad workforce migration, launcher bypass hardening, and final end-to-end acceptance.

`UNQUALIFIED` means insufficient repeatable evidence, **not** that the runtime is known unsupported. A generic `ServeError` in the strict isolated qualifier is a known failure mode and must not be hidden or treated as permission evidence.

## Safe operating mode

- Use interactive `ocode` for coder work that may need human approval. Native OpenCode owns the prompt UI.
- The coder may ask for a command; it may not stage, commit, push, hard-reset, clean, or recursively delete through this policy.
- Do not treat a human approval as a role change. Reviewer, verifier, planner, wayfinder, researcher, judge, and committer boundaries remain unchanged.
- In governed SDK/headless execution, provide a bounded resolver only when intentionally mediating an observed request. Without one, `APPROVAL_REQUIRED` is the safe result, not a timeout to work around.
- Surfaces without a typed envelope or live qualification remain fail-closed for Approval-First automation.
- Human approval is not human execution. A semantic role that cannot execute an effect must route it to Ocode's governed executor before asking the human to run shell commands. Human action is only a fallback for rejection, no owner, unavailable runtime, environment failure, or unclassifiable/forbidden work.

## Deployed-agent drift

The operator found stale installed `coder.md` copies with `bash "*": allow` while repository authority was `ask`; matching version strings did not prove policy synchronization. The installer/doctor drift repair is still pending. Until it lands, compare repository and installed Ocode-owned agent files explicitly after update and treat disagreement as unsafe deployment drift.

## Operator smoke test

From this checkout, first verify the checkpoint and policy:

```sh
git rev-parse HEAD
node packages/harness-runtime/bin/harness.mjs version
opencode debug agent coder --pure
```

The effective `coder` output should show `bash` catch-all `ask` and the explicit destructive/VCS denials. In a disposable project, start normal interactive Ocode with the coder agent, ask it to run a harmless unfamiliar diagnostic such as `uname`, and approve or reject the native OpenCode prompt. Do not use `--auto` and do not use this as final runtime qualification.

## Installation and rollback

This repository checkpoint does not alter a real installation. To use it, run the repository's existing isolated installer workflow after review; do not install from an unreviewed dirty worktree. `harness version`, `harness update`, and `harness rollback` remain the repository-native operator mechanisms. To return to an earlier installed release, use the backup reported by the existing installer and run `harness rollback`; do not manually edit global OpenCode configuration.

## Do not regress

- Capability, authority, configured permission, runtime approval, and execution evidence remain distinct.
- Unknown governance and unclassifiable effects fail closed.
- Approval grants a bounded operation, not a semantic role or persistent policy.
- Session approval must not silently become persistent policy.
- Native interactive prompting and a semantic human question are different mechanisms.
- Historical M4/M6 evidence remains historical; this checkpoint extends it without rewriting it.

## Next-session entry point

Start with [approval-first-remaining-work.md](approval-first-remaining-work.md), then run the targeted Approval-First tests and one canonical qualifier attempt. Do not advance Phase 4 or workforce migration until the Phase 2/3 live gate is satisfied.
