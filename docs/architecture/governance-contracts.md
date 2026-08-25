# Governance contracts

M4A defines Ocode's governance language and structural role contracts. M4B adds the deterministic, provider-independent admission core. Permission projection and effective-subject reconciliation remain deliberately deferred.

## Constitutional terms

- **Capability** is engineering work a semantic role is equipped to perform. A capability is descriptive and never grants authority.
- **Authority** is a constitutional grant to take a consequential action. The manifest fields `may_edit`, `may_stage`, `may_commit`, and `may_push` remain the current explicit authority declarations.
- **Permission** is an OpenCode runtime or environment constraint. Permission does not define Ocode constitutional authority, and M4A does not judge permission/authority compatibility.
- **Requirement** is an explicit capability or authority condition requested by governed work. M4B compares requirements with subjects through the admission engine.
- **Identity** is evidence about whether observed bytes or semantic contracts match a reference. Identity supports provenance, reproducibility, drift detection, and transactional integrity.
- **Governance** is structural and policy validity under Ocode's constitutional invariants.
- **Admission** is the `ALLOW` or `DENY` result for a concrete request and subject.

## Predicate-based governance

Future admission decisions must evaluate semantic capability, declared authority, permission projection, explicit requirements, and policy invariants. They must not primarily evaluate historical fingerprint equality. M6 skills and M7 TaskSpecs must supply requirements to this one M4 admission engine rather than create parallel compatibility systems.

Capability, authority, and permission are separate predicates. For example, `repository.edit` says that a role is semantically equipped to edit; only `authority.may_edit` can constitutionally authorize editing; OpenCode `permission.edit` constrains what the effective runtime can do. None of these fields is inferred from another.

## Identity is evidence

Identity state has exactly three M4A values:

- `MATCHES_REFERENCE`
- `DRIFTED`
- `UNREFERENCED`

Governance state is separately `VALID` or `INVALID`. Admission is separately `ALLOW` or `DENY`. These namespaces are not interchangeable, and the architecture permits:

```text
identity = DRIFTED
governance = VALID
admission = ALLOW
```

A changed Git SHA or semantic fingerprint alone must not imply `DENY`. Exact identity gates are exceptional and appropriate only when byte identity is itself required, such as transactional artifact promotion, closeout TOCTOU protection, substitution detection after validation, exact reproduction, or an explicitly immutable release boundary. Ocode must not use SHA or fingerprint allowlists as general authorization policy.

## Capability vocabulary and role declarations

`packages/harness-runtime/lib/governance.mjs` owns capability schema version 1 and the closed vocabulary. Identifiers are lowercase, dot-namespaced values. The vocabulary is intentionally small:

| Capability | Meaning |
| --- | --- |
| `repository.read` | Inspect repository files and state. |
| `repository.edit` | Edit repository files when separately authorized. |
| `command.execute` | Execute commands within runtime constraints. |
| `test.execute` | Execute repository-defined validation commands. |
| `web.research` | Research current external sources. |
| `orchestration.coordinate` | Coordinate governed roles and evidence. |
| `planning.decompose` | Decompose engineering work into an implementation plan. |
| `research.investigate` | Investigate an external technical question. |
| `implementation.change` | Implement bounded engineering changes. |
| `verification.validate` | Independently validate requested properties. |
| `review.evaluate` | Evaluate changes and evidence. |
| `judgment.adjudicate` | Adjudicate a specific technical disagreement. |
| `closeout.evaluate` | Evaluate bounded semantic closeout evidence. |

Every role in `agents/manifest.json` has one versioned `capabilities` declaration. The normalized agent contract contains role identity, capabilities, authority, governance metadata, OpenCode permissions, semantic content, and a semantic contract fingerprint. Capability order is normalized before fingerprinting. The manifest remains the only governed-role registry.

## Requested and effective state

M3's requested/effective doctrine remains in force. A bounded `mode: primary` OpenCode overlay is an execution mechanism only. It never changes the semantic role identity, capabilities, authority, Git authority, or a future admission result. Later phases will separately reconcile declared authority with permission projection and the admitted subject with the effective OpenCode agent.

## M4B admission contracts

`packages/harness-runtime/lib/admission.mjs` provides pure, deterministic version-1 functions for validating an `AdmissionRequest` and evaluating an `AdmissionDecision`. Assignment admission consumes only a manifest-derived normalized role contract and explicit predicates:

```text
AdmissionRequest
  schema_version
  kind: CONTRACT | ASSIGNMENT
  subject.role
  requirements.capabilities
  requested_authority: edit, stage, commit, push
  optional reference_contract_fingerprint (provenance only)
        ↓
AdmissionDecision
  decision: ALLOW | DENY
  capability_evaluation
  authority_evaluation
  permission_evaluation: projected configured-permission evidence
  identity_state
  governance_state
  reason_codes and structured failure details
```

Capability satisfaction is a subset test: required capabilities must be present in the subject's structured capabilities. Authority sufficiency maps each requested action only to its matching `may_*` declaration. Role names select a manifest-derived contract; they never create a policy exception or grant authority. Future SkillProtocol and TaskSpec inputs can therefore translate into this one request shape without a parallel governance engine.

Reason codes are deliberately few and machine-readable: `REQUIRED_CAPABILITIES_SATISFIED`, `REQUIRED_CAPABILITY_MISSING`, `AUTHORITY_COMPATIBLE`, `AUTHORITY_INSUFFICIENT`, `CONTRACT_VALID`, `CONTRACT_INVALID`, `IDENTITY_DRIFT_OBSERVED`, and `IDENTITY_UNREFERENCED`. Missing capabilities and failed authority actions are structured data, not prose.

M4B originally recorded permission evaluation as `NOT_EVALUATED`. M4C now projects a deliberately bounded, configured-permission view: `edit`, `test`, `stage`, `commit`, `push`, and `web` each resolve to `ALLOW`, `DENY`, or `UNKNOWN`, with compact source/evidence provenance. Generic `command.execute` is deliberately `NOT_PROJECTED`; this is distinct from an in-scope `UNKNOWN` result and never claims arbitrary shell authorization.

The existing `AdmissionDecision` consumes this projection in two narrow ways. Requirement-scoped sufficiency fails closed only when a requested permission-backed operation is `DENY`, `UNKNOWN`, or `NOT_PROJECTED`. Separately, every known projected mutation `ALLOW` is always checked against its corresponding `may_edit`, `may_stage`, `may_commit`, or `may_push` declaration; permission that exceeds authority invalidates governance even if that mutation was not requested. Test and web do not invent new authority axes. The projector describes configured permission evidence, not effective runtime permission; M4D will reconcile the admitted role with the effective OpenCode agent, and M4E will productize explanation/audit.

Contract admission is a structural evaluation of a normalized role contract. Assignment admission evaluates explicit requested capabilities and authority. Both preserve the M4A identity rule: `DRIFTED` is provenance evidence, not a denial predicate, so a valid request may return `DRIFTED` + `VALID` + `ALLOW`.

## M4A boundary

M4A performs closed structural validation only: supported capability schema, valid vocabulary, complete manifest-derived declarations, and valid identifiers. M4B builds on those inputs with admission evaluation. M4C adds only the six-operation configured permission projection and least-authority check; it still does not implement effective-subject enforcement.
