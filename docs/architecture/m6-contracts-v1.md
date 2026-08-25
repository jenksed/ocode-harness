# M6 contracts v1

This is the implementation contract for M6.1. It is deliberately a design document: no parser, projection, qualification runner, or skill is introduced by M6.0.

## Common rules

- All objects are closed: an unknown field is invalid unless a later schema version says otherwise.
- IDs are lowercase kebab case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`); SHA-256 fingerprints are 64 lowercase hexadecimal characters.
- Arrays declared `unique, sorted` are normalized lexicographically before hashing. Times are ISO-8601 UTC strings. A `PathRef` is a repository-relative, normalized, non-escaping path; it is a reference, not file content.
- `EvidenceRef v1` means exactly the existing M5 shape and validator. M6 does not copy it, assign `CURRENT`, or replace dependency-scoped freshness.

## Semantic fingerprint canonicalization v1

The semantic fingerprint is exactly the SHA-256 digest, rendered as 64 lowercase hexadecimal characters, of this byte sequence:

```text
ASCII("OCODE-SKILL-V1\0") || canonical-protocol-utf8 || ASCII("\0SKILL-MD\0") || normalized-skill-md-utf8
```

`protocol.json` must first decode as UTF-8 and pass its closed SkillProtocol v1 validator. Before serialization, only arrays explicitly declared set-like are normalized: `requirements.capabilities` is unique and sorted by ascending Unicode code point. All other arrays, including method stages and applicability entries, preserve source order because their order is semantic. The resulting validated object is serialized with [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785): recursive object-member ordering, standard canonical JSON number/string serialization, and no insignificant whitespace. Protocol strings and keys receive no Unicode normalization; their validated decoded values are semantic.

Canonical `SKILL.md` bytes are derived as follows: decode source as UTF-8; normalize Unicode to NFC; replace every CRLF or CR with LF; remove trailing space and tab characters from every line; remove all leading and trailing blank lines (a blank line is empty after that trailing-whitespace removal); require remaining content to be non-empty; then append exactly one terminal LF. Filesystem path, mtime, mode, repository SHA, projected OpenCode files, qualification records, and source comments outside these two canonical files are excluded. M6.1 must add deterministic vectors proving object-key/whitespace equivalence, set-like capability ordering, ordered-array sensitivity, CRLF/NFC/trailing-space normalization, and sensitivity to a semantic protocol or SKILL.md change.

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
    "live_qualification": "REQUIRED"
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

`SkillProtocol.requirements` deterministically derives the existing M4 request, with only the candidate subject supplied by the caller. For the example TDD protocol above and candidate role `coder`, the valid derived object is:

```json
{
  "schema_version": 1,
  "kind": "ASSIGNMENT",
  "subject": {
    "role": "coder"
  },
  "requirements": {
    "capabilities": [
      "command.execute",
      "implementation.change",
      "repository.edit",
      "repository.read",
      "test.execute"
    ]
  },
  "requested_authority": {
    "edit": true,
    "stage": false,
    "commit": false,
    "push": false
  }
}
```

M6.1 must pass that object unchanged to `validateAdmissionRequest()` / `evaluateAdmission()`. `reference_contract_fingerprint` is intentionally omitted: the existing M4 validator permits its absence and normalizes it to `null`; it is provenance-only, not a skill requirement. Admission, permission projection, reason codes, and effective-subject reconciliation remain M4.

## ContextCapsule v1

`ContextCapsule` is invocation input for one bounded method; it is not conversation memory.

```json
{
  "schema_version": 1,
  "objective": "Add a bounded behavior with regression coverage.",
  "constraints": ["Do not stage or commit."],
  "skill": {"skill_id":"tdd","skill_version":"1.0.0","skill_fingerprint":"0000000000000000000000000000000000000000000000000000000000000000"},
  "path_refs": [{"path":"packages/example.mjs","reason":"implementation seam"}],
  "evidence_refs": [{"schema_version":1,"id":"baseline-test","kind":"test","claim":"The existing focused test baseline was observed.","source":"test/test-example.mjs","dependency_scope":["test/test-example.mjs"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/test-example.mjs":"baseline-sha256"}}],
  "assumptions": [{"id":"test-command","statement":"npm run test:unit is available","allowed":true,"validation_needed":true}],
  "acceptance_expectations": ["A failing test precedes the smallest behavior change."],
  "expected_outputs": ["skill-result"],
  "context_budget": {"max_path_refs":8,"max_evidence_refs":8,"max_supplied_chars":24000,"telemetry_boundary":"CAPSULE_ONLY"},
  "context_expansion_policy": {"max_expansions":1}
}
```

`constraints`, `path_refs`, EvidenceRefs, acceptance expectations, and expected outputs are authoritative invocation inputs. `objective` is authoritative scope. `assumptions` are advisory only until deterministically observed and must identify whether validation is needed. A capsule references files and evidence; it embeds neither a full transcript, milestone history, whole-repository dump, provider/router internals, arbitrary memory, nor a discovery mandate. Path references are an allowlist for initial inspection, not permission to perform unbounded discovery or a replacement for M4 filesystem permission.

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
| `context_expansion_policy` | Object with non-negative integer `max_expansions`. It limits bounded, explicitly justified inspection outside initial `path_refs`; it grants no permission. |

An expansion is allowed only when the method identifies a bounded missing relationship, records `reason`, one `source_ref` (a supplied path or EvidenceRef ID), and the exact `added_path_refs`; the runtime records this as a `ContextExpansionRecord` in capsule telemetry. `added_path_refs` become supplied only for the remaining bounded method, never retroactively. The number of accepted records must not exceed `max_expansions`; rejected or attempted expansions are also telemetry. Uncontrolled whole-tree discovery, or an expansion without this record, is a context-conformance failure when the fixture did not justify it.

The future M7 compiler constructs capsules from a selected qualified protocol and task evidence; M8 supplies them to a governed execution. Neither gets to alter the selected fingerprint. M6.1 only validates/builds the boundary. Telemetry records supplied path/reference count, EvidenceRef count, supplied character count, files inspected, tool calls, external requests, repair attempts, input/output tokens when OpenCode exposes them, and `context_expansions: [{"reason":"...","source_ref":"...","added_path_refs":["..."],"outcome":"ACCEPTED|REJECTED"}]`. It is observational, never an admission predicate and never a provider-accounting requirement.

## EvidenceCapsule v1

`ReportedEvidenceCapsule` is the model-produced, closed result shape: it contains `schema_version`, `skill`, `subject`, `claims`, `observations`, `deterministic_validation`, `changed_files`, `artifacts`, `acceptance_mapping`, `unresolved_items`, and `provenance_refs`, but no EvidenceRef collection. It may name only IDs in the runtime-supplied EvidenceRef set. The deterministic runtime validates it, injects the complete supplied `reused_evidence_refs`, attaches its separately observed `runtime_evidence_refs`, revalidates all references against their union, and produces the closed `EvidenceCapsule`. `EvidenceCapsule` is the validated structured result of one skill method and links to, but never duplicates, the run ledger.

```json
{
  "schema_version": 1,
  "skill": {"skill_id":"tdd","skill_version":"1.0.0","skill_fingerprint":"0000000000000000000000000000000000000000000000000000000000000000"},
  "subject": {"requested_role":"coder"},
  "claims": [{"id":"claim-1","statement":"The acceptance condition is met.","classification":"MODEL_CLAIM"}],
  "observations": [{"id":"obs-1","kind":"deterministic-command","statement":"The named validation completed.","evidence_ref":"validation-1"}],
  "deterministic_validation": [{"command":"npm run test:unit","evidence_ref":"validation-1"}],
  "changed_files": [{"path":"packages/example.mjs","evidence_ref":"file-change-1"}],
  "artifacts": [{"path":"artifacts/result.json","kind":"result","evidence_ref":"artifact-1"}],
  "reused_evidence_refs": [{"schema_version":1,"id":"baseline-test","kind":"test","claim":"The focused baseline is supplied evidence.","source":"test/test-example.mjs","dependency_scope":["test/test-example.mjs"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/test-example.mjs":"baseline-sha256"}}],
  "runtime_evidence_refs": [{"schema_version":1,"id":"validation-1","kind":"test","claim":"npm run test:unit completed successfully.","source":"npm run test:unit","dependency_scope":["packages/example.mjs"],"observed_at":"2026-08-25T00:01:00Z","freshness":"CURRENT","dependency_fingerprints":{"packages/example.mjs":"result-sha256"}},{"schema_version":1,"id":"file-change-1","kind":"file-change","claim":"packages/example.mjs was observed changed.","source":"packages/example.mjs","dependency_scope":["packages/example.mjs"],"observed_at":"2026-08-25T00:01:00Z","freshness":"CURRENT","dependency_fingerprints":{"packages/example.mjs":"result-sha256"}},{"schema_version":1,"id":"artifact-1","kind":"artifact","claim":"The skill result artifact was observed.","source":"artifacts/result.json","dependency_scope":["artifacts/result.json"],"observed_at":"2026-08-25T00:01:00Z","freshness":"CURRENT","dependency_fingerprints":{"artifacts/result.json":"artifact-sha256"}}],
  "acceptance_mapping": [{"acceptance_id":"behavior-proven","state":"SATISFIED","supporting_evidence_refs":["validation-1"]}],
  "unresolved_items": [],
  "provenance_refs": {"run_id":"<existing-ledger-run-id>","session_id":"<OpenCode-session-id-or-null>"}
}
```

`claims` are model assertions and cannot satisfy acceptance alone. `observations` report what was observed and must cite an EvidenceRef. `deterministic_validation`, `changed_files`, and `artifacts` are model-reported pointers pending runtime reconciliation; they become authoritative only when the runtime deterministically observes and attaches their EvidenceRefs in `runtime_evidence_refs`. `subject.requested_role` is a request label, not an effective-subject assertion. `provenance_refs` point to existing ledger/session provenance and add no ledger fields.

The runtime alone may create or mark `CURRENT` EvidenceRefs, compute hashes/dependency fingerprints, record commands/results or mutations, and determine effective subject/model and ledger provenance. A model may reference supplied EvidenceRef IDs, make claims, report observations, and identify missing evidence; it cannot author either evidence collection. `reused_evidence_refs` are copied only from trusted capsule input, and `runtime_evidence_refs` are attached only after deterministic observation. Each `acceptance_mapping` has `SATISFIED`, `UNSATISFIED`, or `UNRESOLVED`; `SATISFIED` requires one or more IDs in the trusted union of those collections. Every observation, validation, changed-file, artifact, and acceptance evidence ID must resolve in that union; dangling IDs are invalid. This maintains the four-way distinction: model claim; observed fact; authoritative evidence; execution provenance.

| Field | Exact semantics |
| --- | --- |
| `schema_version`, `skill` | Literal version and exact executed protocol identity/fingerprint. |
| `subject` | Requested role label only; effective role comes only from existing execution provenance. |
| `claims` | Unique model-authored claim ID, statement, and literal `MODEL_CLAIM` classification. |
| `observations` | Unique reported observation with kind, statement, and an EvidenceRef ID in the trusted union. |
| `deterministic_validation`, `changed_files`, `artifacts` | Reported pointers with EvidenceRef IDs; no field itself establishes a command outcome, mutation, hash, or artifact existence. |
| `reused_evidence_refs` | Complete M5 EvidenceRef v1 objects copied only from trusted supplied input, unique by ID; freshness remains M5-derived. |
| `runtime_evidence_refs` | Complete M5 EvidenceRef v1 objects attached only by deterministic runtime reconciliation, unique by ID and disjoint from reused IDs. |
| `acceptance_mapping` | One entry for every selected protocol acceptance ID, with valid state and supporting IDs in the trusted union. |
| `unresolved_items` | Unique explicit gaps; must be empty before a method claims all acceptance satisfied. |
| `provenance_refs` | Existing run/session identifiers or null; these are links, never independently asserted provenance. |

## QualificationRecord v1

Canonical immutable records live at `skills/<skill-id>/qualifications/<skill-fingerprint>.json`; their filename must equal `skill_fingerprint`. They are repository source, not chat history or ledger substitutes.

```json
{
  "schema_version": 1,
  "skill_id": "tdd",
  "skill_version": "1.0.0",
  "skill_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "suite": {"id":"tdd-v1","fixture_fingerprint":"1111111111111111111111111111111111111111111111111111111111111111"},
  "evidence_refs": [{"schema_version":1,"id":"fixture-positive","kind":"test","claim":"Positive fixture passed.","source":"test/fixtures/tdd/positive.json","dependency_scope":["test/fixtures/tdd/positive.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/positive.json":"fixture-positive-sha256"}},{"schema_version":1,"id":"fixture-authority","kind":"test","claim":"Authority negative fixture denied admission.","source":"test/fixtures/tdd/authority-deny.json","dependency_scope":["test/fixtures/tdd/authority-deny.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/authority-deny.json":"fixture-authority-sha256"}},{"schema_version":1,"id":"method-proof","kind":"test","claim":"Method conformance fixture passed.","source":"test/fixtures/tdd/method.json","dependency_scope":["test/fixtures/tdd/method.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/method.json":"method-sha256"}},{"schema_version":1,"id":"admission-proof","kind":"test","claim":"Governance conformance fixture passed.","source":"test/fixtures/tdd/governance.json","dependency_scope":["test/fixtures/tdd/governance.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/governance.json":"governance-sha256"}},{"schema_version":1,"id":"integrity-proof","kind":"test","claim":"Evidence integrity negative fixture passed.","source":"test/fixtures/tdd/evidence.json","dependency_scope":["test/fixtures/tdd/evidence.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/evidence.json":"integrity-sha256"}},{"schema_version":1,"id":"context-proof","kind":"test","claim":"Context conformance fixture passed.","source":"test/fixtures/tdd/context.json","dependency_scope":["test/fixtures/tdd/context.json"],"observed_at":"2026-08-25T00:00:00Z","freshness":"CURRENT","dependency_fingerprints":{"test/fixtures/tdd/context.json":"context-sha256"}},{"schema_version":1,"id":"live-proof","kind":"execution","claim":"Required governed live qualification passed.","source":"ledger:00000000-0000-4000-8000-000000000001","dependency_scope":["skills/tdd/protocol.json","skills/tdd/SKILL.md"],"observed_at":"2026-08-25T00:02:00Z","freshness":"CURRENT","dependency_fingerprints":{"skills/tdd/protocol.json":"protocol-sha256","skills/tdd/SKILL.md":"skill-md-sha256"}}],
  "deterministic_results": [{"fixture_id":"positive","status":"PASS","evidence_ref":"fixture-positive"}],
  "negative_case_results": [{"fixture_id":"authority-deny","status":"PASS","evidence_ref":"fixture-authority"}],
  "method_conformance": {"status":"PASS","evidence_refs":["method-proof"]},
  "governance_conformance": {"status":"PASS","evidence_refs":["admission-proof"]},
  "evidence_conformance": {"status":"PASS","evidence_refs":["integrity-proof"]},
  "context_conformance": {"status":"PASS","observation":{"supplied_path_refs":3,"supplied_evidence_refs":2,"supplied_chars":1800,"files_inspected":3,"tool_calls":4,"external_requests":0,"repair_attempts":0},"evidence_refs":["context-proof"]},
  "live_qualification": {"required":true,"status":"PASS","evidence_ref":"live-proof"},
  "execution_provenance_ref": {"run_id":"00000000-0000-4000-8000-000000000001","session_id":"session-example"},
  "status": "QUALIFIED",
  "observed_at": "2026-08-25T00:00:00Z"
}
```

| Field | Exact semantics |
| --- | --- |
| `schema_version`, `skill_id`, `skill_version`, `skill_fingerprint` | Literal version and exact protocol identity; filename must equal fingerprint. |
| `suite` | Immutable qualification suite ID and fixture-set fingerprint. |
| `evidence_refs` | Required complete retained M5 EvidenceRef v1 objects, unique by ID. Every evidence-reference field in this record must resolve here; dangling IDs are invalid. |
| `deterministic_results`, `negative_case_results` | Named fixture results with `PASS`/`FAIL` and `evidence_ref` resolved in `evidence_refs`. The negative list covers method, authority/capability, and evidence-integrity fixtures. |
| `method_conformance`, `governance_conformance`, `evidence_conformance`, `context_conformance` | Each has `PASS`/`FAIL` and non-empty retained evidence. Context also retains the required telemetry observation. |
| `live_qualification` | `required` boolean, with `NOT_REQUIRED`, `PASS`, or `FAIL`; `PASS`/`FAIL` require an ID resolved in `evidence_refs`. |
| `execution_provenance_ref` | Existing ledger/session reference or null; it does not replicate a ledger record. |
| `status`, `observed_at` | Validator-derived final `QUALIFIED` or `DISQUALIFIED`, and final observation time. |

`status` is a recorded, validator-derived conclusion, not a hand-maintained boolean: `QUALIFIED` requires every required deterministic and negative fixture plus method, governance, evidence, context, and required live result to pass; `DISQUALIFIED` records a completed failing suite or conformance failure. `observed_at` is the time the final deterministic observation was recorded, not a promise of continuing freshness. The record must retain its complete EvidenceRefs and any live execution reference needed to reconstruct its conclusion.

For a current valid protocol/source pair, state is derived as follows:

| State | Derivation |
| --- | --- |
| `DRAFT` | Source is incomplete or structural protocol/source validation fails. |
| `VALID` | Source validates and no QualificationRecord exists for this skill ID. |
| `QUALIFIED` | A structurally valid matching-fingerprint record has status `QUALIFIED` and all required conformance evidence passes. |
| `STALE` | Source validates, at least one historical record exists for the skill ID, and no matching-fingerprint final record exists. |
| `DISQUALIFIED` | A structurally valid matching-fingerprint record has status `DISQUALIFIED`, or its required retained evidence is invalid/missing. |

Thus a qualified fingerprint A followed by source fingerprint B is `STALE`; A never qualifies B. Qualification is not carried forward by skill ID, version, role, or human memory.

## Initial live qualification policy

Deterministic structural validation and fixtures may establish `M6_DETERMINISTIC_PROVEN`; they can make a source `VALID` but cannot make any initial production skill `QUALIFIED`. For the six initial Ocode-native skills—TDD, systematic debugging, codebase investigation, blast-radius analysis, architecture/change design, and adversarial review—`qualification_requirements.live_qualification` is literally `REQUIRED`. Their exact current fingerprint reaches `QUALIFIED` only after retained, bounded, governed live-qualification evidence passes and is resolved in its QualificationRecord. Full M6 production proof requires this evidence for all six. Future skills may use `OPTIONAL` only under a separately defined policy. Provider/model choice remains solely in existing execution profiles, never SkillProtocol.
