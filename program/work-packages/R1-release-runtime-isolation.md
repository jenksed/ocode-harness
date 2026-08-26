# R1 Work Package — Immutable Release Selection and Runtime Isolation

Roadmap node: `MS-R1`  
Horizon: ACTIVE  
Lifecycle: `decomposition_ready`  
Implementation authority: **not granted by this document**. Owner or explicitly delegated authority must move the node to `authorized`.

## Objective

Make `ocode` safe to use for real projects while Ocode itself is under active development. The normal command must resolve an immutable, exact, qualified stable release. Candidate and dev runtimes must be explicit and must not change stable implicitly.

## Current evidence

- `deploy.mjs` stages from a mutable discovered source checkout, copies files into a staging directory, and writes `VERSION`.
- `installer/install.mjs` and `harness update` validate that staged copy and then immediately replace `~/.local/share/ocode-harness`.
- Current candidate state is ephemeral; there is no durable candidate release manifest or selector.
- Current release identity is a version string, not `(release ID, source commit, artifact digest)`.
- Current rollback restores the latest timestamped backup and consumes that backup.
- Existing update/rollback/version tests are useful regression surfaces but do not establish the required release authority model.

Evidence ledger: `EVID-001`, `EVID-007`, `EVID-008`, `EVID-009`.

## Authoritative inputs

- `program/README.md`
- `program/roadmap.json` node `MS-R1`
- `program/releases/state.json`
- `program/schemas/release-manifest.schema.json`
- `docs/architecture/governance-contracts.md`
- existing installer/deploy/version/update/rollback behavior and tests

## Scope

Implement the smallest project-owned release registry and selector mechanism that can represent immutable releases and stable/candidate/dev selection.

Likely repository surfaces:

- `packages/harness-runtime/lib/deploy.mjs`
- `packages/harness-runtime/bin/harness.mjs`
- `packages/harness-runtime/bin/ocode.mjs`
- `installer/install.mjs`
- `bin/ocode` if still part of the supported source bootstrap
- release-manifest/selector helpers in `packages/harness-runtime/lib/`
- isolated install/update/rollback/version tests
- operator installation/release documentation

Prefer project-owned CLI commands and small filesystem primitives over a new service.

## Non-goals

- M6 skill behavior changes;
- M7 Planner Compiler or TaskSpec implementation;
- provider/model routing redesign;
- OpenCode authentication changes;
- generic package-manager functionality;
- automatic cloud distribution;
- Git-history rollback;
- automatic stable promotion.

## Required properties

1. `ocode` resolves stable by default.
2. Stable is an immutable artifact directory with a valid release manifest and verified digest.
3. Candidate is an immutable artifact directory with the same exact identity requirements and is invoked only by an explicit selector.
4. Dev is explicitly selected mutable source/worktree state.
5. Stable, candidate, and dev can coexist.
6. Materialization records exact source commit and artifact digest.
7. Qualification targets an exact candidate identity.
8. Promotion changes a selector to an already-existing qualified candidate; it does not rerun materialization/build.
9. Promotion requires explicit release authority input and records promotion evidence.
10. Prior stable remains retained and addressable.
11. Rollback changes the stable selector to a retained prior qualified release and preserves failed-release evidence.
12. A failed candidate does not require rollback because stable was never changed.
13. Worktrees can materialize candidates but cannot redefine stable.
14. Existing user-owned machine configuration/authentication remains outside immutable release artifacts and is not overwritten beyond established owned merge surfaces.

## Authority boundaries

- Coder/implementation runtime may materialize a candidate only when authorized for this work package.
- Tests, doctor, verifier, reviewer, qualification engine, and candidate creation cannot promote stable.
- Release promotion defaults to owner authority (`OD-001`).
- Dev invocation does not grant mutation authority beyond existing M4 admission.
- Git branch/worktree identity is provenance only; it is not runtime authority.

## Dependencies

