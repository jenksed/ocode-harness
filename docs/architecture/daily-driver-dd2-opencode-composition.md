# Daily Driver Integrity DD2 — Governed OpenCode Composition

## Contract

DD2 uses one runtime-owned, temporary `OPENCODE_CONFIG_DIR`. It contains copied
Ocode canonical agents and the existing deterministic projection of the
admitted canonical skills. It is removed when the launch completes. Ocode never
writes its generated agents, skills, or configuration into the project.

OpenCode 1.18.21 was directly probed with this directory and a project fixture:
it loads `OPENCODE_CONFIG_DIR` agents and skills alongside the project's
`.opencode` agents and skills, while retaining project `opencode.json` MCP
configuration. Project configuration is therefore enabled; DD2 does not set
`OPENCODE_DISABLE_PROJECT_CONFIG`.

Ocode-owned authority is: governed role identities from `agents/manifest.json`,
their canonical semantic Markdown, profile model bindings, runtime permission
projection (including ordered Bash rules), the pre-execution guard, role-mode
adaptation for bounded execution, and the admitted skill projection.

## Project and global ownership

The supported project-local categories are `opencode.json` / `opencode.jsonc`
(including MCP), `.opencode/agent(s)`, `.opencode/skill(s)`, and local paths
declared by `skills.paths`. Their original files are read in place, so relative
paths preserve project-relative meaning. The focused fixture proves an MCP
entry, an unrelated project agent, a default-path project skill, and a
project-relative configured skill path.

The existing user/global behavior is retained: the user's global OpenCode
configuration files remain copied into the temporary config root. DD2 does not
expand that prior behavior to import user-owned agents or skills.

Project plugins, commands, formatters, and other ordinary project config are
not newly claimed as DD2-supported categories, although DD2 leaves them for
OpenCode to process. Plugin/MCP confinement is intentionally not a DD2 claim.

## Collision policy

Before an OpenCode launch, DD2 scans documented project agent and skill paths,
inline `agent` keys, and local `skills.paths`. A project definition matching a
governed agent ID deterministically fails with
`OCODE_PROJECT_AGENT_COLLISION`; a project skill matching an admitted canonical
skill deterministically fails with `OCODE_PROJECT_SKILL_COLLISION`. Both occur
before model execution. Non-reserved project agents and skills remain
project-owned and receive no Ocode authority.

The admitted skill set is centralized in
`harness-runtime/lib/admitted-skills.mjs`: the existing six-item M6.5 production
catalog. This is an explicit DD2 projection boundary, not a directory scan or
a new semantic qualification.

## Limits

The direct observation is limited to the qualified Darwin arm64 OpenCode
1.18.21 runtime and the seams covered by `test:opencode-composition`. DD2 does
not claim arbitrary JSONC recovery, remote `skills.urls`, project plugin/MCP
confinement, untrusted-project safety, or compatibility with project config
files that OpenCode itself elects to migrate. The clean fixture supplies the
standard `$schema` field so OpenCode does not add it on startup.
