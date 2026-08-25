# Governance contracts

M4A defines Ocode's governance language and structural role contracts. It does not implement admission decisions, permission projection, or effective-subject reconciliation.

## Constitutional terms

- **Capability** is engineering work a semantic role is equipped to perform. A capability is descriptive and never grants authority.
- **Authority** is a constitutional grant to take a consequential action. The manifest fields `may_edit`, `may_stage`, `may_commit`, and `may_push` remain the current explicit authority declarations.
- **Permission** is an OpenCode runtime or environment constraint. Permission does not define Ocode constitutional authority, and M4A does not judge permission/authority compatibility.
- **Requirement** is an explicit capability or policy condition requested by governed work. Later M4 phases will compare requirements with subjects through the admission engine.
- **Identity** is evidence about whether observed bytes or semantic contracts match a reference. Identity supports provenance, reproducibility, drift detection, and transactional integrity.
- **Governance** is structural and policy validity under Ocode's constitutional invariants.
- **Admission** is the eventual `ALLOW` or `DENY` result for a concrete request and subject. M4A defines the words, not the decision engine.

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

## M4A boundary

M4A performs closed structural validation only: supported capability schema, valid vocabulary, complete manifest-derived declarations, and valid identifiers. It does not implement `AdmissionRequest`, `AdmissionDecision`, permission compatibility, runtime permission projection, or effective-subject enforcement.
