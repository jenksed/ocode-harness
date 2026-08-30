# Production Candidate Foundation Checkpoint

Status: `FOUNDATION_ACCEPTED`

Implementation baseline: `9e6ecb036f948ea10f4da1090da50376fbed326b`

Checkpoint record: this document is created after and does not change the
implementation baseline.

## Accepted scope

The foundation consists of three demonstrated capabilities:

1. installed-runtime closure: release artifacts contain and resolve Ocode-owned
   runtime resources without the source checkout;
2. qualified runtime identity: the installed runtime admits OpenCode 1.18.21,
   SDK 1.18.21, and the qualified executable identity as one contract;
3. command authority and validation admission: validation is fail-closed,
   observations are modeled canonically, coder consent is bounded, and
   closeout/transitive effects remain denied.

## Future-agent contract

Future work may rely on the following demonstrated facts at the implementation
baseline:

- the installed authority plugin and validation wrapper resolve from installed
  artifact bytes;
- compatibility metadata is mandatory and OpenCode executable identity is
  canonicalized, qualified, and reused;
- the command/effect model is shared by native projection and the
  pre-execution guard;
- exact validation membership and registry freshness are enforced before the
  real executable runs;
- qualified OpenCode 1.18.21 live evidence demonstrates routine observations,
  targeted `git diff -- <path>`, coder ASK, coder stage/commit/push DENY,
  restricted shell/interpreter DENY, and read-only-role mutation DENY.

## Known limitations

- `git config --get user.name` remains a known OpenCode 1.18.21 qualification
  lifecycle limitation: semantic ALLOW and deterministic fixture configuration
  are present, but no terminal tool event is emitted and the scenario times
  out. It is not represented as PASS.
- Repository-defined validation is trusted effectful execution.
- Validation subprocess/process-tree isolation is not established.
- Automated Git closeout is outside this candidate boundary.
- Automated self-update/rollback is not part of this foundation.
- General production readiness has not been established.

## Explicitly unclaimed properties

This checkpoint does not claim safe execution of untrusted repositories,
validation confinement, exact-byte automated review-to-commit binding,
hardened automated stage/commit/push, transactional self-update/rollback,
crash or power-loss recovery, external artifact authenticity/signing, broad
Linux/Windows support, complete project-local OpenCode compatibility, clean
externalized runtime state, installed canonical skill integration, or a final
production release gate.

## Planning frontier

The next planning session should organize, without presupposing order, these
domains:

- daily-driver runtime integration (state, cleanliness, project config/MCP/
  plugin/formatter preservation, installed skills);
- CLI and supportability (argument contract, doctor, diagnostics);
- explicit capability gating for unsafe closeout and self-update/rollback;
- an artifact-centered installed-runtime production gate;
- stronger authority and trust boundaries (validation isolation, secrets,
  untrusted repositories, Git helper isolation, exact-byte binding);
- release lifecycle and recovery (transactions, serialization, crash/disk-full,
  migration);
- runtime compatibility evolution (multiple qualified versions and policy);
- distribution and broader support (signing, remote distribution, limits,
  platforms, topology, concurrency).

Dependencies begin from this accepted foundation. Sequencing, release scope,
parallelism, stop conditions, and human authority decisions remain for the
next planning session.

## Handoff

Accepted: installed closure, exact qualified runtime identity, and coherent
command authority/validation admission.

Known but unresolved: the `git config --get user.name` live lifecycle case and
the limitations listed above.

Future work must not infer any explicitly unclaimed property from this
checkpoint. Recommended next action: **plan the next production-candidate
tranche from the accepted foundation**.
