# Approval-first execution

Status: architecture and executable entry contract only. No agent permission has changed, no approval runtime exists yet, and M4 acceptance evidence remains valid for the behavior it proved.

## Problem and scope

M4 deliberately projects only a small, known set of configured OpenCode permissions. A generic command is `NOT_PROJECTED`; an unrecognized in-scope permission is `UNKNOWN`; either fails M4 admission. That was the correct fail-closed M4 boundary, but it means a legitimate diagnostic that was not pre-enumerated cannot be requested without code/configuration work.

Approval-first execution adds a separate, runtime operation path: a governed agent can request human approval for a concrete legitimate operation that its static role and admitted assignment already permit in principle. Operations already allowed by policy run automatically. The human may approve the bounded operation and the same OpenCode session continues.

This phase defines the contract only. It does not change `agents/*.md`, alter M4 admission semantics, implement a shell parser, run `--auto`, or start M7/M8 implementation.

## Non-goals

- A human approval is not a grant of a capability, semantic authority, role, task assignment, or persistent policy.
- Approval-first does not permit a reviewer, verifier, planner, researcher, judge, or committer to edit implementation source.
- It does not replace deterministic closeout with ad-hoc Git history operations.
- It does not infer arbitrary command meaning from text, rewrite M4 evidence, or grant `always`/persistent approval by default.
- It does not promise identical behavior from a future OpenCode version.

## Terms and state namespaces

| Term | Meaning | Authority source |
| --- | --- | --- |
| Capability | Semantic competence, e.g. `review.evaluate` or `command.execute`. | Closed M4 vocabulary and manifest contract. |
| Semantic authority | Constitutional effect boundary, e.g. `may_edit`. | Manifest-derived role contract. |
| Configured permission | OpenCode rule configured for a tool/action/pattern. | Effective OpenCode configuration, then projection evidence. |
| Runtime approval | Human decision for one pending operation. | Resolver response, bound to an approval request. |
| Effective operation | The tool/action/pattern actually requested and, if approved, executed by OpenCode. | Permission event and observed tool/result evidence. |
| Execution evidence | Append-only provenance showing the decision, execution, and result. | Ledger plus bounded sanitized/OpenCode event evidence. |

Configured/effective operation states are closed and distinct:

| State | Meaning | Default consequence |
| --- | --- | --- |
| `ALLOW` | A recognized, valid configured rule authorizes the operation. | Execute automatically only after admission/authority checks. |
| `ASK` | A recognized operation needs a human decision. | Pause and submit a bounded approval request. |
| `DENY` | A configured rule or constitutional/effect check rejects it. | Reject; do not ask as a bypass. |
| `UNKNOWN` | The concrete operation or its requested form is not recognized/classifiable under the operation schema. | Request approval if governance itself is valid and the effect class is permitted. |
| `NOT_PROJECTED` | Present M4 projection has no model for this operation. | M4 remains fail-closed; approval-first must classify it under a new versioned operation schema before it can be asked. |

`ASK` is an intentional policy state. `UNKNOWN` is not a policy state and must carry an explicit reason such as `UNRECOGNIZED_COMMAND_FORM`. `NOT_PROJECTED` is a schema-coverage fact, not an unknown command. Therefore: **unknown action -> ASK; unknown governance state -> fail closed.** A malformed manifest, contract, projection, request, event, resolver response, or authority/effect classification is an unknown governance state and returns `DENY`, never `ASK`.

## Authority and approval separation

Admission remains the first gate. It checks capability, static semantic authority, contract validity, and the versioned configured-permission projection. Approval-first is considered only after a valid admitted subject and assignment exist and only for an operation whose effect class is inside the admitted envelope.

An approval grants the serialized operation request—not an authority field. It cannot mutate `authority.may_*`, add a manifest capability, change the role fingerprint, turn a `DENY` into an allowed effect, or serve as a future assignment admission. A reviewer may ask to run an unfamiliar **read-only diagnostic**; it cannot ask to write the implementation under review. That request is rejected/routed to the coder before a human prompt.

## Effect classification and role preservation

Phase 2 must introduce a closed, versioned `EffectClass` vocabulary before approving anything not already projected. Initial classes must at least distinguish `repository.read`, `diagnostic.execute`, `test.execute`, `repository.edit`, `git.stage`, `git.commit`, `git.push`, `web.research`, and `external_directory`. Classification is based on typed tool metadata and bounded arguments where available, not speculative shell parsing. An operation whose effect cannot be classified is rejected as `EFFECT_CLASS_UNKNOWN`.

“Unknown concrete command -> ASK” means a new command value under an already recognized typed operation/effect envelope: its raw command/pattern is opaque and is retained in the approval request, so no code change is required merely because that string is new. It does **not** mean an unclassifiable shell program receives a prompt. If the 1.18.21 event metadata cannot safely establish the allowed read-only/diagnostic effect for a reviewer, that operation remains rejected until a typed upstream signal or a separately designed bounded adapter exists. This preserves the reviewer-write boundary without inventing a shell parser.

