# Native OpenCode approval

## Purpose

Ocode is a governed harness around OpenCode. Ocode owns semantic roles, task routing, structural denials, delegation, and ordinary provenance. OpenCode owns the interactive presentation, operator decision, and execution of an approvable tool operation.

There is one approval owner and one operator interaction: OpenCode's native permission UI.

Before OpenCode evaluates a governed Bash request, the source-owned
pre-execution authority guard resolves only constitutional Git effects from
the exact Bash command. It rejects missing `stage`, `commit`, `push`, and
read-only `repository.edit` authority by throwing `OCODE_ROLE_EFFECT_DENIED`.
It does not ask, reply to a permission request, execute a command, or return
an allow decision. A request outside that narrow scope continues to OpenCode's
native `ALLOW`/`ASK`/`DENY` policy unchanged. The guard is a manifest-derived
authority projection; it is not a second approval system.

## Primary-session policy

The interactive `orchestrator` is a primary OpenCode agent with:

```yaml
bash:
  "*": ask
  "git push": deny
  "git push *": deny
  "git reset --hard": ask
  "git reset --hard *": ask
  "git clean": ask
  "git clean *": ask
  "rm -rf *": ask
  "find *": ask
```

`ASK` is not `ALLOW`: a destructive operation may reach OpenCode's native Bash permission interaction, which presents its exact command to the operator. Approval grants that one execution; it does not grant enduring role authority. Repository staging/commit/push are deterministic-runtime effects and never become authorized through an approval request. Structural authority denials (direct stage, commit, push, redirection, and input composition) never escalate to an approval request.

An explicit program authority ref has one narrow preflight exception. The
orchestrator may request `git fetch --no-tags <remote> <explicit-refspec>`
through the native `ASK` interaction when the task supplies a branch, tag, or
commit that is absent locally. It retrieves the named ref for inspection only:
the fetch may update remote-ref metadata but cannot change HEAD, the worktree,
the index, or a remote repository. `git pull`, default/broad fetches, checkout,
switch, restore, merge, rebase, stage, commit, and push remain denied.
Destructive operations remain native-ASK-gated. The current checkout is not authority merely because
it is the runtime default; resolve the supplied ref, verify any expected SHA,
and inspect files at that ref before declaring authority drift or absence.

## Delegated effects

OpenCode 1.18.21 child-session permission propagation is not qualified as a correctness dependency. The pre-execution guard itself has been exercised in a child session, but native child-session `ASK` propagation has not. A constrained subagent may return an `EFFECT REQUEST` for an admitted observation or validation command. It must not request repository mutation or Git closeout effects; those route to the admitted coder or deterministic Git runtime.

After a coder creates `test.txt`, staging is performed by deterministic closeout runtime, not by the primary's Bash session. A rejected or structurally denied effect remains unexecuted and is returned to the workflow as a rejected effect.

## Removed transport

`request_effect`, `ocode effect`, Ocode's `Allow once? [y/N]` prompt, its argv executor, custom approval ledger, installer deployment, and SDK permission-reply mediation are intentionally absent. They duplicated the native approval surface and could create two approval interactions for one command.

The harness does not use `--auto` for governed interactive work.

## Operator smoke checks

From a project directory, launch:

```sh
ocode .
```

Use these prompts:

```text
Run uname -a and tell me the result.
Create test.txt, then return it to deterministic closeout for staging.
```

Expected behavior: repository edits use the coder's native edit mechanism and Git staging is performed by deterministic closeout runtime; no `request_effect`, no `ocode effect`, and no Ocode terminal `Allow once? [y/N]` prompt. Direct `git add`, `git commit`, and `git push` are denied before native approval, including executable- and environment-prefixed forms. This phase does not restore a broad native `*: ask` fallback for coder.

## Limitation

This policy routes effects through the primary session because native child-session permission propagation has not been qualified on OpenCode 1.18.21. If later qualification proves child propagation reliable, it may be used as an optimization only; the primary-routing path remains the correctness boundary.
