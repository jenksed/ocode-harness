# Polyglot validation admission

Ocode admits repository-defined validation only when all three conditions hold:

1. root-level repository configuration discovers an exact command;
2. the frozen validation registry is current; and
3. the executing role provides `test.execute`.

The runtime retains the pre-execution Git authority guard ahead of native Bash
permission matching. Validation admission never grants stage, commit, push,
repository-edit, arbitrary Bash, or destructive-command authority.

## Runtime availability

Discovery and availability are deliberately separate. `discovered_validation_registry`
records every exact command justified by root-level repository configuration.
At launch, Ocode resolves each command's executable from the original absolute
PATH entries before adding its validation wrapper. The effective
`validation_registry` contains only commands with a resolved executable;
`validation_availability.unavailable_commands` retains each omitted command,
its executable name, and `OCODE_VALIDATION_EXECUTABLE_UNAVAILABLE`.

Therefore a repository that declares both `npm test` and `cargo test` still
starts on a machine with only npm: npm receives exact native admission, Cargo
remains discovered but receives no validation `allow`, and no toolchain is
downloaded or substituted. If no registered executables are present, Ocode
starts without a validation wrapper and retains ordinary governed behavior.

## Registry

`ValidationRegistry` v2 is canonical JSON with a schema version, `project_root`
(`.`), sorted provider records, exact sorted commands, governing file paths and
SHA-256 fingerprints, and a SHA-256 fingerprint of those canonical fields.
Registry validation rejects unknown fields, invalid provider IDs, duplicate or
out-of-order values, commands not defined by a provider, governing files not
declared by a provider, and fingerprint mismatches. Discovery is runtime-owned;
model output cannot extend the registry.

Each governing-file change makes a previously projected registry stale. The
semantic admission decision then falls back to `ASK`; the generic executable
wrapper also exits before running an exact admitted command with
`OCODE_VALIDATION_REGISTRY_STALE`.

## Supported root-level providers

| Provider | Detection / governing files | Exact admitted commands | Deliberately not admitted |
| --- | --- | --- | --- |
| Node.js | `package.json` | `npm test` when `scripts.test` exists; `npm run` for repository scripts named `test`, `build`, `lint`, or `typecheck`, including colon variants | `npm install`, `npm publish`, arbitrary scripts, pnpm/yarn commands |
| Elixir | `mix.exs` | `mix test`, `mix compile` | `mix deps.get`, `mix hex.publish`, arbitrary Mix tasks |
| Python | `pytest.ini`, or pytest-specific configuration in `pyproject.toml`, `setup.cfg`, or `tox.ini` | `pytest`, `python -m pytest` | arbitrary Python, virtualenv paths, `pip install` |
| Go | `go.mod` | `go test`, `go test ./...`, `go build`, `go build ./...` | `go get`, `go install`, arbitrary Go commands |
| Rust | `Cargo.toml` | `cargo test`, `cargo build` | `cargo install`, `cargo publish`, arbitrary Cargo commands |

Node discovery intentionally retains the existing npm surface. It does not
infer a package-manager command from ambiguous lockfile or `packageManager`
evidence in this phase; pnpm and Yarn are therefore not validation-admitted.

## Execution boundary and provenance

The shared validation wrapper is installed ahead of PATH only after resolving
each registry command's executable from the original PATH. It dispatches to
that resolved absolute executable after freshness verification and restores the
original PATH for the child. A repository-local executable that merely shares a
tool basename cannot silently replace the executable selected for a projected
validation session.

The wrapper does not validate arbitrary tool invocations; native permission
projection provides `allow` only for exact current registry commands. Commands
outside that exact surface retain the existing native policy.

## Scope limits

Discovery is root-level only. A nested `services/api/mix.exs` is not yet
discovered, so this is not a monorepo build-system framework. Python admission
requires explicit pytest configuration rather than the presence of Python
files. Tool availability is still required at launch: if a registry-named
executable is absent from the original PATH, Ocode fails with
`OCODE_VALIDATION_EXECUTABLE_NOT_FOUND:<tool>` rather than widening PATH trust
or executing a local lookalike.