The role/effect rules are:

- Planner, researcher, verifier, reviewer, wayfinder, judge, and committer remain read-oriented. Their approval-eligible classes are only the explicitly declared read/diagnostic/test classes; mutation is rejected or routed to the effect owner.
- Coder remains the implementation owner. Approval may unblock a bounded operation inside an admitted implementation assignment but does not confer stage/commit/push authority.
- Committer remains semantic-closeout preparation only. Deterministic runtime ownership of gate evaluation, exact staging, commit execution, and optional push is unchanged.
- A human-approved exceptional operation records `approval_path=exceptional`; deterministic closeout records `approval_path=deterministic_closeout`. They are not interchangeable.
- A runtime permission prompt is not a semantic question from a subagent. Semantic questions continue through the orchestrator/human-facing workflow and are not answered by an operation resolver.

## Runtime protocol

### Interactive

1. Validate contract, assignment, requested/effective subject, compatibility pin, and projection. Any invalid/contradictory state fails before prompt submission or resolves as `DENY`.
2. Subscribe to OpenCode events before prompt submission. On a matching `permission.updated`, bind the event to the admitted session/descendant policy, normalize only documented fields, classify its effect, and reconcile configured/projected state.
3. `ALLOW` proceeds automatically only when the projected and effective decision agree. `DENY` replies/rejects and emits rejection evidence. `ASK` and valid-action `UNKNOWN` create one approval request and pause the same session.
4. The interactive resolver presents role, admitted assignment ID/fingerprint, session ID, permission ID, tool/type, bounded pattern/metadata digest, effect class, configured state, requested scope, expiry, and consequence. It must not present a vague “allow agent” affordance.
5. A positive reply is `once` unless a separately authorized persistent-policy workflow is invoked. Record the reply acknowledgement, then wait for observed tool completion/failure and session completion.

### SDK/headless

The current `runOpenCodeSdkSession` subscribes and waits for idle/errors but does not recognize or reply to permission events. Phase 2 must add an explicit `approvalResolver` interface. Headless execution with an `ASK` or valid-action `UNKNOWN` and no resolver returns `APPROVAL_RESOLVER_UNAVAILABLE`, aborts the session, records evidence, and exits non-zero. It must not hang or use `--auto`.

An automated resolver is permitted only when it returns a previously verified, human-originated, still-valid bounded approval record. It has no default “yes” behavior. CLI `--auto` is prohibited from governed execution because the pinned CLI describes it as auto-approving any permission not explicitly denied.

### Approval lifecycle and scope

`ApprovalRequest v1` must include immutable request ID, policy/contract/assignment fingerprints, role, session ID, OpenCode permission ID, parent/root-session relationship, effect class, normalized operation descriptor, configured state, reason, scope, issued/expiry times, and metadata hash. `ApprovalDecision v1` includes request ID, responder identity/provenance, `APPROVE_ONCE|REJECT|EXPIRE`, decision time, and exact scope.

Allowed scopes are explicit and ordered from narrow to broad: `ONE_OPERATION` (default), `ONE_SESSION_EXACT_PATTERN`, and `ONE_SESSION_EFFECT_CLASS_PATTERN`. No other scope is valid. A broader request never silently results from a narrower response. Session-scoped approval expires when the root governed session ends, aborts, changes admitted assignment, or reaches its TTL. It is not written to agent Markdown, manifest, profile, OpenCode config, machine config, or a persistent rule store.

Timeout, resolver disconnect, malformed reply, stale/duplicate permission ID, event stream end, server restart, parent/child mismatch, or lack of observed reply acknowledgement produce `EXPIRED`/`REJECTED`, abort the bounded session, and retain evidence. A reply success code alone is not proof that the operation executed.

## Persistent policy and break-glass boundaries

Persistent policy is a separate, reviewed configuration change with a new projection, contract validation, and ordinary repository change/evidence lifecycle. An interactive “always” option is not a shortcut to that process. Before any future use of OpenCode `always`, an exact-pinned empirical test must establish its storage location, precedence, lifetime, revocation, and whether it changes the effective rule set.

Break-glass is outside normal approval-first. It requires a named human authority, a bounded incident/change ticket, explicit effect scope and expiry, independent evidence, and post-action review. It cannot modify manifest authority or turn a failed governance check into an approval prompt.

## Pinned OpenCode 1.18.21 facts and compatibility

This repository pins `@opencode-ai/sdk` and the executable to `1.18.21`. The installed generated SDK exposes:

