# Daily Driver Integrity DD1 — External Runtime State

Status: `DD1_ACCEPTED`

Accepted implementation: `cd8593b00454095f368235c96919a686d48fa371`.

Base: `ab7bc3f94fefd2d51bcb33d5f257ba8ec682e310`; both that base and the
Production Candidate Foundation checkpoint
`b720af0ad592f15ad15d541192fe6a7ad16802f1` are ancestors of the accepted
implementation.

## Contract

Ocode-owned mutable runtime state is rooted at:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/ocode
```

The locator canonicalizes the physical Git worktree root and derives a
domain-separated SHA-256 identity from that path. It is therefore stable as
HEAD and branch change, while separate worktrees receive separate state.
For a non-Git project, the physical requested project directory is the
identity boundary.

The following state now uses that one locator:

- orientation JSON and Markdown;
- Activity event storage and the `ocode activity` / `ocode agents` readers;
- governed execution ledger and `ocode explain --run` / harness ledger readers;
- verification's persisted-orientation lookup.

Project `.opencode` is not an Ocode runtime-state destination and cannot
redirect these writes. Existing project-owned `.opencode` contents are not
deleted, rewritten, or treated as the state authority.

## Acceptance evidence

The acceptance review ran against the committed implementation:

```text
npm run test:runtime-state                 DD1_RUNTIME_STATE_PROVEN
npm run test:runtime-closure               INSTALLED_RUNTIME_CLOSURE_PROVEN
npm run test:runtime-identity              PASS
npm run test:command-authority             PASS
npm run test:installed-command-authority   INSTALLED_COMMAND_AUTHORITY_PROVEN
npm run test:govern                        reader consistency PASS
npm test                                   PASS
```

`test:runtime-state` proves clean-fixture before/after Git equality, absence
of target runtime artifacts, XDG-rooted orientation/activity/ledger state,
HEAD-stable identity, worktree separation, project `.opencode` symlink
isolation, and installed-artifact normal startup using isolated state and
install roots. `test:runtime-closure` removes the build source before running
the installed entrypoint and verifies external orientation and activity state.

## Boundaries and non-claims

DD1 does not implement project-local OpenCode composition, skills projection,
CLI redesign, doctor redesign, update/rollback work, concurrency/locking,
state migration, validation sandboxing, multi-version runtime support, or a
new live-permission qualification. The existing live qualification remains
applicable: DD1 did not change permission projection, validation admission, or
qualified executable identity; it changes only state destinations after those
authorities are established.

Legacy installer Git-exclude entries remain compatibility configuration; they
are not relied on for this state-boundary property.
