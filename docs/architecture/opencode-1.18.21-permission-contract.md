# OpenCode 1.18.21 permission contract characterization

Status: Part A characterization record. This record is intentionally incomplete: `CHARACTERIZATION SUFFICIENT: NO`. It does not authorize the ASK governance implementation.

## Scope and method

The target is the installed, repository-pinned OpenCode executable and `@opencode-ai/sdk` version `1.18.21`, not current upstream. Inspection used the installed SDK generated declarations and executable help. Live probes used a newly-created temporary `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `OPENCODE_CONFIG_DIR`, and empty temporary project, with `OPENCODE_DISABLE_PROJECT_CONFIG=1`; no provider credential, user OpenCode config, or project configuration was used.

## Source-confirmed

- The installed SDK package version is `1.18.21`.
- Its generated Agent type accepts `ask`, `allow`, and `deny` for `edit`, bash pattern values, `webfetch`, and `external_directory`.
- `permission.updated` carries a `Permission` object with `id`, `type`, optional `pattern`, `sessionID`, `messageID`, optional `callID`, `title`, opaque `metadata`, and `time.created`.
- `permission.replied` carries `sessionID`, `permissionID`, and a response string.
- The generated SDK exposes `POST /session/{id}/permissions/{permissionID}` with response body `once`, `always`, or `reject`; its declared successful response is boolean.

These declarations define transport shape, not rule precedence, no-match behavior, metadata semantics, execution success, or persistence.

## Observed

- `opencode --version` printed `1.18.21`.
- In a fully isolated environment, `opencode debug info` completed, reported OpenCode `1.18.21`, and reported no plugins.
- In that same isolation, `opencode serve --hostname=127.0.0.1 --port=0` exited before listening with `Unexpected error` / `ServeError`. The result was reproduced from both the repository directory and an empty temporary project. Adding a nonempty isolated `OPENCODE_SERVER_PASSWORD` did not change it.
- `opencode run --help` says `--auto` will auto-approve permissions that are not explicitly denied and labels it dangerous.

The failed server startup occurred before a session could be created. It produced no `permission.updated`, no permission ID, and no reply acknowledgement. It is evidence of an unavailable live probe, not evidence of any permission semantics.

## Inferred

- `once`, `always`, and `reject` are valid reply inputs for the pinned SDK route because the generated SDK declares that closed union.
- A governed launcher must not rely on CLI `--auto`; the executable expressly describes behavior broader than a bounded Ocode approval.

## Unproven

No live evidence exists yet for:

- rule precedence, equal-specificity conflicts, or prefix/wildcard matching;
- default/no-match behavior;
- permission request metadata for bash, edit, external directory, web, skill, or task;
- reply handling, whether a reply resumes the operation, rejection behavior, sibling-request behavior, or post-reply session behavior;
- `once` scoping;
- `always` scope, persistence, restart behavior, or configuration mutation;
- actual CLI `--auto` behavior; and
- interactive versus server/SDK differences.

## Part A gate

`CHARACTERIZATION SUFFICIENT: NO`.

The existing M4 longest-match projector remains an Ocode v1 approximation for its historical narrow forms, not a verified statement of the pinned runtime’s rule resolution. Therefore Part B must not change projection semantics, admit ASK-backed actions, or represent generic commands as approval-capable in this environment.

## Re-entry conditions

Before Part B, repair or supply an isolated 1.18.21 server execution seam. Then use a local, non-credential mock provider or a non-inference permission-triggering API to collect actual event/request/reply evidence under controlled conflicting configurations. The resulting fixture must distinguish configured `allow`, `ask`, and `deny`; no-match; `once`, `always`, and `reject`; restart; and CLI `--auto` without touching real user state.
