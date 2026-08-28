# Low-interruption manual acceptance

This procedure measures native OpenCode permission interactions for one bounded implementation workflow. It does not replace the deterministic permission qualification in `qualification/opencode-1.18.21-permissions.json`.

## Preconditions

- Run from an isolated checkout of the review branch.
- Use OpenCode 1.18.21 and `@opencode-ai/sdk` 1.18.21.
- Run `npm run qualify:opencode-permissions` and `npm run test:runtime-evolution` first.
- Start with a clean worktree. Record `git status --short` and the TaskCapsule fingerprint.

## Fixture

Create a bounded project fixture with one source file, one test file, and `package.json` scripts named `test`, `build`, and `typecheck`. Start Ocode from that fixture with the review build on `PATH`.

Give the orchestrator this objective:

> Inspect the fixture with `pwd`, `ls`, and `rg`. Change only the bounded source file. Run `npm test` twice, including once after any repair. Have verifier validate and reviewer independently review against the same TaskCapsule. If accepted, use governed closeout for exactly the accepted changed path. Do not commit or push.

Then request one harmless unknown command such as `uname -a`, reject it in the native UI, and request `git push origin permission-probe` to confirm structural denial without executing a remote effect.

## Tally

Record native permission requests, not model prose or Ocode ledger events.

| Operation | Expected native requests |
| --- | ---: |
| `pwd`, `ls`, `rg` observations | 0 |
| exact admitted `npm test`, repeated | 0 |
| repair and rerun of exact admitted validation | 0 |
| harmless unknown `uname -a` | 1 ASK |
| structurally denied `git push ...` | 0; DENY |
| deterministic exact-path staging after unchanged ACCEPT | 0 model permission requests |

Record the actual count and attach the activity/ledger paths. A run is not accepted if it uses broad `git add .`, stages an unaccepted path, accepts a stale review/diff, or reports a hidden physical model behind an opaque route.

## Inspection

Use:

```sh
ocode activity --raw
harness closeout --help
git diff --cached --name-only
```

Model telemetry is stored in `.opencode/run-ledger.jsonl`. Native permission characterization is stored in `qualification/opencode-1.18.21-permissions.json`. Model qualification records, when evidence supports them, are stored by the existing qualification runtime rather than this manual procedure.

## Reset

Reject or stop the unknown-command probe. Do not approve the push probe. Remove the isolated fixture or worktree only after retaining the requested evidence. If an isolated-home installation was used, deleting that isolated home leaves the operator's installed Ocode unchanged.