Hard prerequisites: none beyond the already-implemented install/deploy surfaces and architecture contracts.

Shared contracts that must remain stable during this package:

- governance capability/authority semantics;
- OpenCode provider/model ownership boundaries;
- semantic agent manifest authority;
- machine-private config/auth ownership.

This package is **serialized** because it mutates the authority-bearing deploy/launcher/version surfaces.

## Proposed smallest mechanism

Use a filesystem release store owned by Ocode, for example:

```text
~/.local/share/ocode-harness/
  releases/<release-id>/
    manifest.json
    artifact/...
  selectors/
    stable
    candidate
```

The exact path/name is an implementation choice; the required property is immutable release directories plus atomic selectors. A selector contains a release ID, not a source path.

Dev should be an explicit CLI mode that executes a specified source checkout/worktree without touching selectors.

Materialization should:

1. require a cleanly resolvable exact Git commit for source identity;
2. copy/build the runtime once into a new release directory;
3. compute an artifact digest over a deterministic manifest of release-owned files;
4. write the release manifest;
5. make the release directory immutable by convention/enforcement appropriate to the platform;
6. never modify an existing release ID in place.

Do not add a database or daemon unless filesystem selectors prove insufficient.

## Implementation sequence

1. Add release-manifest validation and deterministic artifact-digest calculation.
2. Add immutable release-store materialization from exact source commit.
3. Add selector read/write primitives with atomic replacement and digest verification.
4. Make default `ocode` resolve only the stable selector.
5. Add explicit candidate selection (`ocode --release candidate` or repository-conventional equivalent).
6. Add explicit dev selection that points to a caller-supplied/current source checkout without touching stable/candidate.
7. Change install/update semantics so creating/qualifying a candidate does not promote it.
8. Add explicit promotion command that requires the candidate ID, re-verifies digest/qualification references, records promotion evidence, and atomically moves stable selector.
9. Change rollback to select retained prior stable release and retain all manifests/evidence.
10. Update version/status output to show release ID, release state, source commit, digest, and selector targets.
11. Preserve compatibility wrapper(s) where cheap, but fail closed rather than silently falling back to mutable source.
12. Run isolated tests and real-project dogfood before requesting promotion.

## Compatibility constraints

- Existing `ocode` command remains the normal operator entry point and must become stable-default.
- Existing machine config and OpenCode credential ownership remain external to release artifacts.
- Existing `harness version/update/rollback` users need either compatible semantics or explicit migration messaging.
- The first managed release may coexist with a legacy unmanaged installation; do not label the latter stable without exact evidence.
- No existing backup should be deleted merely because a new release registry exists.

## Failure modes to test

- stable selector missing;
- stable selector references missing release;
- manifest malformed;
- source commit unavailable during materialization;
- artifact digest mismatch before launch;
- materialization interrupted mid-copy;
- duplicate release ID;
- candidate qualification fails;
- candidate digest changes after qualification;
- promotion interrupted before/after selector swap;
- stable promotion requested without authority evidence;
- rollback target missing or incompatible;
- dev worktree deleted while dev run starts;
- candidate generated from one worktree while another changes;
- user config merge fails after selector change.

Fail closed. Never route default `ocode` to dev as recovery.

## Migration concerns

The repository knows `v0.1.0` as a source version but cannot prove the exact current installed artifact. Therefore:

- treat existing installation as legacy/unmanaged;
- optionally support forensic import only if exact artifact/source/qualification can be reconstructed;
- otherwise create a fresh first managed candidate from an exact commit;
- require owner promotion before it becomes first managed stable;
- retain the legacy installation/backup until the managed stable has passed dogfood and rollback proof.

## Rollback behavior

Rollback is selector movement, not copying arbitrary newest backups and not reverting Git history.

Required behavior:

