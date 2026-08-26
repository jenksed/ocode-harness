# Native OpenCode approval

## Purpose

Ocode is a governed harness around OpenCode. Ocode owns semantic roles, task routing, structural denials, delegation, and ordinary provenance. OpenCode owns the interactive presentation, operator decision, and execution of an approvable tool operation.

There is one approval owner and one operator interaction: OpenCode's native permission UI.

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

`ASK` is not `ALLOW`: normal commands such as `uname -a`, bounded test/build commands, and `git add test.txt` reach OpenCode's native Bash permission interaction. The structural denials never escalate to an approval request.

## Delegated effects

OpenCode 1.18.21 child-session permission propagation is not qualified as a correctness dependency. A constrained subagent therefore returns an `EFFECT REQUEST` containing the exact bounded command and reason. The primary orchestrator validates the request against the delegated scope and performs it with its own native Bash tool.

For example, after a coder creates `test.txt`, it returns `EFFECT REQUEST: git add test.txt`. The primary invokes native Bash; OpenCode asks once; on approval the command executes and the primary continues. A rejection leaves the command unexecuted and is returned to the workflow as a rejected effect.

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
Create test.txt and stage it.
```

Expected approval UI: one native OpenCode Bash permission interaction for each approvable command; no `request_effect`, no `ocode effect`, and no Ocode terminal `Allow once? [y/N]` prompt. Rejecting `git add test.txt` prevents staging and lets the workflow report the rejection. `git push` and `git reset --hard` are denied without an approval escalation.

## Limitation

This policy routes effects through the primary session because native child-session permission propagation has not been qualified on OpenCode 1.18.21. If later qualification proves child propagation reliable, it may be used as an optimization only; the primary-routing path remains the correctness boundary.
