# M6 entry contract

M6 may trust M0–M5: manifest roles, M4 admission/permission/subject reconciliation and provenance, and M5 WayfindingRequest, UncertaintyMap, readiness, EvidenceRef freshness, routes, bounded WayfindingResult, and Wayfinder runtime validation.

M6 must not redesign governance, capability matching, permission projection, freshness, Wayfinder, subject reconciliation, ledger, provider routing, or Planner. SkillProtocol requirements must map to M4 AdmissionRequest and reuse EvidenceRef/freshness/provenance.

M6 designs—not implements here—SkillProtocol, QualificationRecord, ContextCapsule, and EvidenceCapsule. Priorities: TDD, systematic debugging, codebase investigation, blast-radius analysis, architecture/change design, adversarial review. Capsules must carry minimum objective, constraints, files/references, method, evidence, and acceptance expectations—not transcripts/history.

Begin by verifying final M5 HEAD/origin parity and clean state. Reuse M0–M5 proof; do not rerun acceptance:m5 to reconstruct it. Reuse the project-local OpenCode skill seam and prove only the M6 delta with qualification fixtures.
