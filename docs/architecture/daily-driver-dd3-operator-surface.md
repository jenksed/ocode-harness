# Daily Driver Integrity DD3 — Truthful Operator Surface & Chat UX

Status: `DD3_ACCEPTED`

DD2 base: `dc2f1cf86ea7733ea3cb07e053eaa2028a0c461e`.

Accepted DD3 implementation: `987bb94c230b67a0675ef0953b01cd0014811016`.
Agent A source implementation was independently proven at
`da45a0816a7aec47158ce5b4004d78010cbeff37`; the integrated tip is a clean
cherry-pick of that commit. Agent B made no source changes.

## Accepted contract

The interactive Ocode entry point classifies every operator argument before
orientation, runtime qualification, server startup, or attach. The explicit
qualified subset is forwarded or translated deterministically. Project
positionals are translated to Ocode-owned project context. Unknown options,
Ocode-owned or unsupported launch options, malformed valued options, missing
values, and unexpected positionals fail with an explicit nonzero
`OCODE_ARGUMENT_UNSUPPORTED` result. `attachArguments()` is mechanical and is
not a second policy source; no operator intent is silently discarded.

`ocode doctor` is an installed-runtime command. It observes the installed
release and payload identity, qualified OpenCode executable and SDK identity,
Node/platform/architecture, DD1 external runtime state, DD2 governed
composition resources, admitted canonical skills, guard and validation
resources, project composition, and the one candidate capability registry.
Doctor uses deterministic `PASS`, `WARN`, `FAIL`, and `UNSUPPORTED` results;
only required failures produce a nonzero exit. Ambient `which opencode` and
source-checkout availability are not authority.

The candidate capability registry is shared by doctor and launcher gating. Safe
Git inspection is `SUPPORTED`; bounded workspace mutation is `ASK`; Git stage,
commit, push, self-update, rollback, and automated Git closeout are
`UNSUPPORTED`; qualified project composition and canonical Ocode skills are
supported. `ocode update` and `ocode rollback` fail before release, pointer,
configuration, or project mutation. Human Git closeout remains authoritative.

## Installed-artifact evidence

The integrated bytes were built and installed through the repository-native
artifact and release-store tooling:

```text
source commit:          987bb94c230b67a0675ef0953b01cd0014811016
archive:                /private/tmp/ocode-dd3-artifact.t1xi0F/ocode-0.1.0+987bb94.tar.gz
archive SHA-256:        499864435597ab85e2a1dd3accce483bba9fa40caec10d0b6775bdac9b57ad90
payload manifest SHA:   f858d30afd5644355bf4b36f42b217fa9f1dd740258347fc8ec4eab65243e70b
installed release ID:   0.1.0+987bb94c230b-f858d30afd564435
installed path:         /private/tmp/ocode-dd3-installed-store/releases/0.1.0+987bb94c230b-f858d30afd564435/payload
```

From those installed bytes, `ocode doctor` passed with OpenCode `1.18.21`,
SDK `@opencode-ai/sdk@1.18.21`, isolated DD1 state, DD2 resources, and an
empty disposable trusted project. Installed `update` and `rollback` returned
`OCODE_CAPABILITY_UNAVAILABLE` with nonzero exits; the installed store hash was
unchanged and the disposable project remained clean. The focused
operator-surface test also removes its source checkout before invoking the
installed doctor and gate checks. The installed runtime-state regression proves
basic `ocode .` startup and external state persistence without target-repository
pollution.

## Regression evidence

The following passed on the integrated implementation:

```text
npm run test:operator-surface
npm run test:governed-authority-guard
npm run test:opencode-composition
npm run test:installed-opencode-skill-discovery
npm run test:runtime-state
npm run test:runtime-closure
npm run test:runtime-identity
npm run test:command-authority
npm run test:installed-command-authority
npm run test:opencode-live-permissions
npm test
```

`runtime-closure` required a permission-enabled rerun because the sandbox
blocked a loopback bind; the rerun passed. This is an execution-environment
limitation, not a product failure.

## Chat presentation boundary

`DD3_CHAT_PRESENTATION_SEAM_UNAVAILABLE` is an accepted platform limitation.
OpenCode `1.18.21` retains attached-TUI rendering ownership and exposes no
qualified Ocode-controlled per-message presentation seam. Ocode therefore does
not independently style `<thinking>`, tool activity, errors, or final assistant
output in this candidate. Terminal interception, PTY parsing, rendered-text
scraping, prompt simulation, and TUI replacement were deliberately rejected.
This is deferred to a future phase pending a supported structured message
presentation hook; it is not a hidden DD3 implementation TODO.

## Limits and next frontier

Fresh archive SHA-256 values can vary between builds while the payload manifest
remains the stable payload identity. DD3 does not claim archive-byte
reproducibility, production release qualification, multi-platform support,
transactional update/rollback, automated Git closeout, untrusted-repository
confinement, plugin/MCP sandboxing, runtime-state locking, or DD4 behavior.

The next frontier is future planning for release qualification and any upstream
OpenCode presentation seam. This checkpoint is ready for trusted development
repository manual dogfood only.
