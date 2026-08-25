# M6 contracts v1

This is the implementation contract for M6.1. It is deliberately a design document: no parser, projection, qualification runner, or skill is introduced by M6.0.

## Common rules

- All objects are closed: an unknown field is invalid unless a later schema version says otherwise.
- IDs are lowercase kebab case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`); SHA-256 fingerprints are 64 lowercase hexadecimal characters.
- Arrays declared `unique, sorted` are normalized lexicographically before hashing. Times are ISO-8601 UTC strings. A `PathRef` is a repository-relative, normalized, non-escaping path; it is a reference, not file content.
- `EvidenceRef v1` means exactly the existing M5 shape and validator. M6 does not copy it, assign `CURRENT`, or replace dependency-scoped freshness.

## SkillProtocol v1

Canonical machine-readable file: `skills/<skill-id>/protocol.json`. Its sibling `SKILL.md` is canonical agent-facing method text. Together they are the canonical skill source.

```json
{
  "schema_version": 1,
  "skill_id": "tdd",
  "skill_version": "1.0.0",
  "purpose": "One bounded outcome expressed through a test-first feedback loop.",
  "applicability": [{"id":"bounded-behavior-change","when":"A behavior change can be specified and tested."}],
  "non_applicability": [{"id":"investigation-only","when":"No change is authorized or a cause is not yet established."}],
  "requirements": {
    "capabilities": ["command.execute","implementation.change","repository.edit","repository.read","test.execute"],
    "requested_authority": {"edit":true,"stage":false,"commit":false,"push":false}
  },
  "method": {
    "stages": [
      {"id":"observe","objective":"Establish the bounded behavior and existing evidence.","required_inputs":["objective"],"required_outputs":["baseline-observation"]}
    ],
    "max_structured_repairs": 1
  },
  "outputs": [{"id":"skill-result","kind":"EvidenceCapsule","required":true}],
  "evidence_requirements": [{"id":"acceptance-evidence","kind":"deterministic-observation","required":true}],
  "acceptance": [{"id":"behavior-proven","condition":"Acceptance mapping has supporting authoritative evidence."}],
  "failure_conditions": [{"id":"baseline-unavailable","condition":"Required deterministic observation cannot be obtained."}],
  "stop_conditions": [{"id":"acceptance-met","condition":"All acceptance items are evidenced."}],
  "qualification_requirements": {
    "positive_fixture": true,
    "method_violation_fixture": true,
    "authority_capability_negative_fixture": true,
    "evidence_integrity_negative_fixture": true,
    "context_economy_observation": true,
    "live_qualification": "OPTIONAL"
  }
}
```

| Field | Exact semantics |
| --- | --- |
| `schema_version` | Literal `1`. |
| `skill_id`, `skill_version` | Stable identity and SemVer release label. A version change does not authorize anything and cannot preserve qualification across a different fingerprint. |
| `purpose` | One concise intended outcome. |
| `applicability`, `non_applicability` | Non-empty, uniquely identified predicates expressed as observable `when` descriptions. They describe selection; they do not select a skill or role. |
| `requirements.capabilities` | Unique, sorted identifiers from M4’s existing closed vocabulary only. |
| `requirements.requested_authority` | Exactly booleans `edit`, `stage`, `commit`, `push`; no skill-specific authority exists. |
| `method.stages` | Ordered, unique stage IDs with objective, required input IDs, and required output IDs. This is the machine-checkable method skeleton. `max_structured_repairs` is literal `1`. |
| `outputs` | Unique output contracts. v1 requires exactly one required `EvidenceCapsule` output named `skill-result`; optional artifacts are named here. |
| `evidence_requirements` | Unique evidence obligations; each states its required observation kind, not a model assertion. |
| `acceptance`, `failure_conditions`, `stop_conditions` | Unique, observable conditions. A stop condition ends this bounded method; it does not schedule follow-on work. |
| `qualification_requirements` | All five listed fixture/observation requirements are literal `true`; `live_qualification` is `REQUIRED` or `OPTIONAL`, never inferred from a role or provider. |

`SkillProtocol.requirements` deterministically derives the existing M4 request, with only the candidate subject supplied by the caller:

```json
{"schema_version":1,"kind":"ASSIGNMENT","subject":{"role":"<candidate-role>"},"requirements":{"capabilities":"SkillProtocol.requirements.capabilities"},"requested_authority":"SkillProtocol.requirements.requested_authority","reference_contract_fingerprint":null}
```

M6.1 must pass that object unchanged to `validateAdmissionRequest()` / `evaluateAdmission()`. Admission, permission projection, reason codes, and effective-subject reconciliation remain M4.

## ContextCapsule v1

`ContextCapsule` is invocation input for one bounded method; it is not conversation memory.

```json
{
  "schema_version": 1,
  "objective": "Add a bounded behavior with regression coverage.",
  "constraints": ["Do not stage or commit."],
  "skill": {"skill_id":"tdd","skill_version":"1.0.0","skill_fingerprint":"<sha256>"},
  "path_refs": [{"path":"packages/example.mjs","reason":"implementation seam"}],
  "evidence_refs": ["<complete existing EvidenceRef v1 object>"],
  "assumptions": [{"id":"test-command","statement":"npm run test:unit is available","allowed":true,"validation_needed":true}],
  "acceptance_expectations": ["A failing test precedes the smallest behavior change."],
  "expected_outputs": ["skill-result"],
  "context_budget": {"max_path_refs":8,"max_evidence_refs":8,"max_supplied_chars":24000,"telemetry_boundary":"CAPSULE_ONLY"}
}
```

`constraints`, `path_refs`, EvidenceRefs, acceptance expectations, and expected outputs are authoritative invocation inputs. `objective` is authoritative scope. `assumptions` are advisory only until deterministically observed and must identify whether validation is needed. A capsule references files and evidence; it embeds neither a full transcript, milestone history, whole-repository dump, provider/router internals, arbitrary memory, nor a discovery mandate. Path references are an allowlist for initial inspection, not permission to perform unbounded discovery.

| Field | Exact semantics |
| --- | --- |
| `schema_version` | Literal `1`. |
| `objective`, `constraints` | Required bounded scope statement and unique, ordered hard limits. |
| `skill` | Exact selected canonical identity; fingerprint must equal the validated current source fingerprint. |
| `path_refs` | Unique `PathRef` plus reason; its count must not exceed `context_budget.max_path_refs`. |
| `evidence_refs` | Complete existing M5 EvidenceRef v1 objects, unique by ID; count must not exceed `max_evidence_refs`. |
| `assumptions` | Unique IDs, statement, boolean `allowed`, boolean `validation_needed`; advisory as stated above. |
| `acceptance_expectations`, `expected_outputs` | Unique ordered strings; output IDs must exist in the selected protocol. |
| `context_budget` | Positive integer `max_path_refs`, `max_evidence_refs`, `max_supplied_chars`; literal `CAPSULE_ONLY` telemetry boundary. The supplied serialized capsule character count must not exceed its maximum. |

The future M7 compiler constructs capsules from a selected qualified protocol and task evidence; M8 supplies them to a governed execution. Neither gets to alter the selected fingerprint. M6.1 only validates/builds the boundary. Telemetry records supplied path/reference count, EvidenceRef count, supplied character count, files inspected, tool calls, external requests, repair attempts, and input/output tokens only when OpenCode exposes them. It is observational, never an admission predicate and never a provider-accounting requirement.

## EvidenceCapsule v1

`EvidenceCapsule` is the validated structured result of one skill method. It links to, but never duplicates, the run ledger.

```json
{
  "schema_version": 1,
  "skill": {"skill_id":"tdd","skill_version":"1.0.0","skill_fingerprint":"<sha256>"},
  "subject": {"requested_role":"coder"},
  "claims": [{"id":"claim-1","statement":"The acceptance condition is met.","classification":"MODEL_CLAIM"}],
  "observations": [{"id":"obs-1","kind":"deterministic-command","statement":"The named validation completed.","evidence_ref":"validation-1"}],
  "deterministic_validation": [{"command":"npm run test:unit","evidence_ref":"validation-1"}],
  "changed_files": [{"path":"packages/example.mjs","evidence_ref":"file-change-1"}],
  "artifacts": [{"path":"artifacts/result.json","kind":"result","evidence_ref":"artifact-1"}],
  "reused_evidence_refs": ["<complete existing EvidenceRef v1 object>"],
  "acceptance_mapping": [{"acceptance_id":"behavior-proven","state":"SATISFIED","supporting_evidence_refs":["validation-1"]}],
  "unresolved_items": [],
  "provenance_refs": {"run_id":"<existing-ledger-run-id>","session_id":"<OpenCode-session-id-or-null>"}
}
```

`claims` are model assertions and cannot satisfy acceptance alone. `observations` report what was observed and must cite an EvidenceRef. `deterministic_validation`, `changed_files`, and `artifacts` are model-reported pointers pending runtime reconciliation; they become authoritative only when the runtime deterministically observes and supplies their EvidenceRefs. `subject.requested_role` is a request label, not an effective-subject assertion. `provenance_refs` point to existing ledger/session provenance and add no ledger fields.

The runtime alone may create or mark `CURRENT` EvidenceRefs, compute hashes/dependency fingerprints, record commands/results or mutations, and determine effective subject/model and ledger provenance. A model may reuse supplied EvidenceRefs, make claims, report observations, and identify missing evidence. It may not mint authoritative facts. Each `acceptance_mapping` has `SATISFIED`, `UNSATISFIED`, or `UNRESOLVED`; `SATISFIED` requires one or more runtime-trusted supporting EvidenceRefs. This maintains the four-way distinction: model claim; observed fact; authoritative evidence; execution provenance.

| Field | Exact semantics |
| --- | --- |
| `schema_version`, `skill` | Literal version and exact executed protocol identity/fingerprint. |
| `subject` | Requested role label only; effective role comes only from existing execution provenance. |
| `claims` | Unique model-authored claim ID, statement, and literal `MODEL_CLAIM` classification. |
| `observations` | Unique reported observation with kind, statement, and an EvidenceRef ID present in `reused_evidence_refs` or runtime-attached trusted evidence. |
| `deterministic_validation`, `changed_files`, `artifacts` | Reported pointers with EvidenceRef IDs; no field itself establishes a command outcome, mutation, hash, or artifact existence. |
| `reused_evidence_refs` | Complete supplied/reused M5 EvidenceRef v1 objects, unique by ID; freshness remains M5-derived. |
| `acceptance_mapping` | One entry for every selected protocol acceptance ID, with valid state and supporting EvidenceRef IDs. |
| `unresolved_items` | Unique explicit gaps; must be empty before a method claims all acceptance satisfied. |
| `provenance_refs` | Existing run/session identifiers or null; these are links, never independently asserted provenance. |

## QualificationRecord v1

Canonical immutable records live at `skills/<skill-id>/qualifications/<skill-fingerprint>.json`; their filename must equal `skill_fingerprint`. They are repository source, not chat history or ledger substitutes.

```json
{
  "schema_version": 1,
  "skill_id": "tdd",
  "skill_version": "1.0.0",
  "skill_fingerprint": "<sha256>",
  "suite": {"id":"tdd-v1","fixture_fingerprint":"<sha256>"},
  "deterministic_results": [{"fixture_id":"positive","status":"PASS","evidence_ref":"fixture-positive"}],
  "negative_case_results": [{"fixture_id":"authority-deny","status":"PASS","evidence_ref":"fixture-authority"}],
  "method_conformance": {"status":"PASS","evidence_refs":["method-proof"]},
  "governance_conformance": {"status":"PASS","evidence_refs":["admission-proof"]},
  "evidence_conformance": {"status":"PASS","evidence_refs":["integrity-proof"]},
  "context_conformance": {"status":"PASS","observation":{"supplied_path_refs":3,"supplied_evidence_refs":2,"supplied_chars":1800,"files_inspected":3,"tool_calls":4,"external_requests":0,"repair_attempts":0},"evidence_refs":["context-proof"]},
  "live_qualification": {"required":false,"status":"NOT_REQUIRED","evidence_ref":null},
  "execution_provenance_ref": {"run_id":"<ledger-run-id-or-null>","session_id":"<session-id-or-null>"},
  "status": "QUALIFIED",
  "observed_at": "2026-08-25T00:00:00Z"
}
```

| Field | Exact semantics |
| --- | --- |
| `schema_version`, `skill_id`, `skill_version`, `skill_fingerprint` | Literal version and exact protocol identity; filename must equal fingerprint. |
| `suite` | Immutable qualification suite ID and fixture-set fingerprint. |
| `deterministic_results`, `negative_case_results` | Named fixture results with `PASS`/`FAIL` and retained evidence. The negative list covers method, authority/capability, and evidence-integrity fixtures. |
| `method_conformance`, `governance_conformance`, `evidence_conformance`, `context_conformance` | Each has `PASS`/`FAIL` and non-empty retained evidence. Context also retains the required telemetry observation. |
| `live_qualification` | `required` boolean, with `NOT_REQUIRED`, `PASS`, or `FAIL`; `PASS`/`FAIL` require an EvidenceRef. |
| `execution_provenance_ref` | Existing ledger/session reference or null; it does not replicate a ledger record. |
| `status`, `observed_at` | Validator-derived final `QUALIFIED` or `DISQUALIFIED`, and final observation time. |

`status` is a recorded, validator-derived conclusion, not a hand-maintained boolean: `QUALIFIED` requires every required deterministic and negative fixture plus method, governance, evidence, context, and required live result to pass; `DISQUALIFIED` records a completed failing suite or conformance failure. `observed_at` is the time the final deterministic observation was recorded, not a promise of continuing freshness. The record must retain EvidenceRefs and any live execution reference needed to reconstruct its conclusion.

For a current valid protocol/source pair, state is derived as follows:

| State | Derivation |
| --- | --- |
| `DRAFT` | Source is incomplete or structural protocol/source validation fails. |
| `VALID` | Source validates and no QualificationRecord exists for this skill ID. |
| `QUALIFIED` | A structurally valid matching-fingerprint record has status `QUALIFIED` and all required conformance evidence passes. |
| `STALE` | Source validates, at least one historical record exists for the skill ID, and no matching-fingerprint final record exists. |
| `DISQUALIFIED` | A structurally valid matching-fingerprint record has status `DISQUALIFIED`, or its required retained evidence is invalid/missing. |

Thus a qualified fingerprint A followed by source fingerprint B is `STALE`; A never qualifies B. Qualification is not carried forward by skill ID, version, role, or human memory.
