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

## ServeError diagnosis

### Reproduction (observed)

The reusable runner invokes the installed executable as `opencode serve --hostname=127.0.0.1 --port=0` from an empty temporary project. It supplies an empty, temporary `HOME` and all relevant XDG/OpenCode config roots, disables project configuration, and supplies only an isolated server password. `debug info` succeeds under the same environment, while `serve` exits `1` without the SDK's listening banner and writes `Unexpected error` followed by `ServeError` to stderr. The same result occurred with a fixed loopback port, from the repository directory, and with a nonempty isolated password.

### Wrapper behavior (source-confirmed)

The installed `@opencode-ai/sdk` `createOpencodeServer` helper starts `opencode serve`, waits for the listening banner on stdout, and turns a child exit into its generic `ServeError`/server-exited failure. That SDK wrapper does not expose the underlying executable failure reason.

### Root cause (unknown)

The root cause inside the installed executable is **unknown** (low confidence). The local executable is a packaged binary and its server source was not available in the installed package; the observed stderr contains no causal detail. No conclusion is made about configuration loading, provider initialization, project initialization, authentication, or bind/listen beyond: listening was not observed. The provider/mock seam cannot be exercised until this pre-session server fault is resolved.

## Production-seam differential (observed)

Normal governed SDK execution calls `createOpencodeServer()` and then `createOpencodeClient()`; it does not call the qualifier's synchronous `spawnSync('opencode', ['serve', ...])` helper. Normal interactive `ocode` delegates directly to the OpenCode CLI and does not own a server. Current M6 qualification code has a separate, test-only `qualificationServer` branch that directly spawns `opencode serve`; it is not the normal governed SDK startup path.

Under the same temporary HOME/XDG/config/project materialization, a direct asynchronous SDK probe using the normal `config` argument started a managed server, subscribed to events, created a session, and aborted that session without provider credentials. The corresponding direct asynchronous CLI probe also observed the listening banner. The retained generic qualifier's synchronous child-process probe still reports `ServeError`. This establishes that its failure is not sufficient evidence that the production SDK seam is unsupported; it does not yet establish a repeatable qualification harness result either.

The canonical runner has since been changed to invoke the SDK-managed seam under a controlled, allowlisted environment rather than the synchronous CLI seam. On this host that stricter runner is non-repeatable: an individual lifecycle observation can succeed, while fresh attempts also receive the SDK's generic `ServeError` before startup. This is not a revision of the direct-probe observation: the unaccounted-for differential remains unresolved, so the required lifecycle capabilities remain `UNKNOWN`.

The direct probe also showed that injecting `OPENCODE_SERVER_PASSWORD` without a matching SDK-client auth projection permits startup but makes session API calls fail. That password was a qualification-fixture addition, not a production SDK requirement. It must not be copied into a later SDK fixture unless the client authentication transport is separately characterized.

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

The reusable `scripts/qualify-opencode-runtime.mjs` runner now records the isolated startup result as normalized machine-readable evidence. The installed runtime's result remains `UNQUALIFIED`, not `INCOMPATIBLE`: the observed server seam fault prevents testing required behavior, but does not establish that the runtime lacks it. The existing M4 longest-match projector remains an Ocode v1 approximation for its historical narrow forms, not a verified statement of the pinned runtime’s rule resolution. Therefore Part B must not change projection semantics, admit ASK-backed actions, or represent generic commands as approval-capable in this environment.

## Re-entry conditions

Before Part B, repair or supply an isolated 1.18.21 server execution seam. Then use a local, non-credential mock provider or a non-inference permission-triggering API to collect actual event/request/reply evidence under controlled conflicting configurations. The resulting fixture must distinguish configured `allow`, `ask`, and `deny`; no-match; `once`, `always`, and `reject`; restart; and CLI `--auto` without touching real user state.