1. verify the prior stable manifest and digest;
2. atomically set stable selector to that retained release;
3. update launchers only if selector-based launchers require it;
4. preserve the failed release/candidate and promotion/failure evidence;
5. record rollback actor/authority, from/to release IDs, reason, and evidence;
6. do not delete the release that was rolled back from.

## Test strategy

Deterministic isolated-HOME tests:

- manifest schema validation;
- digest stability and tamper detection;
- immutable release materialization;
- stable/candidate/dev coexistence;
- default stable selection;
- explicit candidate/dev selection;
- interrupted materialization cleanup;
- candidate failure leaves stable unchanged;
- promotion does not invoke materialization/build;
- promotion rejects changed candidate digest;
- rollback selects exact prior stable;
- rollback retains failed release evidence;
- version/status reports exact identities;
- existing machine config/auth ownership remains intact.

Regression commands:

```bash
npm run program:validate
node test/test-harness-version.mjs
node test/test-harness-update.mjs
node test/test-harness-rollback.mjs
node test/test-installer.mjs
npm test
```

Add focused tests rather than weakening existing ones to fit the new model.

## Real-project dogfood scenario

Use an unrelated real repository, not `ocode-harness`.

1. Start from current managed stable with the unrelated project clean.
2. Materialize a candidate from the authorized Ocode source commit.
3. Verify default `ocode` still reports/uses stable.
4. Explicitly invoke candidate against the unrelated repository for one read-only governed task and one bounded mutation task appropriate to existing authority.
5. Record candidate release ID/source/digest in run evidence.
6. Verify stable selector and stable bytes did not change.
7. Independently review the candidate run evidence.
8. If qualification and dogfood pass, request owner promotion.
9. Promote exact candidate without rebuilding.
10. Run a smoke task through new stable.
11. Exercise rollback to prior stable and confirm both release artifacts/evidence remain inspectable.

## Acceptance properties

The package is accepted only when evidence demonstrates every Required Property above. Tests are necessary but not sufficient. At minimum acceptance must include:

- exact candidate release manifest;
- exact artifact digest;
- isolated selector tests;
- proof that promotion did not rebuild;
- proof failed candidate leaves stable unchanged;
- proof rollback preserves failed-release evidence;
- unrelated real-project dogfood;
- independent review;
- explicit acceptance decision.

Release promotion is a separate decision after milestone acceptance.

## Required evidence

Completion report must cite:

- starting/final Git SHA and branch;
- changed paths;
- release manifest(s);
- source commit and artifact digest;
- qualification evidence refs;
- exact validation commands, exit codes, and failures;
- dogfood repository/scenario without secrets;
- stable selector before/after candidate evaluation, promotion, and rollback;
- independent reviewer findings;
- remaining unsupported compatibility;
- unresolved decisions;
- explicit statement of what remains unproven.

## Stop conditions

Stop and report rather than widening scope if:

- a required property needs a change to M4 constitutional authority;
- current machine config/auth ownership would need to move into release artifacts;
- implementation requires changing M6/M7 semantics;
- immutable selector semantics cannot be achieved without a daemon/database/general package manager;
- source cannot be bound to an exact commit;
- candidate bytes cannot be deterministically digested;
- owner/release authority for promotion is unavailable;
- full regression reveals an unrelated pre-existing failure that cannot be safely separated.

## Completion report contract

Return:

- STATUS
- STARTING SHA / FINAL SHA / BRANCH
- IMPLEMENTED MECHANISM
- RELEASE IDENTITIES CREATED
- AUTHORITY BOUNDARIES PRESERVED
- FILES CHANGED
- VALIDATION EXECUTED with exit codes
- DOGFOOD EVIDENCE
- INDEPENDENT REVIEW
- PROVEN PROPERTIES
- UNPROVEN PROPERTIES
- COMPATIBILITY / MIGRATION NOTES
- OWNER DECISION REQUIRED
- PROMOTION REQUEST, if and only if a qualified exact candidate exists

Do not claim stable promotion unless the owner actually performs or explicitly authorizes that transition.
