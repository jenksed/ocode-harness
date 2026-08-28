# Ocode OpenCode runtime compatibility contract

Ocode qualifies an observed OpenCode runtime against behavioral properties. Version identifies a runtime; qualification establishes compatibility. A version string is provenance only and is never itself an allow rule.

## Contract v1

Required properties are `server_start`, `sdk_endpoint`, `session_create`, `event_subscribe`, `prompt_submit`, `session_completion`, `session_abort`, `clean_shutdown`, `permission_request`, `permission_request_identity`, `permission_reply_once`, `permission_reject`, `same_session_resume`, and `rejection_semantics`.

Optional properties are session/pattern approval, and metadata/parity for bash, edit, external directory, web, skill, task, and interactive permissions. Missing optional properties are an explicit degradation; missing or unknown required properties are never a degradation.

| Required state | Qualification |
| --- | --- |
| any `UNKNOWN` | `UNQUALIFIED` |
| no unknown, any `UNSUPPORTED` | `INCOMPATIBLE` |
| all required supported, optional unavailable/unknown | `COMPATIBLE_WITH_DEGRADATION` |
| all properties supported | `COMPATIBLE` |

The normalized schema and transition logic live in `packages/harness-runtime/lib/opencode-runtime-contract.mjs`. It records executable and SDK paths, versions, and SHA-256 fingerprints as identity evidence. A prior qualification is invalidated by executable fingerprint, SDK package fingerprint, runtime-contract version, or compatibility-adapter fingerprint change.

## Current installed-runtime observation

The current 1.18.21 runtime is `COMPATIBLE_WITH_DEGRADATION`. The earlier synchronous ServeError artifact remains historical evidence and is not reinterpreted. The canonical qualifier now consumes the version-matched credential-free local-provider record at `qualification/opencode-1.18.21-permissions.json`, which exercises server/session lifecycle, prompt completion, native permission request identity, once/resume, reject, session-wide approval, abort, and clean shutdown. Metadata for non-Bash tools and interactive/child parity remain `UNKNOWN`, producing the explicit degradation.

The reusable qualification process must use an isolated HOME/XDG/config/project directory, actual installed executable, and a local deterministic provider or non-inference real permission trigger. It must record raw facts in sanitized structured observations, then populate this contract without branching its policy on a version number.

## Safe degradation

If all required one-shot capabilities work but session-wide approval does not, Ocode may use only one-shot approval and report `COMPATIBLE_WITH_DEGRADATION`. Unqualified effect metadata remains `NOT_PROJECTED`; it is not an excuse to approve an operation. If permission reply/one-shot continuation/rejection are absent or unknown, governed Approval-First Execution remains unavailable.

## Separation

This generic contract is not the version-specific permission observation. The latter belongs in `opencode-<version>-permission-contract.md`; it may document matching/default/reply behavior only after actual runtime evidence. Neither document authorizes ASK governance by itself.
