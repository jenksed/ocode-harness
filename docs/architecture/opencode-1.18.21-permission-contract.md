# OpenCode 1.18.21 permission contract characterization

Status: qualified for Ocode's bounded native Bash projection. `CHARACTERIZATION SUFFICIENT: YES` for the exact properties listed below. This is not a general claim about every OpenCode permission or shell form.

## Runtime identity and method

The authority for this record is the installed OpenCode executable and `@opencode-ai/sdk`, both exactly `1.18.21`. `scripts/qualify-opencode-permissions.mjs` starts the installed SDK/server against an isolated temporary project and a local OpenAI-compatible deterministic fixture. The fixture requests harmless Bash tools without remote inference. Native events, tool terminal states, permission replies, and temporary marker presence are retained in `qualification/opencode-1.18.21-permissions.json`.

The repository continues to pin 1.18.21. Historical evidence remains historical; a changed executable or SDK version requires a new record and must not reinterpret this one.

## Source-confirmed

- The installed SDK Agent declaration supports `ask`, `allow`, and `deny` Bash pattern values.
- Native permission request/reply events carry permission and session identity.
- The installed SDK exposes the permission response values `once`, `always`, and `reject`.

These declarations establish transport shape only. The observations below establish the behavior Ocode uses.

## Observed

- An exact `pwd: allow` after `*: ask` executes with zero permission requests.
- With no catch-all rule, an unmatched harmless command executes by default. Ocode must therefore project an explicit catch-all for roles whose unknown commands are approval-gated.
- With `*: ask`, an unmatched command produces one native request; replying `once` resumes and completes it.
- Rules are evaluated in insertion order and the last matching rule wins. Both conflicting orders were exercised.
- `pwd *` matches `pwd -P`.
- `&&`, `||`, pipelines, command substitution, and backticks did not inherit an unrelated exact allowance; the unmatched component produced a request in the exercised fixtures.
- Exact `pwd` did not allow `pwd > marker.txt`; it produced a request.
- A wildcard `pwd *` **did silently allow** `pwd -P > marker.txt` and created the marker. Textual observation wildcards are unsafe without a later structural redirection denial.
- A trailing `*>*: deny` blocked that same wildcard/redirection form with zero permission requests and no marker.
- Two identical requests replied `once` produced two prompts. Replying `always` to the first produced one prompt and allowed the second identical operation in the same session.
- `reject` ended the requested tool with an error and did not escalate to a second approval mechanism.
- Exact `npm test: allow` executed a repository fixture test with zero requests.
- A trailing `git push *: deny` rejected a harmless nonexistent push fixture with zero requests.
- A bounded loop of `pwd`, `rg needle fixture.txt`, and two `npm test` runs completed with zero permission requests under Ocode's rule ordering.

## Ocode projection contract

Ocode may project native Bash ALLOW only with these controls:

1. Start from the canonical role's permission/authority contract.
2. Preserve an explicit `*: ask` or `*: deny` according to that role; never rely on OpenCode's unmatched default.
3. Add only repository-admitted exact validation commands for roles with `test.execute`.
4. Append structural redirection, remote, and destructive denials last.
5. Never use `--auto` or `bash: "*": allow`.
6. Route admitted npm validation through the fingerprint-checking wrapper so a changed `package.json` invalidates execution-time trust.

This projection changes execution permission only. It grants no capability, edit, stage, commit, push, review, or acceptance authority.

## Unproven

- `always` persistence across a new session, process restart, or machine restart;
- primary/child sharing of an `always` reply;
- permission behavior for edit, external directory, web, skill, and task tools;
- every possible shell grammar form or quoting edge case; and
- TUI behavior not shared with the exercised SDK/server permission service.

Ocode does not rely on these unproven properties. It uses configured rules for steady-state low interruption and retains OpenCode's one native ASK for unknown consequential commands.
