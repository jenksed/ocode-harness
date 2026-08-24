# OpenCode integration contract

## TESTED RUNTIME

- **OBSERVED:** OpenCode 1.18.21 on Darwin arm64.
- **OBSERVED:** `opencode models freellmapi` exposed routed `auto:*` models and `opencode models openai` exposed OpenAI models.
- **OBSERVED:** M2 acceptance used `freellmapi/auto:smart` and the discovered `openai/gpt-5.4-mini`; model selection is rediscovered on each acceptance run.

## PRODUCTION EXECUTION SEAM

Ocode will launch the public CLI with an explicit semantic agent and JSON output:

```text
OPENCODE_CONFIG_CONTENT=<Ocode-owned overlay>
opencode run --agent <semantic-role> --format json <bounded prompt>
```

The JSON stream yields a session ID and bounded execution/result events. Ocode can join that ID to `opencode export <session-id> --sanitize` when it needs the effective agent/provider/model record. `--pure` is used by M2 acceptance to prove no external plugin is required; it is not yet mandated for every production run.

## AGENT RESOLUTION

- **OBSERVED:** An explicit `--agent ocode-m2-diagnostic` resolved a project-local `.opencode/agents/ocode-m2-diagnostic.md` fixture.
- **OBSERVED:** Source and staged/executed fixture SHA-256 fingerprints matched.
- Canonical semantic instructions, permissions, authority, and output contracts remain agent-owned. Provider/model binding is external policy.

## PROVIDER/MODEL BINDING

**DESIGN C — RUNTIME CONFIG OVERLAY** is the sole selected production mechanism.

Ocode binding profiles contain only `semantic-role -> provider/model`. The deterministic builder emits:

```json
{
  "agent": {
    "planner": {
      "model": "provider/model"
    }
  }
}
```

- **OBSERVED:** The same model-neutral diagnostic contract returned `OCODE_M2_DIAGNOSTIC_OK` through FreeLLMAPI and OpenAI.
- **OBSERVED:** An inline OpenAI binding overrode an equivalent diagnostic Markdown agent whose frontmatter declared `model: freellmapi/auto:smart`; `acceptance:m2` retains and replays this fixture.
- Ocode does not select FreeLLMAPI's underlying provider, proxy OpenAI, or own either provider's credentials.

## CONFIGURATION PRECEDENCE USED BY OCODE

- **OBSERVED:** The inline `agent.<role>.model` value won over project-local Markdown agent `model:`.
- **UPSTREAM-DOCUMENTED:** `OPENCODE_CONFIG_CONTENT` loads after normal global, custom-path, project, and `.opencode` configuration.
- **UPSTREAM-DOCUMENTED:** managed configuration and macOS managed preferences can still override inline configuration.
- **INFERRED POLICY:** A later managed conflict must be reported as a binding mismatch by comparing the requested binding with sanitized session evidence. Managed policy is authoritative; Ocode must not attempt to bypass it.

No broader precedence matrix is part of this contract.

## CONFIGURATION OWNERSHIP/ISOLATION

- The runtime overlay contains only Ocode-owned `agent.<role>.model` entries.
- **OBSERVED:** M2 acceptance hashes `config.json`, `opencode.json`, and `opencode.jsonc` before and after real runs; all hashes remained unchanged.
- Stable FreeLLMAPI provider definitions remain in `opencode-config/opencode.json` and use the existing ownership-aware persistent merge.
- Authentication remains in OpenCode's credential store. M2 never reads, copies, exports, or clones credentials.

## OBSERVABILITY AVAILABLE

**OBSERVED raw JSON stream:** session ID, step start/finish, text result, token/cost fields, and a machine-readable error event.

**OBSERVED sanitized session export:** OpenCode version, session ID, selected agent, requested provider/model, finish state, token summary, and file-change summary.

The raw stream alone does not identify the agent/provider/model. The supported session export completes that evidence join. Exact parent/child delegation and tool-event schemas remain **UNPROVEN** and are not required for M2's no-tool diagnostic.

## CUSTOM TOOL DIAGNOSTICS

`harness_probe` is **DEFERRED**. No implementation exists, and the selected public seam supplies every production property required to begin M3.

## PLUGIN REQUIREMENT

**DEFERRED / NOT REQUIRED FOR M2.** Both provider runs passed with external plugins disabled. A future milestone may justify a minimal observer only after naming a required field absent from CLI/event/export surfaces.

## PERMISSIONS RELIED ON

- Canonical agents continue to use their existing OpenCode frontmatter permissions.
- The M2 diagnostic uses `permission: { "*": "deny" }`, calls no tools, changes no files, and has no Git mutation authority.
- M2 does not claim a complete permission catalog. Capability/permission/authority enforcement remains M4.

## MINIMUM SKILL DISCOVERY CONTRACT

- **OBSERVED:** OpenCode 1.18.21 scanned a temporary project-local `.opencode/skills/<name>/SKILL.md` and reported its name/location in debug logs.
- Both singular and plural compatibility paths were recognized in the temporary experiment; defining the same skill in both produced a duplicate-name warning.
- Ocode will use the documented plural project-private path `.opencode/skills/` when M6 begins. No skill framework or manifest is part of M2.

## FAILURE VISIBILITY

Binding the diagnostic agent to `ocode-m2-missing/no-model` produced exit code 1 and a JSON `error` event with a session ID. OpenCode 1.18.21 labels this public error `UnknownError` with a bounded message; the requested provider/model remains known from the deterministic overlay and is recorded in the session when exportable.

This maps to an Ocode execution/infrastructure failure. Provider recovery and fallback are deferred.

## KNOWN-GOOD VERSION POLICY

OpenCode 1.18.21 is known-good. Doctor warns, rather than fails solely, on another version and directs the operator to `npm run acceptance:m2`. Acceptance records whether the version matches 1.18.21 but still runs the bounded compatibility smoke; a different patch version becomes supported only after that smoke passes.

## EXPLICIT NON-GOALS

No Ocode inference router, FreeLLMAPI backend introspection, OAuth management, observation plugin, plugin SDK, custom probe dependency, event bus, telemetry platform, full precedence laboratory, permission catalog, skill system, fallback engine, Wayfinder, Planner Compiler, Task Runner, or worktree orchestration is included.

## TEST/EVIDENCE REFERENCES

- `npm run acceptance:m2` — real version, catalog discovery, same-agent FreeLLMAPI/OpenAI execution, retained static-Markdown override proof, JSON/result/session evidence, negative path, source/install fingerprint, plugin independence, and user-config preservation.
- `npm run test:opencode-integration` — profile schema, binding lookup, deterministic minimal overlay, stable fingerprint, and invalid-binding diagnostics.
- `node scripts/doctor.mjs` — fast version/catalog/artifact/overlay/source-install health checks.
- Canonical fixture: `test/fixtures/opencode-integration/agents/ocode-m2-diagnostic.md`.
- Upstream references: [OpenCode config](https://dev.opencode.ai/docs/config), [OpenCode CLI](https://dev.opencode.ai/docs/cli/), and [OpenCode skills](https://opencode.ai/docs/skills).
