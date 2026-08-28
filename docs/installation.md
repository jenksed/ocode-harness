# Installation and runtime maintenance

## Prerequisites

The currently qualified runtime contract expects:

```bash
node --version
opencode --version
git --version
```

Use Node.js 18+ and OpenCode `1.18.21`. The repository pins `@opencode-ai/sdk` to the same OpenCode generation.

## Install from a checkout

```bash
git clone https://github.com/jenksed/ocode-harness.git
cd ocode-harness
npm ci
npm test
npm run bootstrap
```

`npm run bootstrap` deliberately fails before promotion when runtime dependencies are missing. It does not create a partially healthy installation and ask the operator to discover the missing SDK later.

The installer stages a candidate and promotes it into:

```text
~/.local/share/ocode-harness
```

It also installs launchers under:

```text
~/.local/bin
```

and managed OpenCode agents under:

```text
~/.config/opencode/agents
```

The source checkout and the installed runtime are separate authorities. Editing the checkout does not alter the installed runtime.

## Product version and source identity

`VERSION` is Ocode's sole semantic product-version authority. It is UTF-8 text
containing one bare SemVer value, with no `v` prefix or surrounding whitespace
and with at most one final newline. Root `package.json`,
`packages/harness-runtime/package.json`, and the root metadata in
`package-lock.json` are product-version mirrors; the private orientation package
does not participate in the Ocode product version.

Change `VERSION`, then run:

```bash
npm run version:sync
npm run version:check
```

The check fails on mirror drift and sync changes only those mirror fields.
Source-side release identity reads `VERSION` directly, validates it, and pairs
it with Git provenance. A clean Git source identity is exactly its canonical
semantic version and full commit SHA; `source_ref` is diagnostic provenance and
does not affect identity equality. A dirty checkout and a non-Git source are not
exact source identities. `RELEASE.json` remains self-contained when installed:
it validates its embedded schema and metadata without locating a checkout,
`VERSION`, Git, or a branch. It proves semantic version plus source provenance,
not dependency closure, artifact bytes, or installed-artifact integrity; those
remain Phase 2 concerns.

## Closed release artifact

Build, without installing or promoting anything:

```bash
npm run release:build
npm run release:verify -- dist/ocode-<version>+<short-sha>.tar.gz
```

Phase 2 creates a dependency-closed `tar.gz`, a detached SHA-256 checksum, and
an embedded `ARTIFACT.json`. `RELEASE.json` remains source provenance; the
artifact manifest enumerates the payload and deliberately excludes itself to
avoid a self-referential digest. Phase 3, not this phase, must make
installation/update consume an already-built artifact atomically.

The archive permits only directories and regular files: dependency links are
dereferenced during assembly and generated `node_modules/.bin` shims are not
shipped. Verification inspects archive headers before materializing anything,
then reconstructs the payload through the same no-links policy. The build
requires an empty output directory, validates the Phase-1 version mirrors
itself, and carries the lockfile as build-input metadata so its declared hash
is independently verifiable.

## Verify the installed release

```bash
ocode version
```

For machine-readable output:

```bash
ocode version --json
```

A promotion carries `RELEASE.json` containing the semantic version plus full source commit SHA, source ref when available, and source dirty state. `ocode version` shows both installed and checkout identity.

A clean Git checkout has exact identity. A dirty Git checkout cannot be promoted because the recorded commit would not identify the bytes being installed. Non-Git sources remain usable for legacy/test fixtures but are reported as non-exact.

## Start Ocode

```bash
cd /path/to/project
ocode .
```

Optional one-run profile selection:

```bash
ocode --profile free .
ocode --profile hybrid .
```

The override does not persist.

## Inspect configuration and governance

```bash
ocode profile
ocode profile explain reviewer
ocode profile diff free hybrid
ocode govern explain coder
ocode govern audit
ocode agents
ocode activity
```

Machine-level Ocode configuration lives at:

```text
~/.config/ocode/config.json
```

Typical configuration:

```json
{
  "profile": "hybrid",
  "freellmapi": {
    "base_url": "http://127.0.0.1:3001/v1"
  },
  "closeout": {
    "push": false
  }
}
```

Secrets are not written there. Provider credentials remain in the appropriate environment/OpenCode credential store.

## Health and validation

From the repository checkout:

```bash
npm run doctor
npm test
```

`npm test` is the current broad deterministic validation surface. Milestone-named `acceptance:*` commands are retained for historical/regression investigation rather than normal operation.

## Promote an updated checkout

Develop and test in the source checkout, then commit the intended source state. Promotion from a dirty Git checkout is refused.

```bash
npm test
ocode version
ocode update
ocode version
```

`ocode update` compares semantic version and exact source SHA. A different commit is promotable even when `VERSION` is unchanged.

The update flow is:

```text
source checkout
  -> inspect clean source identity
  -> stage candidate
  -> write release identity
  -> validate candidate
  -> backup installed release
  -> promote
  -> refresh launchers/agents/config
  -> post-promotion validation
```

Failure before the promotion step leaves the installed runtime untouched. Failure after promotion attempts rollback from the newly created backup.

## Roll back

```bash
ocode rollback
ocode version
```

Rollback restores the newest installation backup and consumes that backup so another rollback can move to the previous one.

A backup created before release-identity support may restore successfully without a source SHA. `ocode version` reports that state as legacy/non-exact rather than pretending to know its commit.

## Launcher surface

`ocode` is the normal operator entrypoint. The installed launcher routes these maintenance commands to the existing deterministic maintenance runtime:

```text
ocode version
ocode update
ocode rollback
```

Other `ocode` commands go to the interactive Ocode runtime.

The `harness` launcher remains for internal/compatibility commands such as deterministic ledger, lifecycle, evidence, closeout, and verify operations. Normal operators should not need it for installation maintenance.

## Troubleshooting

If bootstrap reports missing runtime dependencies:

```bash
npm ci
npm run bootstrap
```

If OpenCode is missing or has the wrong version:

```bash
which opencode
opencode --version
```

If the installed launcher is not found:

```bash
ls -l ~/.local/bin/ocode
echo "$PATH"
```

If promotion is refused because the source is dirty:

```bash
git status --short
git diff
git diff --staged
```

Commit, stash, or discard the intended changes before promotion. Do not bypass the check merely to make the SHA look clean.

If runtime behavior or configuration is unclear:

```bash
npm run doctor
ocode profile
ocode govern audit
ocode version
```