- configured agent permission values `ask|allow|deny` for `edit`, `bash` patterns, `webfetch`, and `external_directory` in its Agent type;
- `permission.updated` with `id`, `type`, optional `pattern`, `sessionID`, `messageID`, optional `callID`, `title`, opaque `metadata`, and creation time;
- `permission.replied` with `sessionID`, `permissionID`, and a response string; and
- `POST /session/{id}/permissions/{permissionID}` with `once|always|reject` and a boolean response.

The installed CLI’s `run --help` states that `--auto` auto-approves permissions not explicitly denied. M2 has proven only its runtime overlay/model precedence, not permission-rule precedence. The SDK schema does not specify bash-pattern precedence, default behavior when no rule matches, the metadata schema by tool, persistence of `always`, or interactive versus headless resolution behavior. The current harness therefore must not treat its existing longest-pattern projector as a proof of upstream precedence; it is an Ocode v1 projection for its existing narrow forms. Phase 2's pinned characterization suite must prove those items in isolated HOME/project directories, including CLI interactive, CLI JSON/headless, SDK server/session, root and child sessions, `once`, `always`, `reject`, and restart behavior. Any disagreement between OpenCode's observed request/effect and Ocode's projected semantics is `OPENCODE_PROJECTION_MISMATCH` and fails closed.

## Evidence and rejection requirements

For every operation, append immutable provenance for the admitted role/assignment, static authority evaluation, projection schema/version/fingerprint, upstream version, raw-event digest/redacted normalized descriptor, effect classification, resolver availability, approval request/decision/expiry, reply acknowledgement, observed operation result, session outcome, and mismatch/rejection codes. Do not log secrets or opaque metadata verbatim unless it passes an explicit redaction contract.

Rejections are actionable and distinguish: invalid governance, authority/effect mismatch, configured deny, projection mismatch, unclassifiable operation, resolver unavailable, timeout, stale request, and upstream reply failure. The ledger must be sufficient to show that human approval authorized an operation, not a role.

## Migration phases

1. **Characterize pin:** isolated, deterministic fixtures prove the exact 1.18.21 semantics above and freeze a versioned observation record. No policy change.
2. **Contract substrate:** add closed approval/effect schemas, validators, ledger fields, redaction, and negative fixtures. M4 v1 remains available and unchanged.
3. **Projection reconciliation:** version the projector to represent `ASK`; introduce typed operation descriptors and explicit mismatch handling. Do not mass-convert current denies.
4. **Interactive adapter:** implement event-to-resolver-to-reply flow, `once` only, timeout/abort, and observed completion reconciliation.
5. **Headless adapter:** require resolver injection; prove no-resolver failure and no hang. `--auto` remains prohibited.
6. **Narrow rollout:** opt in one read-only diagnostic effect class, then coder-only bounded operations, each behind acceptance evidence and review. Persistent policy and break-glass remain separate.

## Security invariants

1. Unknown action -> ASK only after valid governance and permitted effect classification; unknown governance -> DENY.
2. `ASK != UNKNOWN != NOT_PROJECTED`; their provenance and handling remain distinguishable.
3. Approval is operation/session/pattern bounded and never mutates static authority.
4. A configured `DENY`, authority mismatch, invalid contract, or projection mismatch cannot be bypassed by human runtime approval.
5. Headless asks without a resolver fail explicitly and terminate the session.
6. Session approval cannot become persistent policy implicitly.
7. Role independence and deterministic closeout ownership survive every approval path.
8. Requested, approved, replied, and observed effective operations must reconcile or fail closed.

## Acceptance matrix

| ID | Property | Phase that must prove it |
| --- | --- | --- |
| A | `ASK` is not `UNKNOWN`. | 2/3 schema and negative fixtures |
| B | A novel concrete command can request approval without a code change. | 4/5 typed runtime fixture |
| C | Malformed/unrecognized governance configuration fails closed. | 2/3 negative fixtures |
| D | Approval scope is explicit and bounded to operation/session/pattern. | 2/4 ledger and expiry tests |
| E | Session approval never becomes persistent policy. | 1/4 restart/config-hash test |
| F | Approval never mutates static role authority. | 2/4 manifest/fingerprint test |
| G | Headless without resolver fails explicitly, not by hanging. | 5 timeout/abort fixture |
| H | Role independence survives. | 2/4 reviewer-write rejection and diagnostic ask fixtures |
| I | OpenCode and Ocode projection disagreement fails closed. | 1/3 mismatch fixtures |
| J | Deterministic closeout differs from approved exceptional operations. | 2/4 provenance and ownership fixtures |

## M7 entry-gate implications

M7 remains planning-only. It may carry an approved task's semantic authority envelope, but it must not emit an executable approval, treat plan authorization as runtime operation approval, select `--auto`, or mutate policy. M7 entry is additionally gated on the Phase 1 pinned characterization record and the Phase 2 closed schemas; M8 is gated on the interactive/headless acceptance matrix above. Until then M7 must continue to reuse M4 admission and regard generic command execution as `NOT_PROJECTED`.
