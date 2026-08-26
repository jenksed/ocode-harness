# ocode-harness

Ocode is a repository-owned engineering harness for governed agent execution, evidence-backed validation, explicit authority boundaries, runtime/provider binding, Wayfinding, and governed engineering methods.

## Start here

For current program authority, current-state evidence, release identity, and authorized-next-work rules, read [`program/README.md`](program/README.md) first.

Canonical active planning state is machine-readable in [`program/roadmap.json`](program/roadmap.json). The root [`ROADMAP.md`](ROADMAP.md) is an explicit pointer to that authority; the prior M0–M10 roadmap is retained only as historical provenance.

Do not infer current implementation or release maturity from old milestone labels, this README, a version string, commit messages, or passing tests alone. The program evidence ledger distinguishes implemented, tested, integration-proven, dogfood-proven, release-qualified, and owner-promoted states.

## Current repository shape

The governed semantic role inventory is `agents/manifest.json`. It currently defines nine roles:

- orchestrator
- planner
- coder
- wayfinder
- researcher
- verifier
- reviewer
- judge
- committer

Capability is not authority. The canonical capability/permission/authority language is [`docs/architecture/governance-contracts.md`](docs/architecture/governance-contracts.md).

Provider/model policy is separate from semantic role identity and lives under `profiles/`. OpenCode integration and configuration ownership are described by [`docs/architecture/opencode-integration-contract.md`](docs/architecture/opencode-integration-contract.md).

The repository currently contains six governed production skill protocols under `skills/`:

- `tdd`
- `systematic-debugging`
- `codebase-investigation`
- `blast-radius-analysis`
- `architecture-change-design`
- `adversarial-review`

Their deterministic catalog exists, but live qualification, dogfood, release qualification, and promotion must be read from retained evidence rather than inferred from catalog existence. See [`program/evidence-ledger.json`](program/evidence-ledger.json).

## Main surfaces

- `packages/orientation/` — repository/project orientation
- `packages/harness-runtime/` — governance, admission, execution, evidence, lifecycle, deployment, Wayfinding, and skill runtime
- `agents/` — semantic role definitions and structured authority inventory
- `profiles/` — provider/model binding policy
- `skills/` — governed engineering method protocols and qualification evidence
- `installer/` — source bootstrap/install path
- `scripts/` — doctor, acceptance, qualification, and program validation commands
- `test/` — isolated/deterministic validation
- `program/` — current long-range program authority and release/planning state

## Operator commands

Normal runtime entry remains:

```bash
ocode
ocode --profile free
ocode --profile hybrid
```

Useful deterministic inspection surfaces include:

```bash
ocode profile
ocode profile explain reviewer
ocode profile diff free hybrid
ocode explain --run <run-id>
ocode govern explain <role>
ocode govern check coder --requires implementation.change,repository.edit --edit
ocode govern audit
```

## Validation

Run program-structure validation independently:

```bash
npm run program:validate
npm run test:program
```

Run the repository regression suite:

```bash
npm test
```

Milestone/provider acceptance commands are declared in `package.json`. A test command existing in the repository does not prove that it has passed for the current checkout or release candidate.

## Release/runtime warning

The baseline source version is `v0.1.0`, and current installer/update/rollback code provides staged installation and backup behavior. That does **not** establish an exact immutable stable release identity.

The canonical repository-known release state is [`program/releases/state.json`](program/releases/state.json). On this planning branch it deliberately records no managed `stable` or `candidate` because no release manifest currently binds an installed artifact to exact source commit, artifact digest, qualification evidence, and explicit owner promotion.

The first ACTIVE program milestone is release/runtime isolation. Its executable package is [`program/work-packages/R1-release-runtime-isolation.md`](program/work-packages/R1-release-runtime-isolation.md).

## Configuration and secrets

Machine-private provider credentials and authentication remain outside repository artifacts. Existing OpenCode configuration ownership rules remain in force; program planning does not authorize moving credentials into release artifacts or bypassing externally managed policy.

## Documentation note

Some older architecture/installation milestone documents remain useful historical or scoped architecture evidence but contain stale v0.1 descriptions. When documents conflict, use the authority ordering in `program/README.md`, inspect the current source/tests, and record unresolved contradictions rather than guessing.
