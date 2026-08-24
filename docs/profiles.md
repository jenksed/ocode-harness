# Profiles

Ocode profiles are provider/model binding policy, not OpenCode provider definitions.

## Responsibility split

| State | Owner | Location |
| --- | --- | --- |
| Stable provider definition and exposed models | Ocode-managed OpenCode config | `opencode-config/opencode.json` |
| Semantic role to OpenCode provider/model binding | Ocode profile | `profiles/*.json` |
| Active profile and machine-local endpoint/push policy | Machine config | `~/.config/ocode/config.json` |
| Provider credentials and OpenAI OAuth | OpenCode | OpenCode credential store |

Profile schema version 1 is defined in `profiles/schema.json`:

```json
{
  "schema_version": 1,
  "name": "hybrid",
  "bindings": {
    "planner": "openai/discovered-model",
    "coder": "freellmapi/auto:coder"
  }
}
```

Each binding is an explicit OpenCode `provider/model` reference. The runtime validates the profile and produces only `agent.<role>.model` entries for `OPENCODE_CONFIG_CONTENT`. It does not score, route, retry, or inspect provider internals.

The former `default.json` and `freellmapi.json` files were removed in M2 because they duplicated provider definitions, mixed model catalogs with policy, and had no runtime consumer. M3 will add production `free.json` and `hybrid.json` profiles after completing the canonical role policy. Until then, the machine config's `profile` value is selection state, not an implemented launcher binding.

See `docs/architecture/opencode-integration-contract.md` for the observed precedence and execution contract.
