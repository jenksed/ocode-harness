# Native OpenCode approval

## Purpose

Ocode is a governed harness around OpenCode. Ocode owns semantic roles, task routing, structural denials, delegation, and ordinary provenance. OpenCode owns the interactive presentation, operator decision, and execution of an approvable tool operation.

There is one approval owner and one operator interaction: OpenCode's native permission UI.

Before native permission evaluation, Ocode installs a source-owned,
manifest-derived pre-execution Git authority guard. It is deny-only: it throws
`OCODE_ROLE_EFFECT_DENIED` for a Git effect the executing role does not own,
then otherwise continues to OpenCode's native policy. It never prompts,
answers a permission request, executes Bash, or grants authority.

## Primary-session policy

The interactive `orchestrator` is a primary OpenCode agent with:

```yaml
bash:
  "*": ask
  "git push": deny
  "git push *": deny
  "git reset --hard": deny
  "git reset --hard *": deny
  "git clean": deny
  "git clean *": deny
  "rm -rf *": deny
```

`ASK` is not `ALLOW`: unknown consequential commands may reach OpenCode's native Bash permission interaction only for a role that already owns the effect. Repository staging/commit/push are deterministic-runtime effects and never become authorized through an approval request. Structural denials never escalate to an approval request.

## Delegated effects

OpenCode 1.18.21 child-session permission propagation is not qualified as a correctness dependency. A constrained subagent may return an `EFFECT REQUEST` for an admitted observation or validation command. It must not request repository mutation or Git closeout effects; those route to the admitted coder or deterministic Git runtime.

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

Expected behavior: repository edits use the coder's native edit mechanism and Git staging is performed by deterministic closeout runtime; no `request_effect`, no `ocode effect`, and no Ocode terminal `Allow once? [y/N]` prompt. Direct `git add`, `git commit`, and `git push` are denied without an approval escalation, including executable- and environment-prefixed forms.

The guard is not a general safety classifier. It preserves coder's
constitutional `repository.edit` authority while rejecting stage, commit, and
push; read-only roles are also rejected for repository-edit Git commands. It
does not make a generic coder `bash: "*": ask` safe: an approved interpreter
or child process can still invoke Git after the outer Bash request.

## Limitation

This policy routes effects through the primary session because native child-session permission propagation has not been qualified on OpenCode 1.18.21. If later qualification proves child propagation reliable, it may be used as an optimization only; the primary-routing path remains the correctness boundary.
